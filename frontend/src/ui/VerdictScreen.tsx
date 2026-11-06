import type { AccuseResponse } from '../api'

interface VerdictScreenProps {
  verdict: AccuseResponse
  loading: boolean
  error: string | null
  onNewCase: () => void
}

export function VerdictScreen({
  verdict,
  loading,
  error,
  onNewCase,
}: VerdictScreenProps) {
  return (
    <div className="overlay-screen verdict-overlay">
      <div className="glass-card verdict-card">
        <span
          className={`verdict-stamp ${
            verdict.correct ? 'stamp-success' : 'stamp-fail'
          }`}
        >
          {verdict.correct ? 'CASO SOLUCIONADO' : 'DEDUÇÃO EQUIVOCADA'}
        </span>

        <h1
          className={`verdict-headline ${
            verdict.correct ? 'verdict-correct' : 'verdict-wrong'
          }`}
        >
          {verdict.correct
            ? 'Você encontrou o verdadeiro culpado!'
            : 'O verdadeiro culpado escapou na chuva...'}
        </h1>

        <div className="verdict-culprit-box">
          <span className="verdict-label">CULPADO DO CASO</span>
          <strong className="verdict-culprit-name">{verdict.culprit_name}</strong>
        </div>

        <div className="verdict-explanation">
          <span className="verdict-label">RELATÓRIO DE CONCLUSÃO</span>
          <p>{verdict.explanation}</p>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={onNewCase}
              disabled={loading}
            >
              Tentar de novo
            </button>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary btn-large"
          onClick={onNewCase}
          disabled={loading}
        >
          {loading ? 'Abrindo novo caso...' : 'Novo caso'}
        </button>
      </div>
    </div>
  )
}
