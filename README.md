# Noir: AI Detective

A 3D, mobile-first mystery game where every suspect is an LLM agent. Interrogate them, catch the lie, accuse the killer.

**Highlights:** animated cinematic intro driven by case data (shots + subtitles + browser TTS), rigged CC0 characters dressed at load time, emotion-driven body language, mobile-first.

**Stack:** React Three Fiber · TypeScript · Vite (frontend) — Python · FastAPI · Pydantic (backend) — Gemini / Groq free tiers with automatic fallback.

## How the agents work
- **Case generator:** an LLM writes the hidden "truth" of a new case (culprit, timeline, alibis, clues, secrets). It is validated with Pydantic (exactly one culprit, enough clues held by innocents). Invalid output falls back to a hand-written seed case.
- **Suspect agents:** each suspect only receives its own knowledge and secrets, never the full truth or other suspects' secrets. The culprit lies by design.
- **Guardrails:** confession filter for the culprit, in-character refusal of prompt injection, a question budget per case, and the truth never leaves the server.
- **Offline mode:** without API keys, a rule-based engine plays the seed case, so the game and the tests run for free with no network.

## Voices
- Intro narration: Gemini TTS, one multi-speaker call per case, split per line with Groq Whisper word timestamps.
- Foreign suspects: local [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0). Foreign voices reading Portuguese give a natural accent; English-only suspects must be questioned in English.
- Download the model to `backend/models/`: `kokoro-v1.0.onnx` and `voices-v1.0.bin` from [kokoro-onnx releases](https://github.com/thewh1teagle/kokoro-onnx/releases).

## Run locally
```bash
# backend
cd backend && pip install -r requirements.txt
cp .env.example .env   # optional: add GEMINI_API_KEY and/or GROQ_API_KEY
python -m uvicorn app.main:app --port 8000

# frontend (another terminal)
cd frontend && npm install && npm run dev
```
Open http://localhost:5173. On your phone, use the "Network" URL printed by Vite (same Wi-Fi).

## Tests
```bash
cd backend && python -m pytest -q
```
Covers case validation, truth leakage, prompt isolation between suspects, question limits, the confession guard and the accusation flow.

## Assets
Characters and animations: [Quaternius](https://quaternius.com) Universal Base Characters + Universal Animation Library (CC0). `frontend/scripts/build-assets.mjs` trims and compresses them (188 MB → 1.5 MB: WebP textures, meshopt, only used clips).

## Roadmap
1. ~~MVP: one scene, 3 suspects, chat, accusation~~
2. ~~Visuals: rigged/animated characters, animated intro, camera cuts~~ (next: clothing with real volume)
3. Quality: consistency evals for generated cases, response cache, Supabase persistence, deploy
4. Voice interrogation
