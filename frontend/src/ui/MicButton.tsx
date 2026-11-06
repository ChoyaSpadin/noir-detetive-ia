import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Recorder, canRecord } from '../audio/recorder'

type MicState = 'idle' | 'starting' | 'recording' | 'transcribing'

interface MicButtonProps {
  disabled: boolean
  englishOnly: boolean
  onStart: () => void // ex.: cala o suspeito enquanto o detetive fala
  onTranscribe: (audio: Blob) => Promise<string>
  onText: (text: string) => void
  onError: (message: string | null) => void
}

const TAP_MS = 350
const MIN_VOICED_S = 0.25 // menos que isso com volume de fala: a gravação não pegou a voz // toque curto = liga e desliga; segurar = fala enquanto segura

/** Botão de microfone: segure para falar (ou toque para começar e toque de novo para parar). */
export function MicButton({ disabled, englishOnly, onStart, onTranscribe, onText, onError }: MicButtonProps) {
  const [state, setState] = useState<MicState>('idle')
  const [seconds, setSeconds] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const rec = useRef<Recorder | null>(null)
  const pressAt = useRef(0)
  const toggleMode = useRef(false)
  const releasedEarly = useRef(false)
  const stateRef = useRef<MicState>('idle')
  stateRef.current = state

  useEffect(() => () => rec.current?.cancel(), [])

  useEffect(() => {
    if (state !== 'recording') return
    setSeconds(0)
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [state])

  if (!canRecord()) return null

  const finish = async () => {
    const r = rec.current
    rec.current = null
    if (!r) return
    setState('transcribing')
    const audio = await r.stop()
    btnRef.current?.style.setProperty('--level', '0')
    if (!audio || audio.size < 800) {
      setState('idle')
      onError('Não ouvi nada. Segure o botão enquanto fala.')
      return
    }
    console.info('[mic] pico', r.peak?.toFixed(3), 'fala', r.voicedSeconds?.toFixed(2), 's', audio.size, 'bytes')
    if (r.voicedSeconds !== null && r.voicedSeconds < MIN_VOICED_S) {
      setState('idle')
      onError('O microfone não captou sua voz. Confira qual microfone o navegador está usando (ícone na barra de endereço).')
      return
    }
    try {
      const text = await onTranscribe(audio)
      if (text) onText(text)
      onError(null)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Não consegui entender o áudio.')
    } finally {
      setState('idle')
    }
  }

  const begin = async () => {
    onError(null)
    onStart()
    setState('starting')
    releasedEarly.current = false
    const t0 = performance.now()
    const r = new Recorder()
    r.onAutoStop = () => void finish()
    r.onLevel = (level) => btnRef.current?.style.setProperty('--level', level.toFixed(2))
    try {
      await r.start()
    } catch {
      setState('idle')
      onError('Sem acesso ao microfone. Libere a permissão no navegador ou digite a pergunta.')
      return
    }
    rec.current = r
    setState('recording')
    // Se o navegador pediu permissão (demorou), o dedo já saiu: segue gravando até o próximo toque.
    if (performance.now() - t0 > 600) toggleMode.current = true
    else if (releasedEarly.current && !toggleMode.current) void finish()
  }

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button > 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const st = stateRef.current
    if (st === 'recording' && toggleMode.current) {
      toggleMode.current = false
      void finish()
      return
    }
    if (st !== 'idle') return
    pressAt.current = performance.now()
    toggleMode.current = false
    void begin()
  }

  const onUp = () => {
    const st = stateRef.current
    if (st !== 'starting' && st !== 'recording') return
    if (toggleMode.current) return
    if (performance.now() - pressAt.current < TAP_MS) {
      toggleMode.current = true // toque rápido: continua gravando até tocar de novo
      return
    }
    if (st === 'starting') releasedEarly.current = true
    else void finish()
  }

  const recording = state === 'recording' || state === 'starting'
  const label =
    state === 'transcribing'
      ? 'Entendendo a pergunta…'
      : recording
        ? 'Gravando. Solte (ou toque) para parar.'
        : englishOnly
          ? 'Segure para perguntar falando em inglês'
          : 'Segure para perguntar falando em português'

  return (
    <button
      ref={btnRef}
      type="button"
      className={`btn chat-mic-btn ${recording ? 'is-recording' : ''} ${state === 'transcribing' ? 'is-busy' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={recording}
      disabled={disabled || state === 'transcribing'}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // teclado: Enter/Espaço liga e desliga
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (stateRef.current === 'recording') void finish()
        else if (stateRef.current === 'idle') {
          toggleMode.current = true
          void begin()
        }
      }}
    >
      {state === 'transcribing' ? (
        <span className="mic-spinner" aria-hidden />
      ) : recording ? (
        <span className="mic-rec">
          <span className="mic-dot" aria-hidden />
          {seconds > 0 ? `${seconds}s` : ''}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor">
          <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
        </svg>
      )}
    </button>
  )
}
