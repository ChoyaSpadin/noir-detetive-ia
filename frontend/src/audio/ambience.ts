// Áudio procedural via Web Audio API (chuva contínua e trovões). Zero arquivos externos.

const MUTE_STORAGE_KEY = 'noir-muted'
const VOLUME_STORAGE_KEY = 'noir-volume'

const CUTSCENE_RAIN_GAIN = 0.11
const GAME_RAIN_GAIN = 0.042

let mutedState: boolean = loadInitialMuted()
let volumeState: number = loadInitialVolume()
const listeners = new Set<() => void>()

function loadInitialVolume(): number {
  if (typeof window === 'undefined') return 0.8
  try {
    const v = Number(window.localStorage.getItem(VOLUME_STORAGE_KEY))
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8
  } catch {
    return 0.8
  }
}

/** Volume efetivo (0 a 1) para voz e ambiente. */
export function getVolume(): number {
  return mutedState ? 0 : volumeState
}

/** Volume escolhido no controle, mesmo quando está no mudo. */
export function getVolumeSetting(): number {
  return volumeState
}

export function setVolume(volume: number): void {
  volumeState = Math.min(1, Math.max(0, volume))
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volumeState))
  } catch {
    /* ignore */
  }
  // Arrastar o volume para cima tira do mudo; para zero, equivale ao mudo.
  if (volumeState > 0 && mutedState) setMuted(false)
  else applyMaster()
}

/** Avisa a interface e a voz quando o som muda. Retorna a função para cancelar. */
export function onSoundChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

let ducked = false // microfone gravando: chuva e trovão calam (senão o navegador apaga a voz como "eco")

function applyMaster(): void {
  if (audioCtx && masterGain) masterGain.gain.setTargetAtTime(ducked ? 0 : getVolume(), audioCtx.currentTime, 0.06)
  listeners.forEach((cb) => cb())
}

/** Cala o som ambiente enquanto o detetive fala no microfone. */
export function duckAmbience(on: boolean): void {
  ducked = on
  if (audioCtx && masterGain) masterGain.gain.setTargetAtTime(on ? 0 : getVolume(), audioCtx.currentTime, 0.04)
}
let currentMode: 'cutscene' | 'game' = 'cutscene'

let audioCtx: AudioContext | null = null
let masterGain: GainNode | null = null
let rainGain: GainNode | null = null
let thunderBuffer: AudioBuffer | null = null
let isRainRunning = false

function loadInitialMuted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function isMuted(): boolean {
  return mutedState
}

export function setMuted(muted: boolean): void {
  mutedState = muted
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0')
    } catch {
      /* ignore storage errors */
    }
  }
  applyMaster()
}

export function toggleMuted(): boolean {
  const next = !mutedState
  setMuted(next)
  return next
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & { webkitAudioContext?: typeof AudioContext }
  return window.AudioContext ?? w.webkitAudioContext ?? null
}

function buildPinkWhiteBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = Math.floor(sampleRate * seconds)
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  // Paul Kellet's pink noise filter blended with soft white noise for natural rain
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0

  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.96900 * b2 + white * 0.1538520
    b3 = 0.86650 * b3 + white * 0.3104856
    b4 = 0.55000 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.0168980
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045
    b6 = white * 0.115926
    data[i] = pink * 0.75 + white * 0.08
  }

  return buffer
}

export function startAmbience(mode?: 'cutscene' | 'game'): void {
  if (mode) currentMode = mode
  const Ctor = getAudioContextConstructor()
  if (!Ctor) return

  try {
    if (!audioCtx) {
      audioCtx = new Ctor()
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume()
    }

    if (!isRainRunning && audioCtx) {
      masterGain = audioCtx.createGain()
      masterGain.gain.value = getVolume()
      masterGain.connect(audioCtx.destination)

      rainGain = audioCtx.createGain()
      const targetRainVolume =
        mode === 'cutscene' ? CUTSCENE_RAIN_GAIN : GAME_RAIN_GAIN
      rainGain.gain.value = 0.001
      rainGain.gain.setTargetAtTime(
        targetRainVolume,
        audioCtx.currentTime,
        0.35,
      )

      const bandpass = audioCtx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.value = 950
      bandpass.Q.value = 0.65

      const lowpass = audioCtx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 2400

      const rainBuffer = buildPinkWhiteBuffer(audioCtx, 3.5)
      thunderBuffer = rainBuffer

      const source = audioCtx.createBufferSource()
      source.buffer = rainBuffer
      source.loop = true

      source.connect(bandpass)
      bandpass.connect(lowpass)
      lowpass.connect(rainGain)
      rainGain.connect(masterGain)

      source.start(0)
      isRainRunning = true
    } else if (audioCtx && rainGain) {
      setAmbienceVolume(currentMode)
    }
  } catch {
    /* Web Audio blocked or unsupported */
  }
}

export function setAmbienceVolume(mode: 'cutscene' | 'game'): void {
  currentMode = mode
  if (!audioCtx || !rainGain) return
  const target = mode === 'cutscene' ? CUTSCENE_RAIN_GAIN : GAME_RAIN_GAIN
  rainGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.3)
}

export function playThunder(): void {
  if (getVolume() === 0 || ducked || !audioCtx || !masterGain) return
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume()
  }
  if (audioCtx.state !== 'running') return

  try {
    const now = audioCtx.currentTime
    const buf = thunderBuffer ?? buildPinkWhiteBuffer(audioCtx, 3.0)
    thunderBuffer = buf

    const source = audioCtx.createBufferSource()
    source.buffer = buf
    source.loop = true

    const filter = audioCtx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(210, now)
    filter.frequency.exponentialRampToValueAtTime(140, now + 0.35)
    filter.frequency.exponentialRampToValueAtTime(52, now + 2.6)

    const gain = audioCtx.createGain()
    const peak = currentMode === 'cutscene' ? 0.48 : 0.26
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.05)
    gain.gain.linearRampToValueAtTime(peak * 0.45, now + 0.16)
    gain.gain.linearRampToValueAtTime(peak * 0.85, now + 0.28)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.65)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(masterGain)

    source.start(now)
    source.stop(now + 2.7)
  } catch {
    /* ignore audio errors */
  }
}
