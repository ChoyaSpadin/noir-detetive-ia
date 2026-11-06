"""Sessões de jogo em memória (MVP). Fase 3: trocar por Supabase."""

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from .llm import Message
from .schemas import CaseTruth

SESSION_TTL_S = 6 * 3600
MAX_SESSIONS = 500


@dataclass
class GameSession:
    case: CaseTruth
    case_source: str
    max_questions: int
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created: float = field(default_factory=time.time)
    questions_used: int = 0
    finished: bool = False
    histories: dict[str, list[Message]] = field(default_factory=dict)
    offline_state: dict[str, dict[str, int]] = field(default_factory=dict)
    voice_jobs: list["asyncio.Future[bytes | None]"] = field(default_factory=list)  # falas Kokoro (por frase)

    @property
    def questions_left(self) -> int:
        return max(0, self.max_questions - self.questions_used)


class SessionStore:
    def __init__(self) -> None:
        self._items: dict[str, GameSession] = {}

    def add(self, session: GameSession) -> None:
        self._purge()
        if len(self._items) >= MAX_SESSIONS:
            oldest = min(self._items.values(), key=lambda s: s.created)
            del self._items[oldest.id]
        self._items[session.id] = session

    def get(self, session_id: str) -> GameSession | None:
        s = self._items.get(session_id)
        if s and time.time() - s.created > SESSION_TTL_S:
            del self._items[session_id]
            return None
        return s

    def _purge(self) -> None:
        now = time.time()
        for sid in [k for k, s in self._items.items() if now - s.created > SESSION_TTL_S]:
            del self._items[sid]
