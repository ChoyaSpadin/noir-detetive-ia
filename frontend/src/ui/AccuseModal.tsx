import { useState, type FormEvent } from 'react'
import type { PublicSuspect } from '../api'

interface AccuseModalProps {
  suspects: PublicSuspect[]
  initialSuspectId: string | null
  loading: boolean
  error: string | null
  onConfirm: (suspectId: string, reasoning: string) => void
  onClose: () => void
}

export function AccuseModal({
  suspects,
  initialSuspectId,
  loading,
  error,
  onConfirm,
  onClose,
}: AccuseModalProps) {
  const [chosenId, setChosenId] = useState<string>(
    initialSuspectId ?? suspects[0]?.id ?? '',
  )
  const [reasoning, setReasoning] = useState<string>('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!chosenId || loading) return
    onConfirm(chosenId, reasoning.trim())
  }

  return (
    <div className="overlay-screen modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="accuse-modal-title">
      <form className="glass-card modal-card" onSubmit={handleSubmit}>
        <div className="modal-header">
          <span className="noir-badge badge-danger">DECISÃO FINAL</span>
          <h2 id="accuse-modal-title" className="modal-title">
            Quem é o culpado?
          </h2>
          <p className="modal-subtitle">
            Esta ação encerra o interrogatório. Escolha o suspeito que cometeu o crime.
          </p>
        </div>

        <div className="accuse-suspect-list" role="radiogroup" aria-label="Escolha o suspeito para acusar">
          {suspects.map((s) => {
            const active = s.id === chosenId
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`accuse-suspect-option ${
                  active ? 'accuse-option-selected' : ''
                }`}
                onClick={() => setChosenId(s.id)}
                disabled={loading}
              >
                <span
                  className="suspect-dot"
                  style={{ backgroundColor: s.look.accent }}
                />
                <div className="accuse-option-info">
                  <strong>{s.name}</strong>
                  <span>{s.role}</span>
                </div>
                <span className="accuse-radio-indicator">
                  {active ? '●' : '○'}
                </span>
              </button>
            )
          })}
        </div>

        <label className="accuse-field-label" htmlFor="accuse-reasoning">
          Por que você acha que foi ele? <span className="optional-hint">(opcional)</span>
        </label>
        <textarea
          id="accuse-reasoning"
          className="accuse-textarea"
          rows={3}
          placeholder="Descreva sua linha de dedução, contradições no álibi ou pistas..."
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          disabled={loading}
        />

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => onConfirm(chosenId, reasoning.trim())}
              disabled={loading || !chosenId}
            >
              Tentar de novo
            </button>
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Voltar
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={!chosenId || loading}
          >
            {loading ? 'Registrando acusação...' : 'Confirmar acusação'}
          </button>
        </div>
      </form>
    </div>
  )
}
