import type { PublicSuspect } from '../api'

export const FLAGS: Record<string, string> = {
  americano: '🇺🇸',
  inglês: '🇬🇧',
  italiano: '🇮🇹',
  francês: '🇫🇷',
  espanhol: '🇪🇸',
  japonês: '🇯🇵',
}

export type SpeechLang = 'pt' | 'en'

/** Selo curto de estrangeiro (null para brasileiro). Ex.: "🇮🇹 Italiano · pouco português". */
export function foreignBadge(s: PublicSuspect): string | null {
  if (!s.nationality) return null
  const flag = FLAGS[s.nationality] ?? '🌍'
  const nat = s.nationality[0].toUpperCase() + s.nationality.slice(1)
  return s.speaks_portuguese === false ? `${flag} ${nat} · só inglês` : `${flag} ${nat} · pouco português`
}

/** Idioma inicial do microfone para esse suspeito. */
export function defaultSpeechLang(s: PublicSuspect): SpeechLang {
  return s.speaks_portuguese === false ? 'en' : 'pt'
}
