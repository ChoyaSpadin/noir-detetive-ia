"""Cadeia de provedores de LLM gratuitos com fallback: Gemini -> Groq -> (opcional) modo offline."""

import asyncio
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

log = logging.getLogger(__name__)

Message = dict[str, str]  # {"role": "user" | "assistant", "text": "..."}


class Provider(Protocol):
    name: str

    async def complete(self, system: str, messages: list[Message], temperature: float, timeout: float = 30) -> str: ...


def parse_json(text: str) -> dict[str, Any]:
    """Aceita JSON puro ou dentro de bloco ```json ... ```."""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("resposta não é um objeto JSON")
    return data


@dataclass
class GeminiProvider:
    api_key: str
    model: str
    client: httpx.AsyncClient
    name: str = "gemini"

    async def complete(self, system: str, messages: list[Message], temperature: float, timeout: float = 30) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [
                {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["text"]}]}
                for m in messages
            ],
            "generationConfig": {"responseMimeType": "application/json", "temperature": temperature},
        }
        r = await self.client.post(url, json=body, headers={"x-goog-api-key": self.api_key}, timeout=timeout)
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def _retry_after(exc: httpx.HTTPStatusError) -> float:
    try:
        return float(exc.response.headers.get("retry-after", "0") or 0)
    except ValueError:
        return 0.0


@dataclass
class GroqProvider:
    """Groq com modelos de reserva: cada modelo tem a própria cota por minuto (8k tokens no grátis).

    Se o principal bater o limite (429), tenta o próximo na hora, em vez de cair para o Gemini.
    """

    api_key: str
    model: str
    client: httpx.AsyncClient
    name: str = "groq"
    fallbacks: tuple[str, ...] = ()
    _cooldown: dict[str, float] = field(default_factory=dict)  # modelo -> até quando está no limite
    last_model: str = ""  # modelo que respondeu por último (diagnóstico e evals)

    URL = "https://api.groq.com/openai/v1/chat/completions"

    def _models(self) -> list[str]:
        now = time.monotonic()
        models = [self.model, *self.fallbacks]
        free = [m for m in models if self._cooldown.get(m, 0) <= now]
        return free or models  # todos no limite: tenta assim mesmo

    def _rate_limited(self, model: str, exc: httpx.HTTPStatusError) -> bool:
        if exc.response.status_code != 429:
            return False
        self._cooldown[model] = time.monotonic() + max(_retry_after(exc), 5)
        log.warning("Groq %s no limite; tentando o próximo modelo", model)
        return True

    def _body(self, model: str, system: str, messages: list[Message], temperature: float) -> dict:
        body: dict[str, Any] = {
            "model": model,
            "temperature": temperature,
            "messages": [{"role": "system", "content": system}]
            + [{"role": m["role"], "content": m["text"]} for m in messages],
        }
        # Modelos que "pensam" antes de responder: pensar pouco corta latência sem perder qualidade aqui.
        if "gpt-oss" in model:
            body["reasoning_effort"] = "low"
        elif "qwen" in model:
            body["reasoning_effort"] = "none"
        return body

    async def complete(self, system: str, messages: list[Message], temperature: float, timeout: float = 30) -> str:
        models = self._models()
        for i, model in enumerate(models):
            body = {**self._body(model, system, messages, temperature), "response_format": {"type": "json_object"}}
            try:
                r = await self.client.post(
                    self.URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"}, timeout=timeout
                )
                r.raise_for_status()
                self.last_model = model
                return r.json()["choices"][0]["message"]["content"]
            except httpx.HTTPStatusError as exc:
                if i == len(models) - 1 or not self._rate_limited(model, exc):
                    raise
        raise RuntimeError("sem modelos")  # inalcançável

    async def stream(self, system: str, messages: list[Message], temperature: float, timeout: float = 15):
        """Texto em pedaços conforme o modelo escreve (texto livre, sem JSON)."""
        models = self._models()
        for i, model in enumerate(models):
            body = {**self._body(model, system, messages, temperature), "stream": True}
            try:
                async with self.client.stream(
                    "POST", self.URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"}, timeout=timeout
                ) as r:
                    if r.status_code == 429:
                        await r.aread()
                    r.raise_for_status()
                    self.last_model = model
                    async for line in r.aiter_lines():
                        if not line.startswith("data: ") or line.strip() == "data: [DONE]":
                            continue
                        try:
                            delta = json.loads(line[6:])["choices"][0]["delta"].get("content")
                        except (ValueError, KeyError, IndexError):
                            continue
                        if delta:
                            yield delta
                    return
            except httpx.HTTPStatusError as exc:  # 429 chega antes de qualquer texto
                if i == len(models) - 1 or not self._rate_limited(model, exc):
                    raise


class LLMChain:
    def __init__(self, providers: list[Provider], allow_mock: bool = True):
        self.providers = providers
        self.allow_mock = allow_mock

    def has_real_provider(self) -> bool:
        return bool(self.providers)

    async def complete_json(
        self,
        system: str,
        messages: list[Message],
        temperature: float = 0.8,
        prefer: str | None = None,
        patient: bool = False,
        timeout: float = 30,
    ) -> tuple[dict[str, Any], str]:
        """Tenta cada provedor em ordem (prefer vai primeiro). Levanta RuntimeError se todos falharem."""
        errors: list[str] = []
        order = sorted(self.providers, key=lambda p: p.name != prefer) if prefer else self.providers
        for p in order:
            try:
                try:
                    text = await p.complete(system, messages, temperature, timeout)
                except httpx.HTTPStatusError as exc:
                    # Limite por minuto (ex.: Groq 8k tokens/min): em tarefas de fundo, espera e tenta 1x.
                    wait = float(exc.response.headers.get("retry-after", "0") or 0)
                    if not (patient and exc.response.status_code == 429 and 0 < wait <= 30):
                        raise
                    log.warning("Provedor %s no limite; esperando %.0f s", p.name, wait)
                    await asyncio.sleep(wait + 0.5)
                    text = await p.complete(system, messages, temperature, timeout)
                return parse_json(text), p.name
            except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
                log.warning("Provedor %s falhou: %s", p.name, exc)
                errors.append(f"{p.name}: {type(exc).__name__}")
        raise RuntimeError("todos os provedores falharam: " + ", ".join(errors) if errors else "sem provedores")


def build_chain_from_env(client: httpx.AsyncClient) -> LLMChain:
    providers: list[Provider] = []
    if key := os.getenv("GEMINI_API_KEY"):
        providers.append(GeminiProvider(key, os.getenv("GEMINI_MODEL", "gemini-3.8-flash"), client))
    if key := os.getenv("GROQ_API_KEY"):
        fallbacks = os.getenv("GROQ_FALLBACK_MODELS", "qwen/qwen3.8-27b,openai/gpt-oss-20b")
        providers.append(
            GroqProvider(
                key,
                os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
                client,
                fallbacks=tuple(m.strip() for m in fallbacks.split(",") if m.strip()),
            )
        )
    allow_mock = os.getenv("ALLOW_OFFLINE", "true").lower() != "false"
    return LLMChain(providers, allow_mock=allow_mock)
