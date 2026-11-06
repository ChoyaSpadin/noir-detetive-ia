import { Color } from 'three'
import type { Outfit } from './Character'

// Figurinos dos personagens fixos. Casos gerados usam outfitFor() com as cores do suspeito.
export const OUTFITS = {
  helena: { body: 'female', jacket: '#6e1630', pants: '#4a0f22', accent: '#e0b04a', shoes: '#1a0a0f', hair: 'long', hairColor: '#2a1a12', headwear: 'none', skinTint: '#f2dccb' },
  otavio: { body: 'male', jacket: '#3b4252', pants: '#2b303b', accent: '#c9a227', hair: 'simpleparted', hairColor: '#3a2e24', headwear: 'fedora', headwearColor: '#1e2128', skinTint: '#f0d6c0' },
  rosa: { body: 'female', jacket: '#2f4f4f', pants: '#1f3535', accent: '#e8e8e8', front: 'apron', shirt: '#e9e6df', hair: 'buns', hairColor: '#120c0a', headwear: 'none', skinTint: '#c99a78' },
  officer: { body: 'male', jacket: '#1b2a44', pants: '#16213a', accent: '#10151f', front: 'none', hair: 'buzzed', hairColor: '#1a1410', beard: true, headwear: 'cap', headwearColor: '#14203a', skinTint: '#b98a6a' },
  silhouette: { body: 'male', jacket: '#000', pants: '#000', accent: '#000', hair: 'none', hairColor: '#000', headwear: 'fedora', silhouette: true },
} satisfies Record<string, Outfit>

/**
 * Cores de roupa parecidas com pele (bege, marrom-claro, rosado) deixam o personagem com cara de
 * estar sem roupa. Aqui elas viram um tom escuro e dessaturado, mantendo um pouco do matiz.
 */
export function clothColor(hex: string): string {
  const c = new Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  const hueDeg = hsl.h * 360
  const skinLike = hueDeg >= 0 && hueDeg <= 50 && hsl.s > 0.12 && hsl.l > 0.18
  if (skinLike || hsl.l > 0.42) {
    c.setHSL(hsl.h, Math.min(hsl.s, 0.28), Math.min(hsl.l, 0.16))
  }
  return `#${c.getHexString()}`
}

// Nomes femininos comuns que não terminam em "a" (o resto se resolve pela terminação).
const FEMALE_NAMES = new Set([
  'ester', 'esther', 'raquel', 'isabel', 'carmen', 'alice', 'beatriz', 'ines', 'inês', 'ruth', 'rute',
  'noemi', 'noemia', 'lurdes', 'mercedes', 'dolores', 'iris', 'íris', 'aline', 'denise', 'elaine',
  'cristiane', 'simone', 'liliane', 'yasmin', 'ingrid', 'judite', 'judith', 'madalena', 'jaqueline',
  'irene', 'helen', 'ivone', 'yvone', 'dulce', 'rosemary', 'margot', 'conceição', 'conceicao', 'luz',
])
const MALE_A_NAMES = new Set(['luca', 'joshua', 'nicola', 'andrea', 'garcia', 'costa', 'moura'])

/** Gênero vindo do backend; sem ele, deduz pelo primeiro nome (tirando títulos como "Dona"). */
export function isFemale(name: string, gender?: string | null): boolean {
  if (gender === 'feminino') return true
  if (gender === 'masculino') return false
  const words = name.toLowerCase().split(/\s+/)
  if (['dona', 'senhora', 'sra.', 'madame', 'irmã', 'tia'].includes(words[0])) return true
  if (['seu', 'senhor', 'sr.', 'doutor', 'dr.', 'padre', 'tio'].includes(words[0])) return false
  const first = words[0] ?? ''
  if (FEMALE_NAMES.has(first)) return true
  if (MALE_A_NAMES.has(first)) return false
  return first.endsWith('a')
}

export function outfitFor(
  id: string,
  look: { color: string; accent: string; hat: boolean; gender?: string | null },
  index: number,
  name = '',
): Outfit {
  const known = (OUTFITS as Record<string, Outfit>)[id]
  if (known) return known
  const female = isFemale(name, look.gender)
  const color = clothColor(look.color)
  return {
    body: female ? 'female' : 'male',
    jacket: color,
    pants: color,
    accent: look.accent,
    hair: female ? (index % 2 === 0 ? 'long' : 'buns') : index % 2 === 0 ? 'simpleparted' : 'buzzed',
    hairColor: ['#2a1a12', '#120c0a', '#5a3a1e'][index % 3],
    headwear: look.hat ? 'fedora' : 'none',
    skinTint: ['#f0d6c0', '#c99a78', '#e8c4a8'][index % 3],
  }
}
