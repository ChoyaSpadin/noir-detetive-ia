import { useState } from 'react'
import library from '../data/caseLibrary.json'
import { foreignBadge } from './language'

export interface LibraryCase {
  id: string
  title: string
  setting: string
  intro: string
  victim: string
  suspects: { name: string; role: string; nationality?: string | null; speaks_portuguese?: boolean }[]
}

const CASES = library as LibraryCase[]

interface CaseArchiveProps {
  serverReady: boolean
  loading: boolean
  onOpen: (libraryId: string | null) => void // null = caso inédito criado pela IA
}

/**
 * Arquivo da delegacia: pastas de casos prontos para escolher. Os dados vêm junto do site,
 * então a tela abre na hora, enquanto o servidor grátis "acorda" em segundo plano.
 */
export function CaseArchive({ serverReady, loading, onOpen }: CaseArchiveProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const chosen = CASES.find((c) => c.id === openId) ?? null

  const openButton = (id: string | null, label: string) => (
    <button
      type="button"
      className="btn btn-primary btn-large"
      onClick={() => onOpen(id)}
      disabled={loading || !serverReady}
    >
      {loading ? 'Abrindo dossiê...' : serverReady ? label : 'Acordando a delegacia...'}
    </button>
  )

  if (chosen) {
    return (
      <div className="archive-detail">
        <button type="button" className="btn btn-secondary btn-small archive-back" onClick={() => setOpenId(null)}>
          ‹ Voltar ao arquivo
        </button>
        <span className="noir-badge">PASTA {CASES.indexOf(chosen) + 1} • CONFIDENCIAL</span>
        <h2 className="briefing-title">{chosen.title}</h2>
        <p className="briefing-setting">📍 {chosen.setting}</p>
        <p className="briefing-intro">{chosen.intro}</p>
        <div className="victim-box">
          <span className="victim-label">VÍTIMA</span>
          <strong className="victim-name">{chosen.victim}</strong>
        </div>
        <div className="briefing-suspects-preview">
          {chosen.suspects.map((s) => (
            <div key={s.name} className="suspect-mini-badge">
              <div>
                <strong>{s.name}</strong>
                <span>{s.role}</span>
                {foreignBadge(s) && <span className="foreign-badge">{foreignBadge(s)}</span>}
              </div>
            </div>
          ))}
        </div>
        {openButton(chosen.id, 'Assumir o caso')}
        {!serverReady && <p className="archive-wake">O servidor grátis estava dormindo. Leva até 1 minuto na primeira visita.</p>}
      </div>
    )
  }

  return (
    <div className="archive">
      <p className="archive-hint">Escolha uma pasta do arquivo da delegacia.</p>
      <div className="archive-grid">
        {CASES.map((c, i) => {
          const foreign = c.suspects.map(foreignBadge).find(Boolean)
          return (
            <button key={c.id} type="button" className="archive-folder" onClick={() => setOpenId(c.id)}>
              <span className="archive-folder-tab">Nº {String(i + 1).padStart(3, '0')}</span>
              <strong>{c.title}</strong>
              <span className="archive-folder-setting">{c.setting}</span>
              {foreign && <span className="foreign-badge">{foreign}</span>}
            </button>
          )
        })}
        <button
          type="button"
          className="archive-folder archive-folder-new"
          onClick={() => onOpen(null)}
          disabled={loading || !serverReady}
        >
          <span className="archive-folder-tab">INÉDITO</span>
          <strong>Caso novo escrito pela IA</strong>
          <span className="archive-folder-setting">
            {serverReady ? 'Ninguém nunca viu este caso. Pode levar alguns segundos.' : 'Disponível assim que a delegacia acordar...'}
          </span>
        </button>
      </div>
      {!serverReady && <p className="archive-wake">Acordando a delegacia (servidor grátis): leia as pastas enquanto isso.</p>}
    </div>
  )
}
