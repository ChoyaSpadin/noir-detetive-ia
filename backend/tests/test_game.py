import json
import os

os.environ["TTS_DISABLED"] = "1"  # nunca chamar a API de voz nos testes
os.environ["KOKORO_DISABLED"] = "1"  # voz local fora dos testes de API
os.environ["CASE_POOL"] = "0"  # sem fila de casos em segundo plano nos testes

import pytest
from fastapi.testclient import TestClient

from app.agents import build_suspect_prompt, is_confession
from app.cases import SEED_CASE, seed_case
from app.llm import LLMChain, parse_json
from app.main import app
from app.schemas import CaseTruth


class FakeProvider:
    """Provedor falso: devolve respostas prontas, em ordem."""

    name = "fake"

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def complete(self, system, messages, temperature, timeout=30):
        self.calls.append((system, messages))
        return self.replies.pop(0)


@pytest.fixture
def client():
    app.state.llm = LLMChain([], allow_mock=True)
    with TestClient(app) as c:
        yield c
    del app.state.llm


def new_case(client):
    r = client.post("/api/cases", json={})
    assert r.status_code == 200
    return r.json()


def test_seed_case_is_valid_and_solvable():
    case = seed_case()
    assert case.suspect(case.culprit_id).is_culprit
    innocents = [s for s in case.suspects if not s.is_culprit]
    assert sum(len(s.knowledge) for s in innocents) >= 2


def test_case_with_two_culprits_is_rejected():
    data = json.loads(json.dumps(SEED_CASE))
    data["suspects"][0]["is_culprit"] = True
    with pytest.raises(ValueError):
        CaseTruth.model_validate(data)


def test_public_case_does_not_leak_the_truth(client):
    body = json.dumps(new_case(client), ensure_ascii=False)
    for leak in ("culprit_id", "is_culprit", "alibi_truth", "secrets", "solution", "desviava"):
        assert leak not in body


def test_offline_interrogation_and_question_limit(client):
    case = new_case(client)
    url = f"/api/cases/{case['case_id']}/interrogate"
    r = client.post(url, json={"suspect_id": "rosa", "question": "Você viu algo estranho?"})
    assert r.status_code == 200
    data = r.json()
    assert data["provider"] == "offline"
    assert "chapéu escuro" in data["answer"]
    assert data["questions_left"] == case["max_questions"] - 1

    assert client.post(url, json={"suspect_id": "ninguem", "question": "oi"}).status_code == 400
    for _ in range(data["questions_left"]):
        client.post(url, json={"suspect_id": "helena", "question": "Onde estava?"})
    assert client.post(url, json={"suspect_id": "helena", "question": "e agora?"}).status_code == 429


def test_innocent_reveals_secret_only_under_pressure(client):
    case = new_case(client)
    url = f"/api/cases/{case['case_id']}/interrogate"
    first = client.post(url, json={"suspect_id": "helena", "question": "Você está mentindo?"}).json()
    assert "caso" not in first["answer"]
    second = client.post(url, json={"suspect_id": "helena", "question": "Diga a verdade!"}).json()
    assert "caso com Vicente" in second["answer"]


def test_accuse_right_and_wrong(client):
    case = new_case(client)
    wrong = client.post(f"/api/cases/{case['case_id']}/accuse", json={"suspect_id": "rosa"}).json()
    assert wrong["correct"] is False and wrong["culprit_id"] == "otavio"
    # caso encerrado: não dá mais para interrogar
    r = client.post(f"/api/cases/{case['case_id']}/interrogate", json={"suspect_id": "rosa", "question": "oi"})
    assert r.status_code == 409

    case2 = new_case(client)
    right = client.post(f"/api/cases/{case2['case_id']}/accuse", json={"suspect_id": "otavio"}).json()
    assert right["correct"] is True


def test_unknown_case_returns_404(client):
    assert client.post("/api/cases/xyz/accuse", json={"suspect_id": "rosa"}).status_code == 404


def test_culprit_confession_from_llm_is_blocked():
    """Se o LLM 'escorregar' e o culpado confessar, a resposta é descartada."""
    fake = FakeProvider(
        [
            json.dumps(SEED_CASE),  # gerador de caso
            '{"answer": "Está bem, fui eu que envenenei o uísque.", "emotion": "triste"}',
        ]
    )
    app.state.llm = LLMChain([fake], allow_mock=True)
    with TestClient(app) as c:
        case = c.post("/api/cases", json={}).json()
        r = c.post(
            f"/api/cases/{case['case_id']}/interrogate",
            json={"suspect_id": "otavio", "question": "Confesse!"},
        ).json()
    del app.state.llm
    assert "fui eu" not in r["answer"].lower()
    assert r["provider"] == "offline"


