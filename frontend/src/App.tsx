import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import {
  api,
  type AccuseResponse,
  type Emotion,
  type PublicCase,
} from './api'
import type { CutsceneState } from './scene/Scene'

// O 3D (three + modelos) fica num pacote separado: a interface abre antes da cena carregar.
const Scene = lazy(() => import('./scene/Scene').then((m) => ({ default: m.Scene })))
import { IntroScreen } from './ui/IntroScreen'
import { CutsceneOverlay } from './ui/CutsceneOverlay'
import { HUD } from './ui/HUD'
import { SuspectTabs } from './ui/SuspectTabs'
import { ChatSheet, type ChatMessage } from './ui/ChatSheet'
import { AccuseModal } from './ui/AccuseModal'
import { VerdictScreen } from './ui/VerdictScreen'
import { SoundControl } from './ui/SoundControl'
import { setAmbienceVolume, startAmbience } from './audio/ambience'
import { stopAnswer, stopSpeaking } from './audio/voice'
import { SpeechQueue } from './audio/speechQueue'

type GamePhase = 'intro' | 'cutscene' | 'briefing' | 'playing' | 'verdict'

export default function App() {
  const [phase, setPhase] = useState<GamePhase>('intro')
  const [caseData, setCaseData] = useState<PublicCase | null>(null)
  const [cutsceneIndex, setCutsceneIndex] = useState<number>(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({})
  const [emotions, setEmotions] = useState<Record<string, Emotion>>({})
  const [questionsLeft, setQuestionsLeft] = useState<number>(0)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [accuseOpen, setAccuseOpen] = useState<boolean>(false)
  const [verdict, setVerdict] = useState<AccuseResponse | null>(null)

  const [loadingCase, setLoadingCase] = useState<boolean>(false)
  const [loadingChat, setLoadingChat] = useState<boolean>(false)
  const [loadingAccuse, setLoadingAccuse] = useState<boolean>(false)

  const [caseError, setCaseError] = useState<string | null>(null)
  const [serverReady, setServerReady] = useState(false)

  // Acorda o servidor assim que o site abre (no ar, o plano grátis dorme após 15 min parado).
  useEffect(() => {
    let alive = true
    const tryWake = async () => {
      for (let i = 0; i < 60 && alive; i++) {
        if (await api.health()) {
          if (alive) setServerReady(true)
          return
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
    void tryWake()
    return () => {
      alive = false
    }
  }, [])
  const [chatError, setChatError] = useState<string | null>(null)
  const [accuseError, setAccuseError] = useState<string | null>(null)

  const lastQuestionRef = useRef<{ suspectId: string; question: string } | null>(
    null,
  )
  const speakingTimerRef = useRef<number | null>(null)
  const speechRef = useRef<SpeechQueue | null>(null) // fala do suspeito em andamento

  useEffect(() => {
    return () => {
      stopSpeaking()
      stopAnswer()
      speechRef.current?.stop()
      if (speakingTimerRef.current !== null) {
        window.clearTimeout(speakingTimerRef.current)
      }
    }
  }, [])

  const triggerSpeaking = useCallback((suspectId: string, durationMs = 3600) => {
    if (speakingTimerRef.current !== null) {
      window.clearTimeout(speakingTimerRef.current)
    }
    setSpeakingId(suspectId)
    speakingTimerRef.current = window.setTimeout(() => {
      setSpeakingId((prev) => (prev === suspectId ? null : prev))
    }, durationMs)
  }, [])

  const handleOpenCase = useCallback(async (libraryId: string | null = null) => {
    startAmbience('cutscene')
    setLoadingCase(true)
    setCaseError(null)
    try {
      const data = await api.newCase(libraryId)
      const initialChats: Record<string, ChatMessage[]> = {}
      const initialEmotions: Record<string, Emotion> = {}
      for (const s of data.suspects) {
        initialChats[s.id] = []
        initialEmotions[s.id] = 'calmo'
      }
      setCaseData(data)
      setChats(initialChats)
      setEmotions(initialEmotions)
      setQuestionsLeft(data.questions_left)
      setSelectedId(null)
      setVerdict(null)
      setAccuseOpen(false)
      setCutsceneIndex(0)

      if (data.prologue && data.prologue.length > 0) {
        setAmbienceVolume('cutscene')
        setPhase('cutscene')
      } else {
        setAmbienceVolume('game')
        setPhase('briefing')
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar o caso. Verifique a conexão com o servidor.'
      setCaseError(`Falha ao abrir caso: ${msg}`)
    } finally {
      setLoadingCase(false)
    }
  }, [])

  const handleAdvanceCutscene = useCallback(() => {
    setCutsceneIndex((prev) => prev + 1)
  }, [])

  const handleFinishCutscene = useCallback(() => {
    stopSpeaking()
    stopAnswer()
    setAmbienceVolume('game')
    setPhase('briefing')
  }, [])

  const handleReplayIntro = useCallback(() => {
    if (!caseData || !caseData.prologue || caseData.prologue.length === 0) {
      return
    }
    setAccuseOpen(false)
    setCutsceneIndex(0)
    startAmbience('cutscene')
    setPhase('cutscene')
  }, [caseData])

  const handleStartInterrogation = useCallback(() => {
    if (!caseData) return
    setAmbienceVolume('game')
    setPhase('playing')
    if (caseData.suspects.length > 0) {
      setSelectedId((prev) => prev ?? caseData.suspects[0].id)
    }
  }, [caseData])

  const executeQuestion = useCallback(
    async (suspectId: string, question: string, appendPlayerBubble: boolean) => {
      if (!caseData) return
      setLoadingChat(true)
      setChatError(null)
      lastQuestionRef.current = { suspectId, question }

      if (appendPlayerBubble) {
        setChats((prev) => ({
          ...prev,
          [suspectId]: [
            ...(prev[suspectId] ?? []),
            { from: 'player', text: question },
          ],
        }))
      }

      // Resposta em tempo real: cada trecho chega com a sua voz e é digitado enquanto é falado.
      speechRef.current?.stop()
      stopAnswer()
      let emotion: Emotion = 'calmo'
      const upsert = (text: string, streaming: boolean) =>
        setChats((prev) => {
          const list = [...(prev[suspectId] ?? [])]
          const last = list[list.length - 1]
          const msg: ChatMessage = { from: 'suspect', text, emotion, streaming }
          if (last && last.from === 'suspect' && last.streaming) list[list.length - 1] = msg
          else list.push(msg)
          return { ...prev, [suspectId]: list }
        })
      let latest = ''
      const queue = new SpeechQueue({
        onText: (t) => {
          latest = t
          setLoadingChat(false) // as reticências somem quando a fala começa
          upsert(t, true)
        },
        onSpeakStart: () => triggerSpeaking(suspectId, 120000),
        onDone: () => {
          if (latest) upsert(latest, false)
          setSpeakingId((prev) => (prev === suspectId ? null : prev))
          setLoadingChat(false)
        },
      })
      speechRef.current = queue

      try {
        await api.interrogateStream(caseData.case_id, suspectId, question, (ev) => {
          if (ev.type === 'emotion') {
            emotion = ev.emotion
            setEmotions((prev) => ({ ...prev, [suspectId]: ev.emotion }))
          } else if (ev.type === 'piece') {
            queue.push(ev.text, ev.audio_url)
          } else if (ev.type === 'done') {
            setQuestionsLeft(ev.questions_left)
            queue.end()
          }
        })
      } catch (err) {
        queue.stop()
        const msg =
          err instanceof Error
            ? err.message
            : 'O suspeito não pôde responder agora.'
        setChatError(`Não foi possível obter a resposta (${msg}).`)
        setLoadingChat(false)
      }
    },
    [caseData, triggerSpeaking],
  )

  const handleSendQuestion = useCallback(
    (question: string) => {
      if (!selectedId) return
      void executeQuestion(selectedId, question, true)
    },
    [selectedId, executeQuestion],
  )

  const handleRetryLastQuestion = useCallback(() => {
    const last = lastQuestionRef.current
    if (!last) return
    void executeQuestion(last.suspectId, last.question, false)
  }, [executeQuestion])

  const handleSelectSuspect = useCallback((id: string) => {
    setSelectedId(id)
    setChatError(null)
  }, [])

  const handleConfirmAccuse = useCallback(
    async (suspectId: string, reasoning: string) => {
      if (!caseData) return
      setLoadingAccuse(true)
      setAccuseError(null)
      try {
        const res = await api.accuse(caseData.case_id, suspectId, reasoning)
        setVerdict(res)
        setAccuseOpen(false)
        setSelectedId(res.culprit_id)
        setPhase('verdict')
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Erro ao registrar acusação.'
        setAccuseError(`Não foi possível enviar a acusação (${msg}).`)
      } finally {
        setLoadingAccuse(false)
      }
    },
    [caseData],
  )

  const handleNewCaseFromVerdict = useCallback(() => {
    setVerdict(null)
    setCaseData(null)
    setSelectedId(null)
    setPhase('intro')
    void handleOpenCase()
  }, [handleOpenCase])

  const suspects = caseData?.suspects ?? []
  const selectedSuspect =
    suspects.find((s) => s.id === selectedId) ?? suspects[0] ?? null
  const activeSuspectId =
    phase === 'intro' || phase === 'briefing' || phase === 'cutscene'
      ? null
      : (selectedSuspect?.id ?? null)

  const currentPrologueLine =
    phase === 'cutscene' && caseData?.prologue
      ? (caseData.prologue[cutsceneIndex] ?? caseData.prologue[0] ?? null)
      : null

  const cutsceneState: CutsceneState | null = currentPrologueLine
    ? {
        shot: currentPrologueLine.shot,
        suspectId: currentPrologueLine.suspect_id,
        lineIndex: cutsceneIndex,
      }
    : null

  return (
    <div className="game-viewport">
      <Suspense fallback={<div className="scene-container" />}>
      <Scene
        suspects={suspects}
        selectedId={activeSuspectId}
        emotions={emotions}
        speakingId={speakingId}
        cutscene={cutsceneState}
        onSelect={handleSelectSuspect}
      />
      </Suspense>

      {phase === 'cutscene' &&
        caseData &&
        caseData.prologue.length > 0 && (
          <CutsceneOverlay
            caseId={caseData.case_id}
            lines={caseData.prologue}
            lineIndex={cutsceneIndex}
            officerName={caseData.officer_name}
            setting={caseData.setting}
            suspects={suspects}
            onAdvance={handleAdvanceCutscene}
            onFinish={handleFinishCutscene}
            onSkip={handleFinishCutscene}
          />
        )}

      {(phase === 'intro' || phase === 'briefing') && (
        <IntroScreen
          caseData={phase === 'briefing' ? caseData : null}
          loading={loadingCase}
          error={caseError}
          serverReady={serverReady}
          onOpenCase={(id) => void handleOpenCase(id)}
          onStartInterrogation={handleStartInterrogation}
        />
      )}

      {phase === 'playing' && caseData && (
        <div className="playing-ui-layer">
          <div className="top-bars">
            <HUD
              title={caseData.title}
              questionsLeft={questionsLeft}
              maxQuestions={caseData.max_questions}
              onAccuseClick={() => {
                setAccuseError(null)
                setAccuseOpen(true)
              }}
              onReplayIntro={
                caseData.prologue && caseData.prologue.length > 0
                  ? handleReplayIntro
                  : undefined
              }
            />
            <SuspectTabs
              suspects={suspects}
              selectedId={selectedSuspect?.id ?? null}
              emotions={emotions}
              onSelect={handleSelectSuspect}
            />
          </div>

          <ChatSheet
            suspect={selectedSuspect}
            messages={
              selectedSuspect ? (chats[selectedSuspect.id] ?? []) : []
            }
            currentEmotion={
              selectedSuspect
                ? (emotions[selectedSuspect.id] ?? 'calmo')
                : 'calmo'
            }
            questionsLeft={questionsLeft}
            loading={loadingChat}
            error={chatError}
            onSendQuestion={handleSendQuestion}
            onRetryLastQuestion={handleRetryLastQuestion}
            onTranscribe={(audio, lang) =>
              caseData ? api.transcribe(caseData.case_id, audio, lang) : Promise.reject(new Error('Caso não carregado.'))
            }
            onStartVoice={() => speechRef.current?.stop()}
            onOpenAccuse={() => {
              setAccuseError(null)
              setAccuseOpen(true)
            }}
          />
        </div>
      )}

      {accuseOpen && caseData && (
        <AccuseModal
          suspects={suspects}
          initialSuspectId={selectedSuspect?.id ?? null}
          loading={loadingAccuse}
          error={accuseError}
          onConfirm={(suspectId, reasoning) =>
            void handleConfirmAccuse(suspectId, reasoning)
          }
          onClose={() => setAccuseOpen(false)}
        />
      )}

      {(phase === 'intro' || phase === 'briefing' || phase === 'verdict') && <SoundControl variant="floating" />}

      {phase === 'verdict' && verdict && (
        <VerdictScreen
          verdict={verdict}
          loading={loadingCase}
          error={caseError}
          onNewCase={handleNewCaseFromVerdict}
        />
      )}
    </div>
  )
}
