"""API do jogo. Rodar: uvicorn app.main:app --reload (dentro de backend/)."""

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from .agents import ask_suspect, is_confession, speech_language, stream_suspect
from .cases import default_prologue, generate_case
from .llm import LLMChain, build_chain_from_env
from .schemas import (
    AccuseRequest,
    AccuseResponse,
    InterrogateRequest,
    InterrogateResponse,
    PublicCase,
    PublicSuspect,
)
from .store import GameSession, SessionStore
from .kokoro_voice import KokoroVoice, voice_for
from .tts import TTS, WHISPER_MODEL

load_dotenv()
MAX_QUESTIONS = int(os.getenv("MAX_QUESTIONS", "25"))
# Casos já gerados esperando o jogador (o "Abrir caso" fica instantâneo). 0 desliga (testes).
CASE_POOL = int(os.getenv("CASE_POOL", "1"))
# A fila só gera o próximo caso com o jogador parado (não disputa limite de API nem CPU no jogo).
POOL_QUIET_S = float(os.getenv("POOL_QUIET_S", "60"))
log = logging.getLogger(__name__)


class CasePool:
    """Mantém CASE_POOL casos prontos, gerados em segundo plano, já com as vozes da intro pedidas."""

    def __init__(self, size: int):
        self.size = size
        self.ready: list = []
        self._need = asyncio.Event()
        self._need.set()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self.size > 0:
            self._task = asyncio.create_task(self._fill())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    def take(self):
        if self.ready:
            item = self.ready.pop(0)
            self._need.set()
            return item
        return None

    async def _fill(self) -> None:
        while True:
            await self._need.wait()
            self._need.clear()
            while len(self.ready) < self.size:
                while time.time() - app.state.last_activity < POOL_QUIET_S:
                    await asyncio.sleep(5)
                try:
                    case, source = await generate_case(app.state.llm)
                except Exception:  # nunca derrubar o loop de fundo
                    log.exception("Falha ao pré-gerar caso")
                    await asyncio.sleep(30)
                    continue
                prologue = case.prologue or default_prologue(case)
                app.state.tts.prefetch_intro([(line.text, line.speaker) for line in prologue])
                self.ready.append((case, source))
                log.info("Caso pronto na fila: %s (%s)", case.title, source)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=30) as client:
        if not hasattr(app.state, "llm"):  # testes podem injetar outra cadeia
            app.state.llm = build_chain_from_env(client)
        app.state.http = client
        app.state.store = SessionStore()
        # Testes desligam a voz (TTS_DISABLED) para não chamar a API de verdade.
        key = None if os.getenv("TTS_DISABLED") else os.getenv("GEMINI_API_KEY")
        app.state.kokoro = KokoroVoice()
        app.state.kokoro.warm_up()
        app.state.tts = TTS(client, key, None if os.getenv("TTS_DISABLED") else os.getenv("GROQ_API_KEY"), app.state.kokoro)
        app.state.last_activity = 0.0  # último interrogatório (a fila espera o jogador parar)
        app.state.pool = CasePool(CASE_POOL)
        app.state.pool.start()
        yield
        await app.state.pool.stop()


