"""Voz neural da intro com UMA chamada de TTS por caso.

O plano grátis do Gemini TTS dá só ~10 chamadas por dia por modelo. Então a intro inteira vai
numa chamada só, com duas vozes (narrador e sargento), e depois é cortada em uma faixa por fala:
o Whisper do Groq (grátis) transcreve com o tempo de cada palavra e cortamos entre as falas.
Sem transcrição, o corte usa as pausas do áudio (audio_split.split_by_lines).

Só fala o prólogo do caso (nunca texto livre do cliente).
"""

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import re
import time
import wave
from pathlib import Path

import httpx

from .audio_split import split_with_words, words_from_whisper
from .kokoro_voice import INTRO_VOICES, KokoroVoice

log = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parent.parent / ".tts-cache"
# O modelo não aceita instrução de estilo (ele lê em voz alta), então o timbre vem da voz:
# Algenib = grave e rouca (sargento); Charon = grave, de narrador.
VOICES = {"policial": os.getenv("TTS_VOICE_OFFICER", "Algenib"), "narrador": os.getenv("TTS_VOICE_NARRATOR", "Charon")}
LABELS = {"narrador": "Narrador", "policial": "Sargento"}
MODELS = [m.strip() for m in os.getenv("GEMINI_TTS_MODELS", "gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts").split(",") if m.strip()]
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-large-v3-turbo")

Line = tuple[str, str]  # (texto, falante)


