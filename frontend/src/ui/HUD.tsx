import { SoundControl } from './SoundControl'
interface HUDProps {
  title: string
  questionsLeft: number
  maxQuestions: number
  onAccuseClick: () => void
  onReplayIntro?: () => void
}

export function HUD({
  title,
  questionsLeft,
  maxQuestions,
  onAccuseClick,
  onReplayIntro,
}: HUDProps) {
  const isLow = questionsLeft <= 2

  return (
    <header className="hud-bar">
      <div className="hud-info">
        <h2 className="hud-title" title={title}>
          {title}
        </h2>
        <div className="hud-subrow">
          <span
            className={`hud-counter ${isLow ? 'hud-counter-low' : ''}`}
            aria-live="polite"
          >
            Perguntas: {questionsLeft}/{maxQuestions}
          </span>
          {onReplayIntro && (
            <button
              type="button"
              className="hud-replay-btn"
              onClick={onReplayIntro}
            >
              Rever intro
            </button>
          )}
          <SoundControl />
        </div>
      </div>

      <button
        type="button"
        className="btn btn-danger hud-accuse-btn"
        onClick={onAccuseClick}
      >
        Acusar
      </button>
    </header>
  )
}
