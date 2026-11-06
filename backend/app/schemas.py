"""Modelos de dados. A "verdade" do caso nunca sai do backend; o cliente só vê os modelos Public*."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Emotion = Literal["calmo", "nervoso", "irritado", "triste", "evasivo"]
EMOTIONS: tuple[str, ...] = ("calmo", "nervoso", "irritado", "triste", "evasivo")
# Estrangeiros: voz Kokoro com sotaque. "americano"/"inglês" podem não falar português.
Nationality = Literal["americano", "inglês", "italiano", "francês", "espanhol", "japonês"]


class SuspectLook(BaseModel):
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    accent: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    hat: bool = False
    height: float = Field(default=1.0, ge=0.85, le=1.15)
    # Corpo do personagem 3D. Opcional para casos antigos; o frontend deduz pelo nome se faltar.
    gender: Literal["feminino", "masculino"] | None = None


class SuspectPrivate(BaseModel):
    """Tudo que o agente do suspeito sabe. Só o próprio agente recebe isto."""

    id: str
    name: str
    role: str
    description: str  # pública: aparência e primeira impressão
    look: SuspectLook
    personality: str
    relationship: str  # relação com a vítima, na versão que ele conta
    alibi_claim: str  # o que ele diz que fazia na hora do crime
    alibi_truth: str  # o que ele realmente fazia
    knowledge: list[str] = Field(min_length=1)  # fatos que pode contar (incluem pistas)
    secrets: list[str] = Field(default_factory=list)  # esconde até ser pressionado
    is_culprit: bool = False
    nationality: Nationality | None = None  # None = brasileiro
    speaks_portuguese: bool = True  # False: só entende e responde em inglês

    @model_validator(mode="after")
    def only_english_speakers_lack_portuguese(self) -> "SuspectPrivate":
        if not self.speaks_portuguese and self.nationality not in ("americano", "inglês"):
            self.speaks_portuguese = True  # só gringo anglófono pode não falar português
        return self


PrologueShot = Literal["establishing", "crime", "arrival", "officer", "suspect"]


class PrologueLine(BaseModel):
    shot: PrologueShot
    speaker: Literal["narrador", "policial"]
    text: str = Field(min_length=1, max_length=280)
    suspect_id: str | None = None


class Victim(BaseModel):
    name: str
    description: str


class CaseTruth(BaseModel):
    title: str
    setting: str
    intro: str
    victim: Victim
    culprit_id: str
    method: str
    motive: str
    timeline: list[str] = Field(min_length=2)
    solution: str  # explicação mostrada no veredito
    suspects: list[SuspectPrivate] = Field(min_length=3, max_length=3)
    officer_name: str = "Sargento Moreira"
    prologue: list[PrologueLine] = Field(default_factory=list, max_length=16)

    @field_validator("suspects")
    @classmethod
    def unique_ids(cls, v: list[SuspectPrivate]) -> list[SuspectPrivate]:
        if len({s.id for s in v}) != len(v):
            raise ValueError("ids de suspeitos repetidos")
        return v

    @model_validator(mode="after")
    def exactly_one_culprit(self) -> "CaseTruth":
        culprits = [s for s in self.suspects if s.is_culprit]
        if len(culprits) != 1 or culprits[0].id != self.culprit_id:
            raise ValueError("o caso precisa de exatamente um culpado, igual a culprit_id")
        # Solucionável: os inocentes precisam saber pelo menos 2 fatos no total.
        innocent_facts = sum(len(s.knowledge) for s in self.suspects if not s.is_culprit)
        if innocent_facts < 2:
            raise ValueError("pistas insuficientes nos inocentes")
        ids = {s.id for s in self.suspects}
        for line in self.prologue:
            if line.shot == "suspect" and line.suspect_id not in ids:
                raise ValueError("prólogo cita suspeito inexistente")
        if self.prologue_leaks():
            raise ValueError("prólogo revela o culpado")
        return self

    def prologue_leaks(self) -> bool:
        """A intro é pública: não pode citar o culpado como culpado nem trechos da verdade."""
        text = " ".join(line.text.lower() for line in self.prologue)
        culprit = self.suspect(self.culprit_id)
        truth = [culprit.alibi_truth.lower(), *[x.lower() for x in culprit.secrets]] if culprit else []
        return "culpad" in text or any(t[:40] in text for t in truth if len(t) >= 40)

    def suspect(self, suspect_id: str) -> SuspectPrivate | None:
        return next((s for s in self.suspects if s.id == suspect_id), None)


# ---- API pública ----


class PublicSuspect(BaseModel):
    id: str
    name: str
    role: str
    description: str
    look: SuspectLook
    nationality: Nationality | None = None
    speaks_portuguese: bool = True


class PublicCase(BaseModel):
    case_id: str
    officer_name: str
    prologue: list[PrologueLine]
    title: str
    setting: str
    intro: str
    victim: Victim
    suspects: list[PublicSuspect]
    max_questions: int
    questions_left: int


class InterrogateRequest(BaseModel):
    suspect_id: str = Field(max_length=40)
    question: str = Field(min_length=1, max_length=300)


class InterrogateResponse(BaseModel):
    answer: str
    emotion: Emotion
    questions_left: int
    provider: str
    audio_url: str | None = None  # 1ª frase falada (compatibilidade)
    audio_urls: list[str] = Field(default_factory=list)  # fala frase por frase (Kokoro)


class AccuseRequest(BaseModel):
    suspect_id: str = Field(max_length=40)
    reasoning: str = Field(default="", max_length=1000)


class AccuseResponse(BaseModel):
    correct: bool
    culprit_id: str
    culprit_name: str
    explanation: str
