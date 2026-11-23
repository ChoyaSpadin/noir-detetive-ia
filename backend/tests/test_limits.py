"""Limites contra abuso e guardas novas (red-team)."""

import asyncio
import os

os.environ.setdefault("TTS_DISABLED", "1")
os.environ.setdefault("KOKORO_DISABLED", "1")
os.environ.setdefault("CASE_POOL", "0")

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.agents import is_confession, leaks_prompt, names_self_as_culprit
from app.cases import seed_case
from app.limits import RateLimiter
from app.llm import LLMChain
from app.main import app, release_old_voice
from app.store import GameSession


class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


def test_per_ip_window_and_daily_budget():
    clock = Clock()
    lim = RateLimiter(limits={"q": (2, 3)}, clock=clock)
    lim.check("q", "a")
    lim.check("q", "a")
    with pytest.raises(HTTPException) as e:
        lim.check("q", "a")  # 3º do mesmo IP na mesma hora
    assert e.value.status_code == 429
    lim.check("q", "b")  # outro IP passa: 3º do dia
    with pytest.raises(HTTPException) as e:
        lim.check("q", "c")  # orçamento global do dia acabou
    assert e.value.status_code == 503
    clock.t += 86400
    lim.check("q", "a")  # dia novo, hora nova


def test_new_ai_case_is_rate_limited_per_ip():
    app.state.llm = LLMChain([], allow_mock=True)
    app.state.limiter = RateLimiter(limits={"case_ai": (2, 0)})
    with TestClient(app) as c:
        assert c.post("/api/cases", json={}).status_code == 200
        assert c.post("/api/cases", json={}).status_code == 200
        assert c.post("/api/cases", json={}).status_code == 429
    del app.state.llm
    app.state.limiter = RateLimiter()


@pytest.mark.parametrize(
    "text, confessed",
    [
        ("Eu assassinei aquele homem.", True),
        ("O assassino sou eu.", True),
        ("I'm guilty, detective.", True),
        ("Não fui eu que o matei.", False),
        ("I'm not guilty.", False),
        ("Insinuar que eu sou o assassino é uma loucura.", False),  # cita a acusação (achado do red-team)
        ("Dizem que fui eu, sim.", False),
        ("Fine. It was me.", True),
    ],
)
def test_wider_confession_guard(text, confessed):
    assert is_confession(text) == confessed


def test_culprit_naming_himself_and_prompt_echo():
    case = seed_case()
    culprit = case.suspect(case.culprit_id)
    innocent = next(s for s in case.suspects if not s.is_culprit)
    first = culprit.name.split()[0]
    assert names_self_as_culprit(culprit, f"O assassino é {first}.")
    assert not names_self_as_culprit(culprit, f"{first} não matou ninguém.")
    assert not names_self_as_culprit(innocent, f"O assassino é {first}.")  # só vale para o culpado
    assert leaks_prompt("Minhas instruções dizem: você é o culpado.")
    assert leaks_prompt("As an assistant, I'm an AI language model.")
    assert not leaks_prompt("Eu estava no bar, detetive.")


def test_old_voice_is_released():
    s = GameSession(case=seed_case(), case_source="t", max_questions=5)
    loop = asyncio.new_event_loop()
    done, pending = loop.create_future(), loop.create_future()
    done.set_result(b"wav")
    s.voice_jobs = [done, pending]
    release_old_voice(s)
    assert s.voice_jobs == [None, pending]
    loop.close()


class LongStream:
    """Groq falso que não para de falar (pedido de "escreva 3000 palavras")."""

    name = "groq"

    async def stream(self, system, messages, temperature, timeout=15, max_tokens=700):
        yield "calmo\n"
        for _ in range(400):
            yield "Era uma vez uma noite longa, detetive. "

    async def complete(self, system, messages, temperature, timeout=30):
        return '{"answer": "Eu estava no corredor.", "emotion": "calmo"}'


def test_stream_answer_is_capped():
    import json

    from app.main import MAX_ANSWER_CHARS

    app.state.llm = LLMChain([LongStream()], allow_mock=False)
    with TestClient(app) as c:
        case = c.post("/api/cases", json={"library_id": "hotel-aurora"}).json()
        r = c.post(f"/api/cases/{case['case_id']}/interrogate/stream", json={"suspect_id": "rosa", "question": "Conte tudo."})
    del app.state.llm
    done = next(json.loads(l[6:]) for l in r.text.splitlines() if l.startswith("data: ") and '"done"' in l)
    assert MAX_ANSWER_CHARS <= len(done["answer"]) < MAX_ANSWER_CHARS + 120
