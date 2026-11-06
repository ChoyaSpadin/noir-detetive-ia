import { API_BASE } from '../api'
// Síntese de voz via Web Speech API (speechSynthesis) para narrador e policial.

import { getVolume, onSoundChange } from './ambience'

let cachedVoices: SpeechSynthesisVoice[] = []
// Mantém referência global para evitar coleta de lixo prematura do utterance no Chrome
let activeUtterance: SpeechSynthesisUtterance | null = null
let cancelledByUser = false

function refreshVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    const list = window.speechSynthesis.getVoices()
    if (list && list.length > 0) {
      cachedVoices = list
    }
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices()
  try {
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices)
  } catch {
    /* old browsers */
  }
}

function findPortugueseVoice(): SpeechSynthesisVoice | null {
  refreshVoices()
  const pt = cachedVoices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('pt'))
  if (pt.length === 0) return null
  // Vozes neurais do sistema soam bem menos robóticas (Edge: "Natural"/"Online"; Chrome: "Google").
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|online/i.test(v.name) ? 4 : 0) +
    (/google/i.test(v.name) ? 3 : 0) +
    (v.lang.toLowerCase().replace('_', '-') === 'pt-br' ? 2 : 0) +
    (v.localService ? 0 : 1)
  return [...pt].sort((a, b) => score(b) - score(a))[0]
}

// ---- Voz neural (Gemini TTS no backend) ----
let audioEl: HTMLAudioElement | null = null
// Mudar o volume durante a fala ajusta na hora (o mudo silencia sem cortar o tempo da cena).
onSoundChange(() => {
  if (audioEl) audioEl.volume = getVolume()
  if (getVolume() === 0 && activeUtterance && typeof window !== 'undefined') window.speechSynthesis?.cancel()
})
const neuralCache = new Map<string, Promise<string | null>>()

function neuralUrl(caseId: string, line: number): Promise<string | null> {
  const key = `${caseId}:${line}`
  let p = neuralCache.get(key)
  if (!p) {
    const base = API_BASE
    p = fetch(`${base}/api/cases/${caseId}/prologue/${line}/audio`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null)
    neuralCache.set(key, p)
  }
  return p
}

/** Baixa antes as próximas falas, para a voz começar sem espera. */
export function prefetchVoices(caseId: string, lines: number[]): void {
  for (const l of lines) void neuralUrl(caseId, l)
}

export interface VoiceSource {
  caseId: string
  line: number
}

let speakToken = 0

export function stopSpeaking(): void {
  cancelledByUser = true
  activeUtterance = null
  speakToken++
  if (audioEl) {
    audioEl.onended = null
    audioEl.onerror = null
    audioEl.pause()
    audioEl = null
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    /* ignore */
  }
}

/**
 * Fala uma linha. Com `source`, usa a voz neural do backend (sem ela, só legenda).
 * Sem `source`, usa a voz do navegador.
 * Retorna 'neural' | 'browser' | false (sem voz).
 */
export function speak(
  text: string,
  speaker: 'narrador' | 'policial',
  onEnd?: () => void,
  source?: VoiceSource,
): 'neural' | 'browser' | false {
  stopSpeaking()
  if (getVolume() === 0) return false
  if (source) {
    const token = speakToken
    cancelledByUser = false
    void neuralUrl(source.caseId, source.line).then((url) => {
      if (token !== speakToken) return // já trocou de fala
      if (!url) {
        // Sem voz neural (cota do dia acabou): fica só a legenda. A voz do navegador soa robótica.
        onEnd?.()
        return
      }
      const el = new Audio(url)
      el.volume = getVolume()
      audioEl = el
      el.onended = () => {
        if (token === speakToken) onEnd?.()
      }
      el.onerror = () => {
        if (token === speakToken) onEnd?.()
      }
      void el.play().catch(() => {
        if (token === speakToken) onEnd?.()
      })
    })
    return 'neural'
  }
  return speakBrowser(text, speaker, onEnd) ? 'browser' : false
}

function speakBrowser(text: string, speaker: 'narrador' | 'policial', onEnd?: () => void): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return false
  }

  const voice = findPortugueseVoice()
  if (!voice) {
    return false
  }

  try {
    cancelledByUser = false
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.voice = voice
    utterance.lang = voice.lang || 'pt-BR'
    utterance.volume = getVolume()

    if (speaker === 'policial') {
      utterance.pitch = 0.8
      utterance.rate = 1.0
    } else {
      utterance.pitch = 0.9
      utterance.rate = 0.95
    }

    let finished = false
    const handleFinish = () => {
      if (finished) return
      finished = true
      if (activeUtterance === utterance) {
        activeUtterance = null
      }
      if (!cancelledByUser) {
        onEnd?.()
      }
    }

    utterance.onend = handleFinish
    utterance.onerror = handleFinish

    activeUtterance = utterance
    window.speechSynthesis.speak(utterance)
    return true
  } catch {
    activeUtterance = null
    return false
  }
}


// ---- Fala de suspeito (áudio pronto do backend) ----
let answerEl: HTMLAudioElement | null = null
onSoundChange(() => {
  if (answerEl) answerEl.volume = getVolume()
})

let answerToken = 0

/**
 * Toca a resposta falada, frase por frase. onStart quando a 1ª frase começa (para a boca mexer),
 * onEnd quando a última termina. A próxima frase é baixada enquanto a atual toca.
 */
export function playAnswer(urls: string[], onStart: () => void, onEnd: () => void): void {
  stopAnswer()
  const token = ++answerToken
  const base = API_BASE
  const els = urls.map((u) => {
    const el = new Audio()
    el.preload = 'auto'
    el.src = `${base}${u}`
    return el
  })
  let started = false
  const playAt = (i: number) => {
    if (token !== answerToken) return
    if (i >= els.length) {
      answerEl = null
      onEnd()
      return
    }
    const el = els[i]
    el.volume = getVolume()
    answerEl = el
    el.onended = () => playAt(i + 1)
    el.onerror = () => playAt(i + 1) // frase sem áudio: segue para a próxima
    void el
      .play()
      .then(() => {
        if (!started) {
          started = true
          onStart()
        }
      })
      .catch(() => playAt(i + 1))
  }
  playAt(0)
}

export function stopAnswer(): void {
  answerToken++
  if (answerEl) {
    answerEl.onended = null
    answerEl.pause()
    answerEl = null
  }
}
