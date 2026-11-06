"""Monta o arquivo de casos prontos (biblioteca) com a intro já narrada.

Por que: no ar, o servidor grátis "dorme". Com casos prontos, a tela de escolha abre na hora
(os dados públicos vão junto do site) e a intro toca de arquivos MP3, sem gastar cota de IA.

Uso (da raiz do projeto):  python backend/scripts/build_library.py --novos 5
- Gera N casos novos pela IA (com temas variados) + inclui o caso fixo do Hotel Aurora.
- Grava a verdade de cada caso em backend/app/library/cases/<id>.json (fica no servidor).
- Narra a intro (Gemini multi-falante; sem cota, Kokoro local) e salva em MP3 em
  backend/app/library/audio/<chave>.mp3 (a mesma chave de cache do TTS).
- Grava os dados públicos (sem culpado nem segredos) em frontend/src/data/caseLibrary.json.
Precisa do ffmpeg no PATH (WAV -> MP3).
"""

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / "backend" / ".env")

import httpx  # noqa: E402

from app.cases import GENERATOR_PROMPT, SEED_CASE, default_prologue, seed_case  # noqa: E402
from app.kokoro_voice import KokoroVoice  # noqa: E402
from app.llm import build_chain_from_env  # noqa: E402
from app.schemas import CaseTruth  # noqa: E402
from app.tts import TTS  # noqa: E402

LIB = ROOT / "backend" / "app" / "library"
PUBLIC_JSON = ROOT / "frontend" / "src" / "data" / "caseLibrary.json"

# Temas para variar época, lugar e clima (o gerador sozinho tende a repetir hotel/cassino).
THEMES = [
    "um trem noturno de luxo entre São Paulo e o Rio, anos 1950",
    "uma rádio AM em Porto Alegre durante um programa ao vivo, 1947",
    "um navio cargueiro ancorado no porto de Santos, 1962",
    "um teatro de revista no centro do Rio, noite de estreia, 1954",
    "uma fazenda de café isolada pela chuva no interior de Minas, 1938",
    "um observatório astronômico na serra, noite de eclipse, 1971",
    "uma joalheria em Salvador durante o Carnaval, 1966",
    "um clube de jazz em Belo Horizonte, madrugada de nevoeiro, 1958",
]


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:40]


def public_entry(case_id: str, case: CaseTruth) -> dict:
    """Só o que o jogador pode ver antes de abrir o caso."""
    return {
        "id": case_id,
        "title": case.title,
        "setting": case.setting,
        "intro": case.intro,
        "victim": case.victim.name,
        "suspects": [
            {"name": s.name, "role": s.role, "nationality": s.nationality, "speaks_portuguese": s.speaks_portuguese}
            for s in case.suspects
        ],
    }


FOREIGN_HINTS = [
    " Inclua UM suspeito INOCENTE americano que só fala inglês (nationality \"americano\", speaks_portuguese false).",
    " Inclua UM suspeito INOCENTE estrangeiro (italiano ou francês) que fala português com sotaque.",
]


async def generate(llm, theme: str) -> CaseTruth | None:
    for prefer in ("groq", "gemini"):
        try:
            data, _ = await llm.complete_json(
                GENERATOR_PROMPT + json.dumps(SEED_CASE, ensure_ascii=False),
                [{"role": "user", "text": f"Crie um caso novo, com TODAS as chaves do exemplo. Ambientação: {theme}."}],
                temperature=1.0,
                prefer=prefer,
                patient=True,
                timeout=90,
            )
            return CaseTruth.model_validate(data)
        except Exception as exc:  # noqa: BLE001 - script: tenta o próximo provedor
            print(f"  ! caso inválido ({prefer}): {str(exc).splitlines()[0][:160]}")
    return None


def to_mp3(wav: bytes, out: Path) -> None:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(wav)
        tmp = f.name
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", tmp, "-ac", "1", "-b:a", "64k", str(out)],
            check=True,
        )
    finally:
        os.unlink(tmp)


async def narrate(tts: TTS, case: CaseTruth) -> int:
    lines = [(p.text, p.speaker) for p in (case.prologue or default_prologue(case))]
    (LIB / "audio").mkdir(parents=True, exist_ok=True)
    todo = [(t, s) for t, s in lines if not (LIB / "audio" / f"{tts.key(t, s)}.mp3").exists()]
    if not todo:
        return 0
    tts.prefetch_intro(lines)
    done = 0
    for t, s in todo:
        wav = await tts.get(t, s)
        if wav:
            to_mp3(wav, LIB / "audio" / f"{tts.key(t, s)}.mp3")
            done += 1
        else:
            print(f"  ! sem voz para: {t[:60]}")
    return done


async def main(novos: int, estrangeiro: bool) -> None:
    (LIB / "cases").mkdir(parents=True, exist_ok=True)
    os.environ.pop("KOKORO_DISABLED", None)
    kokoro = KokoroVoice()
    async with httpx.AsyncClient(timeout=60) as client:
        llm = build_chain_from_env(client)
        tts = TTS(client, os.getenv("GEMINI_API_KEY"), os.getenv("GROQ_API_KEY"), kokoro)

        existing = sorted((LIB / "cases").glob("*.json"))
        if not (LIB / "cases" / "hotel-aurora.json").exists():
            (LIB / "cases" / "hotel-aurora.json").write_text(
                seed_case().model_dump_json(indent=2), encoding="utf-8"
            )
        used = {json.loads(p.read_text(encoding="utf-8"))["title"] for p in existing}
        # Com --estrangeiro, começa pelos últimos temas (os primeiros já foram usados na 1ª rodada).
        themes = list(reversed(THEMES)) if estrangeiro else list(THEMES)
        made = 0
        for theme in themes:
            if made >= novos:
                break
            print(f"Gerando: {theme}")
            hint = FOREIGN_HINTS[made % len(FOREIGN_HINTS)] if estrangeiro else ""
            case = await generate(llm, theme + "." + hint)
            if case is not None and estrangeiro and not any(s.nationality and not s.is_culprit for s in case.suspects):
                print("  ! veio sem estrangeiro inocente; descartado")
                continue
            if case is None or case.title in used:
                continue
            case_id = slug(case.title)
            (LIB / "cases" / f"{case_id}.json").write_text(case.model_dump_json(indent=2), encoding="utf-8")
            used.add(case.title)
            made += 1
            print(f"  ok: {case.title} ({case_id})")

        index = []
        for path in sorted((LIB / "cases").glob("*.json")):
            case = CaseTruth.model_validate_json(path.read_text(encoding="utf-8"))
            n = await narrate(tts, case)
            print(f"Intro de {case.title}: {n} falas novas em MP3")
            index.append(public_entry(path.stem, case))

    PUBLIC_JSON.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_JSON.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(index)} casos na biblioteca -> {PUBLIC_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--novos", type=int, default=5, help="quantos casos novos gerar pela IA")
    ap.add_argument("--estrangeiro", action="store_true", help="exigir um suspeito estrangeiro inocente")
    a = ap.parse_args()
    asyncio.run(main(a.novos, a.estrangeiro))