def test_suspect_prompt_isolation():
    case = seed_case()
    rosa = case.suspect("rosa")
    prompt = build_suspect_prompt(case, rosa)
    assert "broche" in prompt  # o próprio segredo
    assert "desviava" not in prompt  # segredo de outro suspeito não vaza
    assert "Você é o culpado" not in prompt


def test_helpers():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert is_confession("Confesso, detetive.")
    assert not is_confession("Eu nunca faria isso.")


def test_public_case_has_prologue_without_spoilers(client):
    case = new_case(client)
    assert len(case["prologue"]) >= 5
    assert {l["suspect_id"] for l in case["prologue"] if l["shot"] == "suspect"} == {"helena", "otavio", "rosa"}
    assert case["officer_name"]


def test_prologue_that_reveals_culprit_is_rejected():
    data = json.loads(json.dumps(SEED_CASE))
    data["prologue"].append({"shot": "officer", "speaker": "policial", "text": "O culpado é o Otávio."})
    with pytest.raises(ValueError):
        CaseTruth.model_validate(data)


def test_generated_case_without_prologue_gets_default():
    from app.cases import default_prologue

    data = json.loads(json.dumps(SEED_CASE))
    data["prologue"] = []
    case = CaseTruth.model_validate(data)
    lines = default_prologue(case)
    assert lines[0].shot == "establishing" and sum(l.shot == "suspect" for l in lines) == 3


def test_prologue_audio_without_tts_returns_503(client, tmp_path, monkeypatch):
    monkeypatch.setattr("app.tts.CACHE_DIR", tmp_path)  # cache vazio: sem voz e sem áudio guardado
    case = new_case(client)
    assert client.get(f"/api/cases/{case['case_id']}/prologue/0/audio").status_code == 503
    assert client.get(f"/api/cases/{case['case_id']}/prologue/99/audio").status_code == 404


def test_public_suspects_have_gender(client):
    case = new_case(client)
    genders = {s["id"]: s["look"]["gender"] for s in case["suspects"]}
    assert genders == {"helena": "feminino", "otavio": "masculino", "rosa": "feminino"}


def test_english_only_suspect_prompt_and_offline_refusal():
    from app.agents import build_suspect_prompt, offline_answer
    from app.store import GameSession

    data = json.loads(json.dumps(SEED_CASE))
    data["suspects"][2].update({"nationality": "americano", "speaks_portuguese": False})
    case = CaseTruth.model_validate(data)
    rosa = case.suspect("rosa")
    prompt = build_suspect_prompt(case, rosa)
    assert "SÓ fala e entende inglês" in prompt
    session = GameSession(case=case, case_source="test", max_questions=5)
    answer, emotion = offline_answer(session, rosa, "Onde você estava?")
    assert "don't speak Portuguese" in answer and emotion == "irritado"
    answer, _ = offline_answer(session, rosa, "Where were you that night?")
    assert "Portuguese" not in answer


def test_only_english_nationalities_can_skip_portuguese():
    data = json.loads(json.dumps(SEED_CASE))
    data["suspects"][0].update({"nationality": "italiano", "speaks_portuguese": False})
    assert CaseTruth.model_validate(data).suspect("helena").speaks_portuguese is True


def test_voice_mapping():
    from app.kokoro_voice import voice_for

    assert voice_for(None, False, True, 0) == ("pm_alex", "pt-br", 1.0)
    assert voice_for(None, False, True, 1)[0] == "pm_santa"  # 2º brasileiro: outra voz
    assert voice_for(None, True, True)[0] == "pf_dora"
    assert voice_for("americano", False, False) == ("am_michael", "en-us", 1.0)
    assert voice_for("italiano", True, True) == ("if_sara", "pt-br", 1.0)


