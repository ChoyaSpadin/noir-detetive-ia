import { Suspense } from 'react'
import { Character } from './characters/Character'
import { OUTFITS } from './characters/outfits'

interface OfficerProps {
  isSpeaking: boolean
  position?: [number, number, number]
  rotationY?: number
}

const DEFAULT_POS: [number, number, number] = [-0.55, 0, 0.65]

// Sargento na cena do crime: em pé, gesticula enquanto conta o caso.
export function Officer({ isSpeaking, position = DEFAULT_POS, rotationY = 0.22 }: OfficerProps) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Luz de lanterna/abajur no rosto, senão ele fica uma silhueta contra a janela */}
      <pointLight position={[0.35, 1.85, 0.9]} color="#ffd29a" intensity={3.2} distance={2.6} decay={1.6} />
      <Suspense fallback={null}>
        <Character outfit={OUTFITS.officer} clip={isSpeaking ? 'Idle_Talking_Loop' : 'Idle_Loop'} />
      </Suspense>
    </group>
  )
}
