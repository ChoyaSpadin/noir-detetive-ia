import type { Emotion, PublicSuspect } from '../api'
import { foreignBadge } from './language'

interface SuspectTabsProps {
  suspects: PublicSuspect[]
  selectedId: string | null
  emotions: Record<string, Emotion>
  onSelect: (id: string) => void
}

export function SuspectTabs({
  suspects,
  selectedId,
  emotions,
  onSelect,
}: SuspectTabsProps) {
  return (
    <nav className="suspect-tabs" aria-label="Suspeitos">
      {suspects.map((suspect) => {
        const isSelected = suspect.id === selectedId
        const emotion = emotions[suspect.id] ?? 'calmo'

        return (
          <button
            key={suspect.id}
            type="button"
            className={`suspect-tab ${isSelected ? 'suspect-tab-active' : ''}`}
            onClick={() => onSelect(suspect.id)}
            aria-pressed={isSelected}
          >
            <span
              className="suspect-tab-swatch"
              style={{ backgroundColor: suspect.look.accent }}
            />
            <span className="suspect-tab-text">
              <span className="suspect-tab-name">{suspect.name}</span>
              {foreignBadge(suspect) && <span className="foreign-badge">{foreignBadge(suspect)}</span>}
              <span className="suspect-tab-role">
                {suspect.role} • {emotion}
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
