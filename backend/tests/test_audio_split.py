import array
import io
import math
import wave

from app.audio_split import read_wav, split_by_lines, write_wav

RATE = 24000


def tone(seconds: float, freq: float = 220.0) -> list[int]:
    n = int(RATE * seconds)
    return [int(8000 * math.sin(2 * math.pi * freq * i / RATE)) for i in range(n)]


def silence(seconds: float) -> list[int]:
    return [0] * int(RATE * seconds)


def build(parts: list[list[int]]) -> bytes:
    samples = array.array("h", [x for p in parts for x in p])
    return write_wav(samples, RATE)


def durations(chunks: list[bytes]) -> list[float]:
    return [len(read_wav(c)[0]) / RATE for c in chunks]


def test_splits_on_long_pauses_between_lines():
    # 3 falas; a 2ª tem uma pausa curta interna (entre frases) que não deve virar corte.
    audio = build([
        tone(2.0), silence(0.7),
        tone(1.2), silence(0.25), tone(1.6), silence(0.7),
        tone(1.5),
    ])
    texts = ["a" * 40, "b" * 55, "c" * 30]
    chunks = split_by_lines(audio, texts)
    assert len(chunks) == 3
    d = durations(chunks)
    assert abs(d[0] - 2.35) < 0.2  # 2,0 s de fala + metade da pausa
    assert abs(d[1] - 3.75) < 0.25
    assert abs(d[2] - 1.85) < 0.2


def test_without_pauses_falls_back_to_text_proportion():
    audio = build([tone(6.0)])
    chunks = split_by_lines(audio, ["x" * 10, "y" * 20])
    d = durations(chunks)
    assert abs(d[0] - 2.0) < 0.05 and abs(d[1] - 4.0) < 0.05


def test_single_line_is_untouched():
    audio = build([tone(1.0)])
    assert split_by_lines(audio, ["só uma"]) == [audio]


def test_output_is_valid_wav():
    audio = build([tone(1.0), silence(0.6), tone(1.0)])
    for c in split_by_lines(audio, ["um", "dois"]):
        with wave.open(io.BytesIO(c)) as w:
            assert w.getframerate() == RATE and w.getnchannels() == 1


def test_one_call_per_intro_pipeline(tmp_path, monkeypatch):
    """A intro inteira sai em UMA chamada de TTS e vira um arquivo por fala no cache."""
    import asyncio

    import httpx

    from app import tts as tts_mod

    monkeypatch.setattr(tts_mod, "CACHE_DIR", tmp_path)
    lines = [("Rio, 1952. Chovia.", "narrador"), ("Detetive, finalmente.", "policial"), ("A sala é sua.", "policial")]
    audio = build([tone(1.5), silence(0.6), tone(1.2), silence(0.6), tone(1.0)])
    # palavras com tempo, como o Whisper devolveria
    words = [("rio", 0.0, 0.4), ("1952", 0.4, 1.0), ("chovia", 1.0, 1.5),
             ("detetive", 2.1, 2.8), ("finalmente", 2.8, 3.3),
             ("a", 3.9, 4.0), ("sala", 4.0, 4.4), ("e", 4.4, 4.5), ("sua", 4.5, 4.9)]
    calls = {"tts": 0}

    async def run():
        async with httpx.AsyncClient() as client:
            t = tts_mod.TTS(client, "fake-key", "fake-groq")

            async def fake_synth(ls):
                calls["tts"] += 1
                assert ls == lines
                return audio

            async def fake_transcribe(_):
                return words

            t._synthesize_intro = fake_synth  # type: ignore[method-assign]
            t._transcribe = fake_transcribe  # type: ignore[method-assign]
            t.prefetch_intro(lines)
            outs = [await t.get(text, sp) for text, sp in lines]
            t.prefetch_intro(lines)  # tudo em cache: não chama de novo
            return t, outs

    t, outs = asyncio.run(run())
    assert calls["tts"] == 1
    assert all(o for o in outs)
    d = durations(outs)
    assert abs(d[0] - 1.8) < 0.2 and abs(d[1] - 1.8) < 0.25 and abs(d[2] - 1.3) < 0.25
    body = t.request_body(lines)
    cfg = body["generationConfig"]["speechConfig"]["multiSpeakerVoiceConfig"]["speakerVoiceConfigs"]
    assert {c["speaker"] for c in cfg} == {"Narrador", "Sargento"}
    parts = body["contents"][0]["parts"]
    assert parts[0] == {"text": "Rio, 1952. Chovia.", "speechMetadata": {"speaker": "Narrador"}}
    assert parts[1]["speechMetadata"]["speaker"] == "Sargento"


def test_intro_falls_back_to_kokoro_when_google_has_no_quota(tmp_path, monkeypatch):
    import asyncio
    import time

    import httpx

    from app import tts as tts_mod

    monkeypatch.setattr(tts_mod, "CACHE_DIR", tmp_path)
    lines = [("Rio, 1952.", "narrador"), ("Detetive, finalmente.", "policial")]
    spoken = []

    class FakeKokoro:
        enabled = True

        async def synth(self, text, voice, lang, speed=1.0, urgent=True):
            spoken.append((text, voice, lang))
            return build([tone(0.5)])

    async def run():
        async with httpx.AsyncClient() as client:
            t = tts_mod.TTS(client, "fake-key", None, FakeKokoro())
            for m in tts_mod.MODELS:  # Google sem cota
                t._blocked_until[m] = time.time() + 3600
            assert not t.gemini_available and t.available
            t.prefetch_intro(lines)
            return [await t.get(text, sp) for text, sp in lines]

    outs = asyncio.run(run())
    assert all(outs)
    assert [v for _, v, _ in spoken] == ["pm_santa", "pm_alex"]
