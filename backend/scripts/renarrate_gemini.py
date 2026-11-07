"""Regrava a intro dos casos da biblioteca com a voz do Gemini (substitui os MP3 do Kokoro).

Uso (da raiz):  python backend/scripts/renarrate_gemini.py
- Uma chamada de TTS por caso (cota grátis ~10/dia por modelo). Sem cota, para e avisa.
- Casos já regravados ficam em backend/app/library/audio/gemini.json e são pulados.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "scripts"))

from build_library import LIB, to_mp3  # noqa: E402
import httpx  # noqa: E402

from app.audio_split import split_with_words  # noqa: E402
from app.cases import default_prologue  # noqa: E402
from app.schemas import CaseTruth  # noqa: E402
from app.tts import TTS  # noqa: E402

DONE_FILE = LIB / "audio" / "gemini.json"


async def main() -> int:
    done = set(json.loads(DONE_FILE.read_text())) if DONE_FILE.exists() else set()
    async with httpx.AsyncClient(timeout=60) as client:
        tts = TTS(client, os.getenv("GEMINI_API_KEY"), os.getenv("GROQ_API_KEY"), None)
        for path in sorted((LIB / "cases").glob("*.json")):
            if path.stem in done:
                print(f"já com Gemini: {path.stem}")
                continue
            if not tts.gemini_available:
                print("SEM COTA do Google agora; rode de novo amanhã.")
                break
            case = CaseTruth.model_validate_json(path.read_text(encoding="utf-8"))
            lines = [(p.text, p.speaker) for p in (case.prologue or default_prologue(case))]
            print(f"Narrando {case.title} ({len(lines)} falas)...", flush=True)
            audio = await tts._synthesize_intro(lines)
            if not audio:
                print("  ! falhou (cota ou erro); paro aqui.")
                break
            words = await tts._transcribe(audio)
            chunks = split_with_words(audio, [t for t, _ in lines], words)
            for (t, s), chunk in zip(lines, chunks):
                k = tts.key(t, s)
                tts._path(k).write_bytes(chunk)
                to_mp3(chunk, LIB / "audio" / f"{k}.mp3")
            done.add(path.stem)
            DONE_FILE.write_text(json.dumps(sorted(done), indent=2))
            print(f"  ok ({'Whisper' if words else 'pausas'})", flush=True)
    total = len(list((LIB / "cases").glob("*.json")))
    print(f"{len(done)}/{total} casos com voz do Gemini")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
