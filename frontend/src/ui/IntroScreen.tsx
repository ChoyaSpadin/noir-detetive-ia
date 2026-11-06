import type { PublicCase } from '../api'
import { foreignBadge } from './language'
import { CaseArchive } from './CaseArchive'

interface IntroScreenProps {
  caseData: PublicCase | null
  loading: boolean
  error: string | null
  serverReady: boolean
  onOpenCase: (libraryId: string | null) => void
  onStartInterrogation: () => void
}

export function IntroScreen({
  caseData,
  loading,
  error,
  serverReady,
  onOpenCase,
  onStartInterrogation,
}: IntroScreenProps) {
  return (
    <div className="overlay-screen intro-overlay">
      <div className="glass-card intro-card">
        {!caseData ? (
          <div className="intro-hero">
            <span className="noir-badge">DIVISÃO DE HOMICÍDIOS • ARQUIVO CONFIDENCIAL</span>
            <h1 className="noir-title">NOIR: DETETIVE IA</h1>
            <p className="noir-subtitle">
              Interrogue os suspeitos. Encontre o culpado.
            </p>

            {error && (
              <div className="error-banner" role="alert">
                <p>{error}</p>
              </div>
            )}

            <CaseArchive serverReady={serverReady} loading={loading} onOpen={onOpenCase} />
          </div>
        ) : (
          <div className="briefing-content">
            <span className="noir-badge">DOSSIÊ DO CASO #{caseData.case_id.slice(0, 6).toUpperCase()}</span>
            <h1 className="briefing-title">{caseData.title}</h1>
            <p className="briefing-setting">📍 {caseData.setting}</p>

            <div className="briefing-section">
              <p className="briefing-intro">{caseData.intro}</p>
            </div>

            <div className="victim-box">
              <span className="victim-label">VÍTIMA</span>
              <strong className="victim-name">{caseData.victim.name}</strong>
              <p className="victim-desc">{caseData.victim.description}</p>
            </div>

            <div className="briefing-suspects-preview">
              {caseData.suspects.map((s) => (
                <div key={s.id} className="suspect-mini-badge">
                  <span
                    className="suspect-dot"
                    style={{ backgroundColor: s.look.accent }}
                  />
                  <div>
                    <strong>{s.name}</strong>
                    <span>{s.role}</span>
                    {foreignBadge(s) && <span className="foreign-badge">{foreignBadge(s)}</span>}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={onStartInterrogation}
            >
              Começar interrogatório
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
