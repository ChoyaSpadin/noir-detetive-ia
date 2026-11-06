import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react'
import type { Emotion, PublicSuspect } from '../api'
import { MicButton } from './MicButton'
import { FLAGS, defaultSpeechLang, type SpeechLang } from './language'

export interface ChatMessage {
  from: 'player' | 'suspect'
  text: string
  emotion?: Emotion
  streaming?: boolean // ainda sendo falada/digitada
}

interface ChatSheetProps {
  suspect: PublicSuspect | null
  messages: ChatMessage[]
  currentEmotion: Emotion
  questionsLeft: number
  loading: boolean
  error: string | null
  onSendQuestion: (question: string) => void
  onRetryLastQuestion: () => void
  onOpenAccuse: () => void
  onTranscribe: (audio: Blob, lang: SpeechLang) => Promise<string>
  onStartVoice: () => void // cala o suspeito quando o detetive começa a falar
}

export function ChatSheet({
  suspect,
  messages,
  currentEmotion,
  questionsLeft,
  loading,
  error,
  onSendQuestion,
  onRetryLastQuestion,
  onOpenAccuse,
  onTranscribe,
  onStartVoice,
}: ChatSheetProps) {
  const [input, setInput] = useState('')
  const [micError, setMicError] = useState<string | null>(null)
  const [speechLang, setSpeechLang] = useState<SpeechLang>('pt')

  // Ao trocar de suspeito, o microfone volta ao idioma esperado para ele.
  useEffect(() => {
    if (suspect) setSpeechLang(defaultSpeechLang(suspect))
    setMicError(null)
  }, [suspect?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, loading, suspect?.id])

  if (!suspect) return null

  const outOfQuestions = questionsLeft <= 0
  const englishOnly = suspect.speaks_portuguese === false
  const canSend = !loading && !outOfQuestions && input.trim().length > 0

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading || outOfQuestions) return
    setInput('')
    onSendQuestion(trimmed)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const trimmed = input.trim()
      if (!trimmed || loading || outOfQuestions) return
      setInput('')
      onSendQuestion(trimmed)
    }
  }

  return (
    <aside className="chat-sheet" aria-label={`Interrogatório de ${suspect.name}`}>
      <div className="chat-sheet-header">
        <div className="chat-suspect-meta">
          <div className="chat-suspect-title-row">
            <span
              className="suspect-dot"
              style={{ backgroundColor: suspect.look.accent }}
            />
            <strong className="chat-suspect-name">{suspect.name}</strong>
            <span className="chat-suspect-role">{suspect.role}</span>
            <span className={`emotion-tag emotion-${currentEmotion}`}>
              {currentEmotion}
            </span>
          </div>
          {suspect.nationality && (
            <p className={`chat-language-hint ${englishOnly ? 'english-only' : ''}`}>
              {FLAGS[suspect.nationality] ?? '🌍'}{' '}
              {englishOnly
                ? 'Só fala inglês. Faça as perguntas em inglês.'
                : `Estrangeiro (${suspect.nationality}): entende pouco português. Em inglês ele entende melhor.`}
            </p>
          )}
          <p className="chat-suspect-desc">{suspect.description}</p>
        </div>
      </div>

      <div className="chat-messages" role="log" aria-live="polite">
        {messages.length === 0 && !loading && (
          <div className="chat-empty">
            Digite ou segure o microfone para fazer sua pergunta a <strong>{suspect.name}</strong>.
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`chat-bubble-row ${
              msg.from === 'player' ? 'chat-row-player' : 'chat-row-suspect'
            }`}
          >
            <div
              className={`chat-bubble ${
                msg.from === 'player' ? 'bubble-player' : 'bubble-suspect'
              }`}
            >
              {msg.from === 'suspect' && msg.emotion && (
                <span className={`emotion-tag emotion-${msg.emotion}`}>
                  {msg.emotion}
                </span>
              )}
              <p className="bubble-text">{msg.text}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-bubble-row chat-row-suspect">
            <div className="chat-bubble bubble-suspect bubble-typing" aria-label="Suspeito respondendo">
              <span className="typing-dots">...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="error-banner chat-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={onRetryLastQuestion}
              disabled={loading}
            >
              Tentar de novo
            </button>
          </div>
        )}

        <div ref={logEndRef} />
      </div>

      {outOfQuestions ? (
        <div className="chat-exhausted-bar">
          <span>Sem perguntas restantes. Hora de apontar o culpado!</span>
          <button
            type="button"
            className="btn btn-danger btn-small"
            onClick={onOpenAccuse}
          >
            Acusar agora
          </button>
        </div>
      ) : (
        <>
          <form className="chat-input-row" onSubmit={handleSubmit}>
            <input
              type="text"
              className="chat-input"
              placeholder={englishOnly ? `Ask ${suspect.name} in English...` : `Perguntar a ${suspect.name}...`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading || outOfQuestions}
              maxLength={260}
            />
            <button
              type="button"
              className="btn chat-lang-btn"
              onClick={() => setSpeechLang((l) => (l === 'pt' ? 'en' : 'pt'))}
              title="Idioma em que você vai falar no microfone (toque para trocar)"
              aria-label={`Microfone em ${speechLang === 'pt' ? 'português' : 'inglês'}. Toque para trocar.`}
              disabled={loading || outOfQuestions}
            >
              {speechLang === 'pt' ? 'PT' : 'EN'}
            </button>
            <MicButton
              disabled={loading || outOfQuestions}
              englishOnly={speechLang === 'en'}
              onStart={onStartVoice}
              onTranscribe={(audio) => onTranscribe(audio, speechLang)}
              onText={(t) => setInput(t)}
              onError={setMicError}
            />
            <button
              type="submit"
              className="btn btn-primary chat-send-btn"
              disabled={!canSend}
            >
              Enviar
            </button>
          </form>
          {micError && (
            <p className="chat-mic-error" role="status">
              {micError}
            </p>
          )}
        </>
      )}
    </aside>
  )
}
