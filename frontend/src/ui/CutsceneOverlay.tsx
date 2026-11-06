import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react'
import type { PrologueLine, PublicSuspect } from '../api'
import { SoundControl } from './SoundControl'
import { prefetchVoices, speak, stopSpeaking } from '../audio/voice'
import { foreignBadge } from './language'

export interface CutsceneOverlayProps {
  caseId: string
  lines: PrologueLine[]
  lineIndex: number
  officerName: string
  setting: string
  suspects: PublicSuspect[]
  onAdvance: () => void
  onFinish: () => void
  onSkip: () => void
}

const CHAR_INTERVAL_MS = 28 // ~35.7 caracteres por segundo
const AUTO_ADVANCE_MS = 2200
const EXIT_FADE_MS = 650

export function CutsceneOverlay({
  caseId,
  lines,
  lineIndex,
  officerName,
  setting,
  suspects,
  onAdvance,
  onFinish,
  onSkip,
}: CutsceneOverlayProps) {
  const currentLine = lines[lineIndex] ?? lines[0]
  const fullText = currentLine?.text ?? ''

  const [typingState, setTypingState] = useState<{
    lineIdx: number
    count: number
  }>({
    lineIdx: lineIndex,
    count: 0,
  })
  const [isExiting, setIsExiting] = useState<boolean>(false)

  const charCount =
    typingState.lineIdx === lineIndex
      ? Math.min(typingState.count, fullText.length)
      : 0
  const isTyping = charCount < fullText.length

  const voiceActiveRef = useRef<boolean>(false)
  const voiceFinishedRef = useRef<boolean>(false)
  const postTextReadyRef = useRef<boolean>(false)
  const exitTimerRef = useRef<number | null>(null)

  const triggerStepForward = useCallback(() => {
    if (isExiting) return
    stopSpeaking()
    if (lineIndex >= lines.length - 1) {
      setIsExiting(true)
      exitTimerRef.current = window.setTimeout(() => {
        onFinish()
      }, EXIT_FADE_MS)
    } else {
      onAdvance()
    }
  }, [isExiting, lineIndex, lines.length, onAdvance, onFinish])

  useEffect(() => {
    return () => {
      stopSpeaking()
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current)
      }
    }
  }, [])

  // Efeito de máquina de escrever (~35 caracteres/s)
  useEffect(() => {
    if (isExiting || !currentLine) return
    if (charCount >= fullText.length) return

    const timer = window.setInterval(() => {
      setTypingState((prev) => {
        const currentCount = prev.lineIdx === lineIndex ? prev.count : 0
        if (currentCount >= fullText.length) return prev
        return { lineIdx: lineIndex, count: currentCount + 1 }
      })
    }, CHAR_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [charCount, currentLine, fullText.length, isExiting, lineIndex])

  // Disparo da voz via Web Speech API a cada nova linha
  useEffect(() => {
    if (isExiting || !currentLine) return

    postTextReadyRef.current = false
    voiceFinishedRef.current = false

    prefetchVoices(caseId, [lineIndex + 1, lineIndex + 2])
    const mode = speak(
      currentLine.text,
      currentLine.speaker,
      () => {
        voiceFinishedRef.current = true
        if (postTextReadyRef.current) {
          triggerStepForward()
        }
      },
      { caseId, line: lineIndex },
    )
    const started = mode !== false
    voiceActiveRef.current = started

    // Fallback de segurança caso o navegador bloqueie o evento onend da síntese
    let safetyTimer: number | null = null
    if (started) {
      // A voz neural pode levar alguns segundos para chegar na 1ª vez; a do navegador é imediata.
      const maxVoiceMs = mode === 'neural' ? 30000 : Math.max(4800, currentLine.text.length * 95)
      safetyTimer = window.setTimeout(() => {
        voiceFinishedRef.current = true
        if (postTextReadyRef.current) {
          triggerStepForward()
        }
      }, maxVoiceMs)
    }

    return () => {
      if (safetyTimer !== null) {
        window.clearTimeout(safetyTimer)
      }
      stopSpeaking()
    }
  }, [caseId, currentLine, isExiting, lineIndex, triggerStepForward])

  // Auto-avanço 2,2 s após o texto terminar (ou após a voz terminar, se houver voz)
  useEffect(() => {
    if (isExiting || isTyping) return

    const timer = window.setTimeout(() => {
      postTextReadyRef.current = true
      if (!voiceActiveRef.current || voiceFinishedRef.current) {
        triggerStepForward()
      }
    }, AUTO_ADVANCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [isExiting, isTyping, lineIndex, triggerStepForward])

  const handleOverlayClick = () => {
    if (isExiting || !currentLine) return
    if (isTyping) {
      setTypingState({ lineIdx: lineIndex, count: fullText.length })
    } else {
      triggerStepForward()
    }
  }

  const handleSkipClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    stopSpeaking()
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current)
    }
    onSkip()
  }

  if (!currentLine) return null

  const showSettingCard =
    lineIndex === 0 && currentLine.shot === 'establishing' && Boolean(setting)

  const activeSuspect: PublicSuspect | null =
    currentLine.shot === 'suspect' && currentLine.suspect_id
      ? (suspects.find((s) => s.id === currentLine.suspect_id) ?? null)
      : null

  const speakerLabel =
    currentLine.speaker === 'policial' ? officerName : 'Narrador'

  return (
    <div
      className={`cutscene-overlay ${isExiting ? 'cutscene-exiting' : ''}`}
      onClick={handleOverlayClick}
      role="region"
      aria-label="Introdução cinematográfica do caso"
    >
      {/* Barra preta superior (letterbox) */}
      <div className="cutscene-letterbox cutscene-letterbox-top">
        <div className="cutscene-top-controls">
          <SoundControl />
          <button
            type="button"
            className="btn btn-secondary cutscene-control-btn cutscene-skip-btn"
            onClick={handleSkipClick}
          >
            Pular intro ›
          </button>
        </div>
      </div>

      {/* Letreiro central de lugar e data na primeira linha (establishing) */}
      {showSettingCard && (
        <div className="cutscene-setting-banner" aria-live="polite">
          <span className="cutscene-setting-rule" />
          <p className="cutscene-setting-text">{setting}</p>
          <span className="cutscene-setting-rule" />
        </div>
      )}

      {/* Card de apresentação do suspeito no canto durante a tomada 'suspect' */}
      {activeSuspect && (
        <div
          key={activeSuspect.id}
          className="cutscene-suspect-card"
          aria-live="polite"
        >
          <span
            className="cutscene-suspect-swatch"
            style={{ backgroundColor: activeSuspect.look.accent }}
          />
          <div className="cutscene-suspect-info">
            <span className="cutscene-suspect-badge">SUSPEITO</span>
            <strong className="cutscene-suspect-name">
              {activeSuspect.name}
            </strong>
            <span className="cutscene-suspect-role">{activeSuspect.role}</span>
            {foreignBadge(activeSuspect) && <span className="foreign-badge">{foreignBadge(activeSuspect)}</span>}
          </div>
        </div>
      )}

      {/* Barra preta inferior (letterbox) com legenda typewriter */}
      <div className="cutscene-letterbox cutscene-letterbox-bottom">
        <div className="cutscene-subtitle-box">
          <div className="cutscene-speaker-row">
            <span
              className={
                currentLine.speaker === 'policial'
                  ? 'cutscene-speaker cutscene-speaker-officer'
                  : 'cutscene-speaker cutscene-speaker-narrator'
              }
            >
              {speakerLabel}
            </span>
            <span className="cutscene-step-hint">
              {isTyping ? 'Toque para completar' : 'Toque para avançar ›'}
            </span>
          </div>
          <p className="cutscene-subtitle-text">
            {fullText.slice(0, charCount)}
            {isTyping && <span className="cutscene-cursor">▍</span>}
          </p>
        </div>
      </div>

      {/* Cortina preta de fade-out ao encerrar a última linha */}
      <div className="cutscene-fade-veil" />
    </div>
  )
}
