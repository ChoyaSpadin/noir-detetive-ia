"""Voz local e ilimitada (Kokoro-82M, Apache 2.0): suspeitos e reserva da intro.

O Kokoro em português soa estrangeiro, então ele vira característica: vozes de outros idiomas
lendo em pt-BR dão sotaque; gringos que só falam inglês usam a voz em inglês (a melhor dele).
Roda em CPU (~tempo real com o modelo fp32). Sem os arquivos do modelo, fica desligado.
"""

import asyncio
import io
import logging
import os
import re
import threading
from pathlib import Path

log = logging.getLogger(__name__)

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
MODEL = MODEL_DIR / "kokoro-v1.0.onnx"
VOICES_FILE = MODEL_DIR / "voices-v1.0.bin"

# nacionalidade -> (voz masculina, voz feminina, idioma do inglês nativo)
VOICE_BY_NATIONALITY: dict[str, tuple[str, str, str]] = {
    "americano": ("am_michael", "af_heart", "en-us"),
    "inglês": ("bm_george", "bf_emma", "en-gb"),
    "italiano": ("im_nicola", "if_sara", "pt-br"),
    "francês": ("bm_lewis", "ff_siwis", "pt-br"),  # não há voz masculina francesa
    "espanhol": ("em_alex", "ef_dora", "pt-br"),
    "japonês": ("jm_kumo", "jf_alpha", "pt-br"),
}


# Vozes brasileiras do Kokoro (só 3). Para diferenciar suspeitos do mesmo gênero, alternamos a voz
# e mudamos um pouco a velocidade.
BR_MALE = [("pm_alex", 1.0), ("pm_santa", 0.95), ("pm_alex", 0.9)]
BR_FEMALE = [("pf_dora", 1.0), ("pf_dora", 0.9), ("pf_dora", 1.08)]
# Intro quando o Google estiver sem cota.
INTRO_VOICES = {"narrador": ("pm_santa", 0.92), "policial": ("pm_alex", 0.98)}

VoiceSpec = tuple[str, str, float]  # (voz, idioma, velocidade)


def voice_for(nationality: str | None, female: bool, speaks_portuguese: bool, slot: int = 0) -> VoiceSpec:
    """Voz do suspeito. slot = posição dele entre os do mesmo tipo, para não repetir a mesma voz."""
    if nationality in VOICE_BY_NATIONALITY:
        male_v, female_v, native = VOICE_BY_NATIONALITY[nationality]
        lang = native if not speaks_portuguese else "pt-br"
        return (female_v if female else male_v), lang, 1.0
    voice, speed = (BR_FEMALE if female else BR_MALE)[slot % 3]
    return voice, "pt-br", speed


class KokoroVoice:
    def __init__(self) -> None:
        self.enabled = MODEL.exists() and VOICES_FILE.exists() and not os.getenv("KOKORO_DISABLED")
        self._model = None
        self._load_lock = threading.Lock()
        self._run_lock = threading.Lock()  # uma sessão ONNX, uma geração por vez
        self._urgent = 0  # respostas do interrogatório esperando: o fundo (intro) cede a vez
        self._urgent_lock = threading.Lock()

    def _load(self):
        with self._load_lock:
            if self._model is None:
                from kokoro_onnx import Kokoro  # import pesado: só quando usado

                self._model = Kokoro(str(MODEL), str(VOICES_FILE))
                log.warning("Kokoro carregado")
        return self._model

    def hold(self, on: bool) -> None:
        """Prioridade para uma resposta inteira (entre um trecho e outro a intro não entra)."""
        with self._urgent_lock:
            self._urgent += 1 if on else -1

    def warm_up(self) -> None:
        """Carrega o modelo em segundo plano (leva ~5 s), para a 1ª fala não esperar."""
        if self.enabled:
            threading.Thread(target=self._load, daemon=True).start()

    def _synth_sync(self, text: str, voice: str, lang: str, speed: float = 1.0, urgent: bool = True) -> bytes:
        import soundfile as sf
        import time

        model = self._load()
        available = set(model.get_voices())
        if voice not in available:
            voice = "am_michael" if lang.startswith("en") else "pm_alex"
        if urgent:
            with self._urgent_lock:
                self._urgent += 1
            try:
                with self._run_lock:
                    audio, rate = model.create(text, voice=voice, lang=lang, speed=speed)
            finally:
                with self._urgent_lock:
                    self._urgent -= 1
        else:
            # Fundo (intro): frase por frase, cedendo a vez entre elas. Assim uma fala longa
            # da intro nunca segura o modelo por vários segundos enquanto o jogador espera.
            import numpy as np

            parts = []
            rate = 24000
            for sentence in re.split(r"(?<=[.!?…])\s+", text.strip()) or [text]:
                if not sentence:
                    continue
                while self._urgent > 0:
                    time.sleep(0.05)
                with self._run_lock:
                    a, rate = model.create(sentence, voice=voice, lang=lang, speed=speed)
                parts.append(a)
                parts.append(np.zeros(int(rate * 0.12), dtype=a.dtype))  # pausa curta entre frases
            audio = np.concatenate(parts[:-1]) if parts else np.zeros(1, dtype="float32")
        buf = io.BytesIO()
        sf.write(buf, audio, rate, format="WAV", subtype="PCM_16")
        return buf.getvalue()

    async def synth(self, text: str, voice: str, lang: str, speed: float = 1.0, urgent: bool = True) -> bytes | None:
        """urgent=False para trabalho de fundo (intro pré-gerada): cede a vez às respostas."""
        if not self.enabled:
            return None
        try:
            return await asyncio.to_thread(self._synth_sync, text, voice, lang, speed, urgent)
        except Exception:  # voz é enfeite: falha não pode derrubar o interrogatório
            log.exception("Kokoro falhou")
            return None
