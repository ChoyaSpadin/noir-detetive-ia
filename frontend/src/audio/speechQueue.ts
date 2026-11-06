import { API_BASE } from '../api'
// Fila de fala do suspeito: toca os trechos em ordem e "digita" o texto de cada um
// durante a voz dele. Sem voz (mudo ou erro), o texto aparece no ritmo de leitura.

import { getVolume, onSoundChange } from './ambience'

interface Callbacks {
  onText: (shownSoFar: string) => void // texto visível até agora (cresce aos poucos)
  onSpeakStart: () => void // 1ª vez que a voz começa (boca mexe)
  onDone: () => void // todos os trechos mostrados/falados
}

interface Item {
  text: string
  el: HTMLAudioElement | null
}

const READ_CPS = 32 // caracteres por segundo sem voz
const TICK_MS = 30
const AUDIO_WAIT_MS = 12000 // se a voz não começar nesse tempo, mostra o texto sem ela

export class SpeechQueue {
  private items: Item[] = []
  private idx = 0
  private busy = false
  private ended = false
  private stopped = false
  private spoke = false
  private shown = '' // texto já totalmente revelado
  private all = '' // todo o texto recebido
  private timers: number[] = []
  private current: HTMLAudioElement | null = null
  private unsub: () => void
  private cb: Callbacks

  constructor(cb: Callbacks) {
    this.cb = cb
    this.unsub = onSoundChange(() => {
      if (this.current) this.current.volume = getVolume()
    })
  }

  push(text: string, url: string | null | undefined): void {
    if (this.stopped) return
    let el: HTMLAudioElement | null = null
    if (url && getVolume() > 0) {
      el = new Audio()
      el.preload = 'auto' // já começa a baixar (o backend gera em ordem)
      el.src = `${API_BASE}${url}`
    }
    this.all = this.all ? `${this.all} ${text}` : text
    this.items.push({ text, el })
    if (!this.busy) this.next()
  }

  /** Não chegam mais trechos. */
  end(): void {
    this.ended = true
    if (!this.busy && this.idx >= this.items.length) this.finish()
  }

  /** Interrompe e mostra o texto inteiro na hora. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.clearTimers()
    if (this.current) {
      this.current.onended = null
      this.current.pause()
      this.current = null
    }
    this.cb.onText(this.all)
    this.unsub()
    this.cb.onDone()
  }

  private finish(): void {
    if (this.stopped) return
    this.stopped = true
    this.unsub()
    this.cb.onDone()
  }

  private clearTimers(): void {
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers = []
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms))
  }

  /** Digita `text` em `seconds` segundos, emendando no que já foi mostrado. */
  private reveal(text: string, seconds: number, then?: () => void): void {
    const base = this.shown ? `${this.shown} ` : ''
    const total = Math.max(0.3, seconds) * 1000
    const steps = Math.max(1, Math.floor(total / TICK_MS))
    let step = 0
    const tick = () => {
      if (this.stopped) return
      step++
      const n = Math.min(text.length, Math.ceil((text.length * step) / steps))
      this.cb.onText(base + text.slice(0, n))
      if (n < text.length) this.later(tick, TICK_MS)
      else {
        this.shown = base + text
        then?.()
      }
    }
    tick()
  }

  private next(): void {
    if (this.stopped) return
    if (this.idx >= this.items.length) {
      this.busy = false
      if (this.ended) this.finish()
      return
    }
    this.busy = true
    const item = this.items[this.idx++]
    const readSeconds = item.text.length / READ_CPS

    const withoutVoice = () => {
      this.reveal(item.text, readSeconds, () => this.next())
    }
    const el = item.el
    if (!el || getVolume() === 0) {
      withoutVoice()
      return
    }
    let started = false
    let done = false
    const go = () => {
      if (done) return
      done = true
      this.current = null
      this.next()
    }
    this.current = el
    el.volume = getVolume()
    el.onplaying = () => {
      if (started) return
      started = true
      if (!this.spoke) {
        this.spoke = true
        this.cb.onSpeakStart()
      }
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : readSeconds
      this.reveal(item.text, dur * 0.95)
    }
    el.onended = () => {
      // garante o trecho inteiro na tela antes do próximo
      this.clearTimers()
      this.shown = this.shown.endsWith(item.text) ? this.shown : (this.shown ? `${this.shown} ` : '') + item.text
      this.cb.onText(this.shown)
      go()
    }
    const fail = () => {
      if (started || done) return
      done = true
      el.pause()
      this.current = null
      this.reveal(item.text, readSeconds, () => this.next())
    }
    el.onerror = fail
    this.later(fail, AUDIO_WAIT_MS)
    void el.play().catch(fail)
  }
}
