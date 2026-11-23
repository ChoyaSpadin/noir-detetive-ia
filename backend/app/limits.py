"""Limites contra abuso: por IP (janela de 1 h) e orçamento global por dia.

O jogo roda em cotas grátis (Groq/Gemini) e numa voz paga com teto (Modal). Sem limite,
um script repetindo "caso inédito" ou o microfone esgota tudo e o site fica mudo para quem
chega depois. Em memória: o servidor é um processo só (Render grátis).
"""

import os
import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import HTTPException, Request


def _env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


# ação -> (máximo por IP por hora, máximo global por dia). 0 = sem limite.
DEFAULTS: dict[str, tuple[int, int]] = {
    "case_ai": (4, 40),  # caso inédito: ~4 chamadas grandes de LLM cada
    "case_library": (40, 0),  # caso pronto: não gasta IA
    "question": (90, 2500),  # perguntas (cada caso já limita as suas)
    "transcribe": (90, 2500),  # microfone (Whisper do Groq)
}


def limits_from_env() -> dict[str, tuple[int, int]]:
    out = {}
    for action, (per_ip, per_day) in DEFAULTS.items():
        key = action.upper()
        out[action] = (_env(f"LIMIT_{key}_PER_HOUR", per_ip), _env(f"LIMIT_{key}_PER_DAY", per_day))
    return out


def client_ip(request: Request) -> str:
    """IP real atrás do proxy do Render (o 1º do X-Forwarded-For é o cliente)."""
    for header in ("cf-connecting-ip", "true-client-ip"):
        if value := request.headers.get(header):
            return value.strip()
    if xff := request.headers.get("x-forwarded-for"):
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "?"


@dataclass
class RateLimiter:
    limits: dict[str, tuple[int, int]] = field(default_factory=limits_from_env)
    _hits: dict[tuple[str, str], deque] = field(default_factory=dict)
    _day: dict[str, tuple[int, int]] = field(default_factory=dict)  # ação -> (dia, contagem)
    clock: callable = time.time

    def check(self, action: str, ip: str) -> None:
        """Conta um uso ou levanta 429 com mensagem para o jogador."""
        per_ip, per_day = self.limits.get(action, (0, 0))
        now = self.clock()
        if per_ip:
            q = self._hits.setdefault((action, ip), deque())
            while q and now - q[0] > 3600:
                q.popleft()
            if len(q) >= per_ip:
                wait = int(3600 - (now - q[0])) // 60 + 1
                raise HTTPException(429, f"Muitos pedidos seguidos. Tente de novo em {wait} min.")
        if per_day:
            day = int(now // 86400)
            d, count = self._day.get(action, (day, 0))
            if d != day:
                count = 0
            if count >= per_day:
                raise HTTPException(503, "O limite diário do servidor grátis acabou. Volte amanhã.")
            self._day[action] = (day, count + 1)
        if per_ip:
            q.append(now)
        if len(self._hits) > 5000:  # não deixa a memória crescer com IPs antigos
            for k in [k for k, v in self._hits.items() if not v or now - v[-1] > 3600]:
                del self._hits[k]

    def refund(self, action: str) -> None:
        """Devolve um uso do orçamento diário (ex.: a IA falhou e nada foi gasto)."""
        if action in self._day:
            d, count = self._day[action]
            self._day[action] = (d, max(0, count - 1))
