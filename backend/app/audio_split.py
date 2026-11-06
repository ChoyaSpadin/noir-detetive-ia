"""Corta o áudio da intro inteira (uma chamada de TTS) em uma faixa por fala.

O TTS não devolve marcações de tempo. Então:
1. Estimamos onde cada fala termina pela proporção de caracteres do texto.
2. Achamos os silêncios do áudio (janelas de 20 ms com energia baixa).
3. Para cada fronteira estimada, escolhemos o silêncio mais próximo, dando preferência aos longos
   (a pausa entre falas costuma ser maior que a pausa entre frases da mesma fala).
"""

import array
import difflib
import io
import math
import re
import unicodedata
import wave

FRAME_MS = 20
MIN_GAP_MS = 140


def read_wav(data: bytes) -> tuple[array.array, int]:
    with wave.open(io.BytesIO(data)) as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise ValueError("esperado WAV mono 16 bits")
        samples = array.array("h", w.readframes(w.getnframes()))
        return samples, w.getframerate()


def write_wav(samples: array.array, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


def find_gaps(samples: array.array, rate: int) -> list[tuple[int, int]]:
    """Silêncios como (início, fim) em amostras."""
    frame = max(1, rate * FRAME_MS // 1000)
    energies = []
    for i in range(0, len(samples), frame):
        chunk = samples[i : i + frame]
        energies.append(math.sqrt(sum(x * x for x in chunk) / max(1, len(chunk))))
    if not energies:
        return []
    loud = sorted(energies)[int(len(energies) * 0.9)] or 1.0
    threshold = loud * 0.06  # ~ -24 dB abaixo da fala típica
    gaps: list[tuple[int, int]] = []
    start = None
    for idx, e in enumerate(energies + [loud]):  # sentinela fecha o último silêncio
        if e < threshold:
            if start is None:
                start = idx
        elif start is not None:
            if (idx - start) * FRAME_MS >= MIN_GAP_MS:
                gaps.append((start * frame, min(len(samples), idx * frame)))
            start = None
    return gaps


def choose_cuts(total: int, rate: int, gaps: list[tuple[int, int]], texts: list[str]) -> list[int]:
    """Escolhe len(texts)-1 pausas (em ordem) por programação dinâmica.

    Custo de cada fala: erro relativo entre a duração obtida e a esperada (pelo nº de caracteres).
    Bônus por pausa escolhida: pausas longas costumam separar falas; pausas curtas, frases.
    """
    n = len(texts)
    weights = [max(1, len(t)) for t in texts]
    expected = [total * w / sum(weights) for w in weights]
    cands = [((a + b) // 2, (b - a) / rate) for a, b in gaps]
    if len(cands) < n - 1:
        return []
    ALPHA, BETA = 1.0, 2.2

    def seg_cost(i: int, start: int, end: int) -> float:
        return ALPHA * ((end - start - expected[i]) / expected[i]) ** 2

    inf = float("inf")
    g = len(cands)
    # dp[k][j]: melhor custo usando k cortes, o último na pausa j
    dp = [[inf] * g for _ in range(n)]
    back = [[-1] * g for _ in range(n)]
    for j in range(g):
        dp[1][j] = seg_cost(0, 0, cands[j][0]) - BETA * cands[j][1]
    for k in range(2, n):
        for j in range(g):
            for i in range(j):
                if dp[k - 1][i] == inf:
                    continue
                c = dp[k - 1][i] + seg_cost(k - 1, cands[i][0], cands[j][0]) - BETA * cands[j][1]
                if c < dp[k][j]:
                    dp[k][j], back[k][j] = c, i
    best_j, best = -1, inf
    for j in range(g):
        if dp[n - 1][j] < inf:
            c = dp[n - 1][j] + seg_cost(n - 1, cands[j][0], total)
            if c < best:
                best, best_j = c, j
    if best_j < 0:
        return []
    cuts, k, j = [], n - 1, best_j
    while k >= 1:
        cuts.append(cands[j][0])
        j = back[k][j]
        k -= 1
    return cuts[::-1]


def split_by_lines(data: bytes, texts: list[str]) -> list[bytes]:
    """Divide um WAV com todas as falas em len(texts) WAVs, na ordem."""
    samples, rate = read_wav(data)
    n = len(texts)
    if n <= 1:
        return [data]
    total = len(samples)
    gaps = [g for g in find_gaps(samples, rate) if g[0] > 0 and g[1] < total]
    cuts = choose_cuts(total, rate, gaps, texts)
    if not cuts:  # poucas pausas: corta pela proporção do texto
        weights = [max(1, len(t)) for t in texts]
        acc, cuts = 0, []
        for w in weights[:-1]:
            acc += w
            cuts.append(int(total * acc / sum(weights)))
    bounds = [0, *cuts, total]
    return [write_wav(samples[bounds[i] : bounds[i + 1]], rate) for i in range(n)]


# ---- Alinhamento com transcrição (palavras com tempo, ex.: Whisper) ----


def _norm_words(text: str) -> list[str]:
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9]+", t)


def cuts_from_words(texts: list[str], words: list[tuple[str, float, float]], rate: int) -> list[int] | None:
    """Usa palavras transcritas (palavra, início, fim em s) para achar onde cada fala termina.

    Alinha a sequência de palavras do roteiro com a transcrição (difflib) e corta no meio do
    intervalo entre a última palavra de uma fala e a primeira da seguinte.
    """
    script: list[str] = []
    line_end: list[int] = []  # índice (no roteiro) da última palavra de cada fala
    for t in texts:
        script += _norm_words(t)
        line_end.append(len(script) - 1)
    heard = [w for w, _, _ in words]
    if not script or not heard:
        return None
    sm = difflib.SequenceMatcher(a=script, b=heard, autojunk=False)
    mapping: dict[int, int] = {}
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            mapping[a + k] = b + k
    matched = len(mapping) / len(script)
    if matched < 0.6:  # transcrição muito diferente do roteiro: não confiar
        return None

    def heard_index(script_idx: int, forward: bool) -> int | None:
        rng = range(script_idx, len(script)) if forward else range(script_idx, -1, -1)
        for i in rng:
            if i in mapping:
                return mapping[i]
        return None

    cuts: list[int] = []
    for i in range(len(texts) - 1):
        last = heard_index(line_end[i], forward=False)
        first = heard_index(line_end[i] + 1, forward=True)
        if last is None or first is None or first <= last:
            return None
        t = (words[last][2] + words[first][1]) / 2
        cuts.append(int(t * rate))
    if any(b <= a for a, b in zip(cuts, cuts[1:])):
        return None
    return cuts


def split_with_words(data: bytes, texts: list[str], words: list[tuple[str, float, float]] | None) -> list[bytes]:
    """Como split_by_lines, mas usa a transcrição quando ela bate com o roteiro."""
    samples, rate = read_wav(data)
    cuts = cuts_from_words(texts, words, rate) if words else None
    if not cuts:
        return split_by_lines(data, texts)
    bounds = [0, *cuts, len(samples)]
    return [write_wav(samples[bounds[i] : bounds[i + 1]], rate) for i in range(len(texts))]


def words_from_whisper(payload: dict) -> list[tuple[str, float, float]]:
    """Converte a resposta verbose_json do Whisper em palavras normalizadas com tempo."""
    out: list[tuple[str, float, float]] = []
    for w in payload.get("words", []) or []:
        toks = _norm_words(str(w.get("word", "")))
        a, b = float(w.get("start", 0)), float(w.get("end", 0))
        for k, tk in enumerate(toks):
            out.append((tk, a + (b - a) * k / len(toks), a + (b - a) * (k + 1) / len(toks)))
    return out