def _pcm_to_wav(pcm: bytes, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _retry_seconds(resp: httpx.Response) -> float:
    """Lê o retryDelay do erro 429 do Google (ex.: "18175s"). Padrão: 60 s."""
    try:
        for d in resp.json()["error"].get("details", []):
            if "retryDelay" in d:
                m = re.match(r"([\d.]+)s", d["retryDelay"])
                if m:
                    return float(m.group(1))
    except (ValueError, KeyError):
        pass
    return 60.0


class TTS:
    def __init__(
        self,
        client: httpx.AsyncClient,
        api_key: str | None,
        groq_key: str | None = None,
        kokoro: KokoroVoice | None = None,
    ):
        self.client = client
        self.kokoro = kokoro  # reserva ilimitada quando o Google estiver sem cota
        self.api_key = api_key
        self.groq_key = groq_key
        self._intros: dict[str, asyncio.Task[bool]] = {}  # intro -> tarefa
        self._line_intro: dict[str, str] = {}  # fala -> intro que a produz
        self._sem = asyncio.Semaphore(1)
        CACHE_DIR.mkdir(exist_ok=True)
        self._blocked_until: dict[str, float] = self._load_quota()  # modelo -> quando a cota volta

    @staticmethod
    def _quota_file() -> Path:
        return CACHE_DIR / "quota.json"

    def _load_quota(self) -> dict[str, float]:
        """Lembra a cota esgotada entre reinícios, para não perder tempo tentando o Google."""
        try:
            data = json.loads(self._quota_file().read_text())
            return {m: float(t) for m, t in data.items() if float(t) > time.time()}
        except (OSError, ValueError):
            return {}

    def _save_quota(self) -> None:
        try:
            self._quota_file().write_text(json.dumps(self._blocked_until))
        except OSError:
            pass

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    @property
    def gemini_available(self) -> bool:
        """Há chave e algum modelo do Google com cota agora."""
        now = time.time()
        return self.enabled and any(self._blocked_until.get(m, 0) <= now for m in MODELS)

    @property
    def available(self) -> bool:
        """Dá para gerar voz agora (Google ou Kokoro local)."""
        return self.gemini_available or bool(self.kokoro and self.kokoro.enabled)

    @staticmethod
    def key(text: str, speaker: str) -> str:
        return hashlib.sha1(f"{VOICES.get(speaker, '')}|{text}".encode()).hexdigest()

    @staticmethod
    def _path(k: str) -> Path:
        return CACHE_DIR / f"{k}.wav"

    def has_cached(self, text: str, speaker: str) -> bool:
        return self._path(self.key(text, speaker)).exists()

    def prefetch_intro(self, lines: list[Line]) -> None:
        """Agenda a geração da intro inteira (uma chamada), se ainda faltar alguma fala."""
        if not lines or all(self.has_cached(t, s) for t, s in lines) or not self.available:
            return
        ik = hashlib.sha1("\n".join(f"{s}|{t}" for t, s in lines).encode()).hexdigest()
        job = self._intros.get(ik)
        if job is None or (job.done() and not job.result()):
            self._intros[ik] = asyncio.create_task(self._produce_intro(lines))
        for t, s in lines:
            self._line_intro[self.key(t, s)] = ik

    async def get(self, text: str, speaker: str) -> bytes | None:
        """WAV da fala: do cache ou esperando a intro que a produz. Nunca gera fala avulsa."""
        k = self.key(text, speaker)
        path = self._path(k)
        ik = self._line_intro.get(k)
        job = self._intros.get(ik) if ik else None
        # Espera a fala ficar pronta (o Kokoro grava uma por vez; não precisa esperar a intro toda).
        while not path.exists() and job is not None and not job.done():
            await asyncio.sleep(0.25)
        return path.read_bytes() if path.exists() else None

    async def _produce_intro(self, lines: list[Line]) -> bool:
        async with self._sem:
            if all(self.has_cached(t, s) for t, s in lines):
                return True
            audio = await self._synthesize_intro(lines) if self.gemini_available else None
            if not audio:
                return await self._kokoro_intro(lines)
            words = await self._transcribe(audio)
            chunks = split_with_words(audio, [t for t, _ in lines], words)
            for (t, s), chunk in zip(lines, chunks):
                self._path(self.key(t, s)).write_bytes(chunk)
            log.warning("Intro com voz pronta: %d falas, corte por %s", len(lines), "transcrição" if words else "pausas")
            return True

    async def _kokoro_intro(self, lines: list[Line]) -> bool:
        """Sem cota do Google: cada fala com a voz brasileira do Kokoro (local, ilimitado)."""
        if not (self.kokoro and self.kokoro.enabled):
            return False
        for t, s in lines:
            if self.has_cached(t, s):
                continue
            voice, speed = INTRO_VOICES.get(s, INTRO_VOICES["narrador"])
            audio = await self.kokoro.synth(t, voice, "pt-br", speed, urgent=False)
            if not audio:
                return False
            self._path(self.key(t, s)).write_bytes(audio)
        log.warning("Intro com voz do Kokoro (Google sem cota): %d falas", len(lines))
        return True

    def request_body(self, lines: list[Line]) -> dict:
        speakers = sorted({s for _, s in lines})
        if len(speakers) == 2:
            # Multi-falante: cada fala é uma parte com speechMetadata.speaker (exigido pela API).
            parts = [{"text": t, "speechMetadata": {"speaker": LABELS.get(s, s)}} for t, s in lines]
            speech: dict = {
                "multiSpeakerVoiceConfig": {
                    "speakerVoiceConfigs": [
                        {"speaker": LABELS.get(s, s), "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICES.get(s, "Charon")}}}
                        for s in speakers
                    ]
                }
            }
        else:
            parts = [{"text": " ".join(t for t, _ in lines)}]
            speech = {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICES.get(speakers[0], "Charon")}}}
        return {
            "contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": speech},
        }

    async def _synthesize_intro(self, lines: list[Line]) -> bytes | None:
        body = self.request_body(lines)
        for model in MODELS:
            if self._blocked_until.get(model, 0) > time.time():
                continue
            try:
                r = await self.client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    json=body,
                    headers={"x-goog-api-key": self.api_key or ""},
                    timeout=180,
                )
                r.raise_for_status()
                part = r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
                raw = base64.b64decode(part["data"])
                mime = part.get("mimeType", "")
                if "wav" in mime:
                    return raw
                rate = int(mime.split("rate=")[1].split(";")[0]) if "rate=" in mime else 24000
                return _pcm_to_wav(raw, rate)  # audio/L16 (PCM cru)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429:
                    wait = _retry_seconds(exc.response)
                    self._blocked_until[model] = time.time() + wait
                    self._save_quota()
                    log.warning("TTS %s sem cota; pausado por %.0f s", model, wait)
                else:
                    log.warning("TTS %s falhou: %s", model, exc)
            except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
                log.warning("TTS %s falhou: %s", model, exc)
        return None

    async def _transcribe(self, audio: bytes) -> list[tuple[str, float, float]] | None:
        """Palavras com tempo via Whisper do Groq. None se não der (o corte usa as pausas)."""
        if not self.groq_key:
            return None
        try:
            r = await self.client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.groq_key}"},
                files={"file": ("intro.wav", audio, "audio/wav")},
                data={
                    "model": WHISPER_MODEL,
                    "language": "pt",
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "word",
                },
                timeout=120,
            )
            r.raise_for_status()
            return words_from_whisper(r.json()) or None
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Transcrição falhou, cortando pelas pausas: %s", exc)
            return None
