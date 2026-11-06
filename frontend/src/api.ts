// Contrato com o backend (FastAPI). Mantenha em sincronia com backend/app/schemas.py.

export type Emotion = 'calmo' | 'nervoso' | 'irritado' | 'triste' | 'evasivo'

export interface SuspectLook {
  color: string // cor principal do corpo, hex
  accent: string // cor de detalhe, hex
  hat: boolean
  height: number // 0.9 a 1.1, escala
  gender?: 'feminino' | 'masculino' | null
}

export interface PublicSuspect {
  id: string
  name: string
  role: string
  description: string
  look: SuspectLook
  nationality?: string | null // estrangeiro: fala com sotaque (voz Kokoro)
  speaks_portuguese?: boolean // false: só entende perguntas em inglês
}

// Cenas da intro animada, na ordem em que são tocadas.
// establishing: plano da cidade/prédio na chuva, com o letreiro do lugar e da data
// crime: o crime nas sombras (silhueta sem rosto, copo caindo, luz piscando). Nunca revela quem foi
// arrival: o detetive (jogador, câmera em primeira pessoa) chega à cena do crime
// officer: o policial fala com o detetive na cena do crime
// suspect: a câmera mostra um suspeito na sala de interrogatório (suspect_id obrigatório)
export type PrologueShot = 'establishing' | 'crime' | 'arrival' | 'officer' | 'suspect'

export interface PrologueLine {
  shot: PrologueShot
  speaker: 'narrador' | 'policial'
  text: string
  suspect_id: string | null
}

export interface PublicCase {
  prologue: PrologueLine[]
  officer_name: string // ex.: "Sargento Moreira"
  case_id: string
  title: string
  setting: string
  intro: string
  victim: { name: string; description: string }
  suspects: PublicSuspect[]
  max_questions: number
  questions_left: number
}

export interface InterrogateResponse {
  answer: string
  emotion: Emotion
  questions_left: number
  provider: string
  audio_url?: string | null // 1ª frase falada
  audio_urls?: string[] // resposta falada, frase por frase
}

export interface AccuseResponse {
  correct: boolean
  culprit_id: string
  culprit_name: string
  explanation: string
}

const BASE = import.meta.env.VITE_API_URL ?? ''

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `Erro ${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) detail = String(data.detail)
    } catch {
      /* resposta sem JSON */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export type StreamEvent =
  | { type: 'emotion'; emotion: Emotion }
  | { type: 'piece'; text: string; audio_url: string | null }
  | { type: 'done'; answer: string; emotion: Emotion; questions_left: number; provider: string }
  | { type: 'error'; detail: string }

/** Interrogatório em tempo real: chama onEvent para cada trecho (texto + voz) assim que chega. */
async function interrogateStream(
  caseId: string,
  suspectId: string,
  question: string,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const res = await fetch(`${BASE}/api/cases/${caseId}/interrogate/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suspect_id: suspectId, question }),
  })
  if (!res.ok || !res.body) {
    let detail = `Erro ${res.status}`
    try {
      const data = await res.json()
      if (data?.detail) detail = String(data.detail)
    } catch {
      /* sem JSON */
    }
    throw new Error(detail)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep = buf.indexOf('\n\n')
    while (sep >= 0) {
      const block = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const ev = JSON.parse(line.slice(6)) as StreamEvent
        if (ev.type === 'error') throw new Error(ev.detail)
        onEvent(ev)
      }
      sep = buf.indexOf('\n\n')
    }
  }
}

/** Pergunta falada -> texto (o backend usa o Whisper; entende português e inglês). */
async function transcribe(caseId: string, audio: Blob, language: 'pt' | 'en'): Promise<string> {
  const ext = audio.type.includes('mp4') ? 'mp4' : audio.type.includes('ogg') ? 'ogg' : 'webm'
  const form = new FormData()
  form.append('audio', audio, `pergunta.${ext}`)
  form.append('language', language) // o jogador escolhe: sem isso o Whisper traduz
  const res = await fetch(`${BASE}/api/cases/${caseId}/transcribe`, { method: 'POST', body: form })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail ? String(data.detail) : `Erro ${res.status}`)
  return String(data?.text ?? '')
}

export const api = {
  interrogateStream,
  transcribe,
  newCase: () => post<PublicCase>('/api/cases', {}),
  interrogate: (caseId: string, suspectId: string, question: string) =>
    post<InterrogateResponse>(`/api/cases/${caseId}/interrogate`, {
      suspect_id: suspectId,
      question,
    }),
  accuse: (caseId: string, suspectId: string, reasoning: string) =>
    post<AccuseResponse>(`/api/cases/${caseId}/accuse`, {
      suspect_id: suspectId,
      reasoning,
    }),
}
