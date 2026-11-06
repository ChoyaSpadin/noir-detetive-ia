// Grava a pergunta falada pelo microfone (MediaRecorder) e devolve o áudio comprimido.
import { duckAmbience } from './ambience'

const MAX_SECONDS = 30 // pergunta longa demais para em 30 s sozinha

/** O navegador só libera o microfone em HTTPS ou localhost. */
export function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

function pickMime(): string | undefined {
  // Chrome/Android: webm/opus. Safari/iPhone: mp4/aac.
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return options.find((m) => MediaRecorder.isTypeSupported?.(m))
}

export class Recorder {
  private rec: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private timer = 0
  private resolveStop: ((b: Blob | null) => void) | null = null
  private ctx: AudioContext | null = null
  private meter = 0
  /** Maior volume (RMS) captado; null se não deu para medir. */
  peak: number | null = null
  /** Segundos com volume de fala (não só um estalo); null se não deu para medir. */
  voicedSeconds: number | null = null
  onAutoStop: (() => void) | null = null
  onLevel: ((level: number) => void) | null = null // 0..1, para o botão "pulsar" com a voz

  async start(): Promise<void> {
    // Criado antes do await, ainda dentro do toque (senão o navegador deixa o áudio suspenso).
    try {
      this.ctx = new AudioContext()
    } catch {
      this.ctx = null
    }
    duckAmbience(true)
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // Captura crua: o cancelamento de eco/ruído do navegador chegava a zerar a voz
        // (a chuva do jogo tocando sem parar parecia "eco"). O som do jogo é calado ao gravar.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
      })
    } catch (e) {
      this.release()
      throw e
    }
    this.startMeter(this.stream)
    const mimeType = pickMime()
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.rec.onstop = () => {
      const blob = this.chunks.length ? new Blob(this.chunks, { type: this.rec?.mimeType || mimeType || 'audio/webm' }) : null
      this.release()
      this.resolveStop?.(blob)
      this.resolveStop = null
    }
    this.rec.start()
    this.timer = window.setTimeout(() => this.onAutoStop?.(), MAX_SECONDS * 1000)
  }

  /** Para e devolve o áudio (null se nada foi gravado). */
  stop(): Promise<Blob | null> {
    window.clearTimeout(this.timer)
    if (!this.rec || this.rec.state === 'inactive') {
      this.release()
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      this.resolveStop = resolve
      this.rec!.stop()
    })
  }

  /** Descarta a gravação. */
  cancel(): void {
    window.clearTimeout(this.timer)
    if (this.rec && this.rec.state !== 'inactive') {
      this.rec.onstop = null
      this.rec.stop()
    }
    this.release()
  }

  private startMeter(stream: MediaStream): void {
    const ctx = this.ctx
    if (!ctx) return
    void ctx.resume().catch(() => {})
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    this.meter = window.setInterval(() => {
      if (ctx.state !== 'running') return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      const rms = Math.sqrt(sum / buf.length)
      this.peak = Math.max(this.peak ?? 0, rms)
      this.voicedSeconds = (this.voicedSeconds ?? 0) + (rms > 0.015 ? 0.06 : 0)
      this.onLevel?.(Math.min(1, rms * 8))
    }, 60)
  }

  private release(): void {
    duckAmbience(false)
    window.clearInterval(this.meter)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}