app = FastAPI(title="Noir: Detetive IA", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def _llm() -> LLMChain:
    return app.state.llm


def _store() -> SessionStore:
    return app.state.store


def _session(case_id: str) -> GameSession:
    s = _store().get(case_id)
    if not s:
        raise HTTPException(404, "Caso não encontrado ou expirado. Abra um caso novo.")
    return s


def to_public(s: GameSession) -> PublicCase:
    c = s.case
    return PublicCase(
        case_id=s.id,
        officer_name=c.officer_name,
        prologue=c.prologue or default_prologue(c),
        title=c.title,
        setting=c.setting,
        intro=c.intro,
        victim=c.victim,
        suspects=[PublicSuspect(**x.model_dump(include={"id", "name", "role", "description", "look", "nationality", "speaks_portuguese"})) for x in c.suspects],
        max_questions=s.max_questions,
        questions_left=s.questions_left,
    )


@app.get("/api/health")
async def health() -> dict:
    llm = _llm()
    return {"status": "ok", "providers": [p.name for p in llm.providers], "offline": llm.allow_mock, "tts": app.state.tts.available, "cases_ready": len(app.state.pool.ready)}


@app.post("/api/cases", response_model=PublicCase)
async def new_case() -> PublicCase:
    ready = app.state.pool.take()
    case, source = ready if ready else await generate_case(_llm())
    session = GameSession(case=case, case_source=source, max_questions=MAX_QUESTIONS)
    _store().add(session)
    public = to_public(session)
    # Já começa a gerar as vozes da intro enquanto o jogador vê o caso abrir.
    app.state.tts.prefetch_intro([(line.text, line.speaker) for line in public.prologue])
    return public


@app.get("/api/cases/{case_id}/prologue/{line}/audio")
async def prologue_audio(case_id: str, line: int) -> Response:
    s = _session(case_id)
    lines = to_public(s).prologue
    if not 0 <= line < len(lines):
        raise HTTPException(404, "Fala inexistente.")
    tts = app.state.tts
    text, speaker = lines[line].text, lines[line].speaker
    if not tts.available and not tts.has_cached(text, speaker):
        raise HTTPException(503, "Sem cota de voz agora.")
    audio = await tts.get(text, speaker)
    if not audio:
        raise HTTPException(503, "Voz indisponível agora (limite do plano grátis?).")
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/cases/{case_id}/interrogate", response_model=InterrogateResponse)
async def interrogate(case_id: str, req: InterrogateRequest) -> InterrogateResponse:
    s = _session(case_id)
    if s.finished:
        raise HTTPException(409, "Este caso já foi encerrado.")
    if s.questions_left <= 0:
        raise HTTPException(429, "Acabaram suas perguntas. Hora de acusar alguém.")
    suspect = s.case.suspect(req.suspect_id)
    if not suspect:
        raise HTTPException(400, "Suspeito inválido.")
    question = req.question.strip()
    app.state.last_activity = time.time()
    try:
        answer, emotion, provider = await ask_suspect(_llm(), s, suspect, question)
    except RuntimeError:
        raise HTTPException(503, "Os suspeitos estão em silêncio (IA indisponível). Tente de novo.")
    s.questions_used += 1
    s.histories.setdefault(suspect.id, []).extend(
        [{"role": "user", "text": question}, {"role": "assistant", "text": answer}]
    )
    female = suspect.look.gender == "feminino"
    # Posição entre os suspeitos do mesmo tipo (brasileiro do mesmo gênero), para variar a voz.
    same = [x for x in s.case.suspects if not x.nationality and (x.look.gender == "feminino") == female]
    slot = next((i for i, x in enumerate(same) if x.id == suspect.id), 0)
    voice = voice_for(suspect.nationality, female, suspect.speaks_portuguese, slot)
    kokoro: KokoroVoice = app.state.kokoro
    audio_urls: list[str] = []
    if kokoro.enabled:
        # Frase por frase, em ordem: a 1ª fica pronta rápido e as outras são geradas enquanto ela toca.
        loop = asyncio.get_running_loop()
        futures = [loop.create_future() for _ in split_sentences(answer)]
        start = len(s.voice_jobs)
        s.voice_jobs.extend(futures)
        audio_urls = [f"/api/cases/{s.id}/voice/{start + i}" for i in range(len(futures))]

        async def speak_in_order(sentences: list[str]) -> None:
            for fut, sentence in zip(futures, sentences):
                fut.set_result(await kokoro.synth(sentence, *voice))

        asyncio.create_task(speak_in_order(split_sentences(answer)))
    return InterrogateResponse(
        answer=answer,
        emotion=emotion,
        questions_left=s.questions_left,
        provider=provider,
        audio_url=audio_urls[0] if audio_urls else None,
        audio_urls=audio_urls,
    )


class Chunker:
    """Junta o texto que chega em streaming e solta trechos bons para a voz.

    O Kokoro leva ~0,3 s + 0,035 s por caractere. Por isso os trechos crescem:
    o 1º é bem curto (a voz começa em ~1 s), o 2º médio (fica pronto enquanto o 1º toca)
    e os seguintes longos (soam mais naturais).
    """

    END = ".!?…"
    PAUSE = ",;:"
    # (mínimo para cortar em vírgula, máximo antes de cortar num espaço) por trecho
    STAGES = ((8, 28), (16, 42), (30, 75), (40, 110))

    def __init__(self) -> None:
        self.buf = ""
        self.count = 0

    def feed(self, delta: str) -> list[str]:
        self.buf += delta
        out: list[str] = []
        while True:
            piece = self._cut()
            if piece is None:
                return out
            out.append(piece)

    def flush(self) -> list[str]:
        rest, self.buf = self.buf.strip(), ""
        return [rest] if rest else []

    def _cut(self) -> str | None:
        min_len, limit = self.STAGES[min(self.count, len(self.STAGES) - 1)]
        cut = None
        for i, ch in enumerate(self.buf[: limit + 1]):
            nxt = self.buf[i + 1] if i + 1 < len(self.buf) else None
            if nxt is None or not nxt.isspace():
                continue  # só corta com espaço depois (pontuação confirmada)
            if ch in self.END and i + 1 >= min(min_len, 8):
                cut = i + 1
                break
            if ch in self.PAUSE and i + 1 >= min_len:
                cut = i + 1
                break
        # Sem pontuação até o limite: corta no último espaço antes dele.
        if cut is None and len(self.buf) > limit:
            space = self.buf.rfind(" ", 0, limit)
            cut = space if space > 0 else limit
        if cut is None:
            return None
        piece, self.buf = self.buf[:cut].strip(), self.buf[cut:].lstrip()
        if not piece:
            return None
        self.count += 1
        return piece


@app.post("/api/cases/{case_id}/interrogate/stream")
async def interrogate_stream(case_id: str, req: InterrogateRequest) -> StreamingResponse:
    """Interrogatório em tempo real (Server-Sent Events).

    Eventos: emotion -> piece (texto + url da voz daquele trecho)... -> done.
    O frontend mostra cada trecho junto com a voz dele.
    """
    s = _session(case_id)
    if s.finished:
        raise HTTPException(409, "Este caso já foi encerrado.")
    if s.questions_left <= 0:
        raise HTTPException(429, "Acabaram suas perguntas. Hora de acusar alguém.")
    suspect = s.case.suspect(req.suspect_id)
    if not suspect:
        raise HTTPException(400, "Suspeito inválido.")
    question = req.question.strip()
    app.state.last_activity = time.time()
    s.questions_used += 1  # conta já: evita duas perguntas ao mesmo tempo passarem do limite

    female = suspect.look.gender == "feminino"
    same = [x for x in s.case.suspects if not x.nationality and (x.look.gender == "feminino") == female]
    slot = next((i for i, x in enumerate(same) if x.id == suspect.id), 0)
    voice = voice_for(suspect.nationality, female, suspect.speaks_portuguese, slot)
    kokoro: KokoroVoice = app.state.kokoro
    loop = asyncio.get_running_loop()
    voice_queue: asyncio.Queue = asyncio.Queue()

    async def voice_worker() -> None:
        # Gera as vozes na ordem dos trechos, uma por vez, com prioridade sobre a intro em fundo.
        kokoro.hold(True)
        try:
            while True:
                item = await voice_queue.get()
                if item is None:
                    return
                fut, text = item
                name, lang, speed = voice
                if not lang.startswith("en") and speech_language(text, question) == "en":
                    lang = "en-us"  # resposta em inglês: lê com pronúncia inglesa (o sotaque fica na voz)
                fut.set_result(await kokoro.synth(text, name, lang, speed))
        finally:
            kokoro.hold(False)

    worker = asyncio.create_task(voice_worker()) if kokoro.enabled else None

    def event(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def gen():
        chunker = Chunker()
        full = ""
        emotion = "calmo"
        provider = "offline"
        guard_tripped = False

        def piece_event(text: str) -> str:
            url = None
            if worker is not None:
                fut = loop.create_future()
                s.voice_jobs.append(fut)
                voice_queue.put_nowait((fut, text))
                url = f"/api/cases/{s.id}/voice/{len(s.voice_jobs) - 1}"
            return event({"type": "piece", "text": text, "audio_url": url})

        try:
            async for kind, value in stream_suspect(_llm(), s, suspect, question):
                if kind == "emotion":
                    emotion = value
                    yield event({"type": "emotion", "emotion": value})
                elif kind == "provider":
                    provider = value
                elif kind == "text" and not guard_tripped:
                    for piece in chunker.feed(value):
                        if suspect.is_culprit and is_confession(full + " " + piece):
                            guard_tripped = True  # culpado nunca confessa: corta e desconversa
                            piece = "Não vou responder a isso, detetive."
                        full = f"{full} {piece}".strip()
                        yield piece_event(piece)
                        if guard_tripped:
                            break
            if not guard_tripped:
                for piece in chunker.flush():
                    full = f"{full} {piece}".strip()
                    yield piece_event(piece)
        except RuntimeError:
            if not full:
                s.questions_used -= 1
                yield event({"type": "error", "detail": "Os suspeitos estão em silêncio (IA indisponível)."})
                return
        finally:
            voice_queue.put_nowait(None)
        s.histories.setdefault(suspect.id, []).extend(
            [{"role": "user", "text": question}, {"role": "assistant", "text": full}]
        )
        yield event(
            {
                "type": "done",
                "answer": full,
                "emotion": emotion,
                "questions_left": s.questions_left,
                "provider": provider,
            }
        )

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def split_sentences(text: str, min_len: int = 28, max_len: int = 70) -> list[str]:
    """Divide a fala em pedaços curtos para a voz começar rápido.

    Corta em fim de frase; frases longas também nas vírgulas (pedaços de até ~max_len).
    Junta pedaços muito curtos com o seguinte (o Kokoro soa melhor com contexto).
    """
    import re

    sentences = [p.strip() for p in re.split(r"(?<=[.!?…])\s+", text.strip()) if p.strip()]
    pieces: list[str] = []
    for sent in sentences:
        if len(sent) <= max_len:
            pieces.append(sent)
            continue
        cur = ""
        for clause in re.split(r"(?<=[,;:])\s+", sent):
            if cur and len(cur) + len(clause) + 1 > max_len:
                pieces.append(cur)
                cur = clause
            else:
                cur = f"{cur} {clause}".strip()
        if cur:
            pieces.append(cur)
    out: list[str] = []
    for p in pieces:
        if out and len(out[-1]) < min_len:
            out[-1] = f"{out[-1]} {p}"
        else:
            out.append(p)
    return out or [text]


@app.get("/api/cases/{case_id}/voice/{n}")
async def answer_voice(case_id: str, n: int) -> Response:
    s = _session(case_id)
    if not 0 <= n < len(s.voice_jobs):
        raise HTTPException(404, "Fala inexistente.")
    audio = await asyncio.shield(s.voice_jobs[n])
    if not audio:
        raise HTTPException(503, "Voz indisponível.")
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600"})


MAX_QUESTION_AUDIO = 3 * 1024 * 1024  # ~1 min de áudio comprimido; pergunta é curta
# Frases que o Whisper "inventa" quando a gravação é só silêncio ou ruído.
WHISPER_JUNK = ("legendas pela comunidade", "amara.org", "obrigado por assistir", "thanks for watching", "subtitles by")
WHISPER_JUNK_EXACT = {"", "e aí", "e ai", "thank you", "thank you very much", "obrigado", "obrigada", "tchau", "you", "bye"}
MIC_DEBUG_DIR = Path(__file__).resolve().parent.parent / ".tts-cache" / "mic"  # última gravação, para diagnóstico


def _is_junk(text: str) -> bool:
    t = text.lower().strip(" .!?,…")
    return t in WHISPER_JUNK_EXACT or any(j in t for j in WHISPER_JUNK)


QUESTION_WHISPER_MODEL = os.getenv("QUESTION_WHISPER_MODEL", "whisper-large-v3")


async def _whisper(key: str, data: bytes, filename: str, content_type: str, language: str) -> dict:
    r = await app.state.http.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {key}"},
        files={"file": (filename, data, content_type)},
        data={
            "model": QUESTION_WHISPER_MODEL,
            "response_format": "verbose_json",
            "temperature": "0",
            "language": language,
        },
        timeout=20,
    )
    r.raise_for_status()
    result = r.json()
    segs = result.get("segments") or []
    result["_logprob"] = sum(float(sg.get("avg_logprob", -5)) for sg in segs) / len(segs) if segs else -5.0
    result["_no_speech"] = max((float(sg.get("no_speech_prob", 0)) for sg in segs), default=0.0)
    return result


@app.post("/api/cases/{case_id}/transcribe")
async def transcribe_question(case_id: str, audio: UploadFile = File(...), language: str = Form("pt")) -> dict:
    """Pergunta falada -> texto (Whisper do Groq), no idioma que o jogador escolheu (pt ou en).

    O idioma vem do jogador porque não dá para adivinhar: a detecção automática erra em frase
    curta (português virava inglês, até coreano), e forçar o idioma errado faz o Whisper TRADUZIR
    (com notas de confiança quase iguais). Sem "prompt" de dica: com silêncio ele repete a dica.
    """
    _session(case_id)
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise HTTPException(503, "Reconhecimento de voz indisponível. Digite a pergunta.")
    data = await audio.read(MAX_QUESTION_AUDIO + 1)
    if len(data) > MAX_QUESTION_AUDIO:
        raise HTTPException(413, "Gravação longa demais. Faça uma pergunta curta.")
    if len(data) < 800:
        raise HTTPException(422, "Não ouvi nada. Segure o botão enquanto fala.")
    filename = audio.filename or "pergunta.webm"
    content_type = audio.content_type or "audio/webm"
    try:
        MIC_DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        (MIC_DEBUG_DIR / ("ultima" + Path(filename).suffix)).write_bytes(data)
    except OSError:
        pass
    lang = "en" if language == "en" else "pt"
    try:
        best = await _whisper(key, data, filename, content_type, lang)
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("Transcrição falhou: %s", exc)
        raise HTTPException(502, "Não consegui entender o áudio agora. Tente de novo ou digite.")
    text = str(best.get("text", "")).strip()
    log.warning("Transcrição (%d bytes, %s, %s, lp=%.2f): %r", len(data), filename, lang, best["_logprob"], text[:120])
    if _is_junk(text) or best["_no_speech"] > 0.8:
        raise HTTPException(422, "Não ouvi sua voz. Confira o microfone e fale perto dele.")
    return {"text": text[:260]}


@app.post("/api/cases/{case_id}/accuse", response_model=AccuseResponse)
async def accuse(case_id: str, req: AccuseRequest) -> AccuseResponse:
    s = _session(case_id)
    if not s.case.suspect(req.suspect_id):
        raise HTTPException(400, "Suspeito inválido.")
    s.finished = True
    app.state.last_activity = 0.0  # partida acabou: a fila pode preparar o próximo caso
    culprit = s.case.suspect(s.case.culprit_id)
    assert culprit is not None
    return AccuseResponse(
        correct=req.suspect_id == culprit.id,
        culprit_id=culprit.id,
        culprit_name=culprit.name,
        explanation=s.case.solution,
    )