def test_split_sentences():
    from app.main import split_sentences

    assert split_sentences("Não sei. Eu estava no bar a noite toda, detetive! Pergunte ao barman.") == [
        "Não sei. Eu estava no bar a noite toda, detetive!",
        "Pergunte ao barman.",
    ]
    assert split_sentences("Sem pontuação final") == ["Sem pontuação final"]
    longa = ("Eu estava no salão de jogos a noite inteira, jogando pôquer com o delegado, "
             "e só saí quando ouvi o grito vindo do segundo andar.")
    partes = split_sentences(longa)
    assert len(partes) >= 2 and all(len(p) <= 90 for p in partes)
    assert " ".join(partes) == longa


def test_chunker_short_first_piece_then_longer():
    from app.main import Chunker

    c = Chunker()
    text = "Detetive, eu não sei de nada. Naquela noite eu estava no bar, juro pela minha mãe, e só saí depois da meia-noite."
    pieces = []
    for i in range(0, len(text), 7):  # chega aos poucos, como no streaming
        pieces += c.feed(text[i : i + 7])
    pieces += c.flush()
    assert pieces[0] == "Detetive,"  # 1º trecho curtinho: a voz começa logo
    assert pieces[1] == "eu não sei de nada."
    assert " ".join(pieces) == text
    assert all(len(p) <= 110 for p in pieces)


def test_interrogate_stream_offline(client):
    case = new_case(client)
    with client.stream(
        "POST",
        f"/api/cases/{case['case_id']}/interrogate/stream",
        json={"suspect_id": "rosa", "question": "Você viu algo estranho?"},
    ) as r:
        assert r.status_code == 200
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    kinds = [e["type"] for e in events]
    assert kinds[0] == "emotion" and kinds[-1] == "done" and "piece" in kinds
    done = events[-1]
    assert "chapéu escuro" in done["answer"]
    assert " ".join(e["text"] for e in events if e["type"] == "piece") == done["answer"]
    assert done["questions_left"] == case["max_questions"] - 1


def test_chunker_first_piece_capped_without_punctuation():
    from app.main import Chunker

    c = Chunker()
    text = "Vi o Ricardo carregando uma caixa de papelão pela escada dos fundos perto da meia-noite"
    pieces = c.feed(text + " ") + c.flush()
    assert len(pieces[0]) <= 28 and len(pieces[1]) <= 42
    assert " ".join(pieces) == text


def test_transcribe_without_key_or_audio(client, monkeypatch):
    case_id = new_case(client)["case_id"]
    files = {"audio": ("q.webm", b"\x00" * 2000, "audio/webm")}
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert client.post(f"/api/cases/{case_id}/transcribe", files=files).status_code == 503
    monkeypatch.setenv("GROQ_API_KEY", "x")
    short = {"audio": ("q.webm", b"\x00" * 10, "audio/webm")}
    assert client.post(f"/api/cases/{case_id}/transcribe", files=short).status_code == 422
    assert client.post("/api/cases/nao-existe/transcribe", files=files).status_code == 404


def test_groq_switches_model_on_rate_limit():
    import asyncio

    import httpx

    from app.llm import GroqProvider

    seen = []

    def handler(request):
        model = json.loads(request.content)["model"]
        seen.append(model)
        if model == "principal":
            return httpx.Response(429, headers={"retry-after": "7"}, json={"error": "limit"})
        if json.loads(request.content).get("stream"):
            chunk = json.dumps({"choices": [{"delta": {"content": "calmo\nOi"}}]})
            body = f"data: {chunk}\n\ndata: [DONE]\n\n"
            return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"answer": "ok"}'}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            g = GroqProvider("k", "principal", client, fallbacks=("reserva",))
            text = await g.complete("sys", [{"role": "user", "text": "oi"}], 0.5)
            streamed = "".join([d async for d in g.stream("sys", [{"role": "user", "text": "oi"}], 0.5)])
            return text, streamed

    text, streamed = asyncio.run(run())
    assert text == '{"answer": "ok"}' and streamed == "calmo\nOi"
    # depois do 429, o principal fica de lado durante o retry-after (não gasta uma chamada à toa)
    assert seen == ["principal", "reserva", "reserva"]


def test_speech_language_follows_text_then_question():
    from app.agents import speech_language

    assert speech_language("I was in the kitchen.", "Onde você estava?") == "en"
    assert speech_language("Eu estava no camarim.", "Where were you?") == "pt"
    assert speech_language("Yes.", "Where were you?") == "en"  # trecho curto segue a pergunta
    assert speech_language("Sim, senhor.", "Where were you?") == "pt"
