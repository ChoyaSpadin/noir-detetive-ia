import { Suspense, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import type { Emotion, PublicSuspect } from '../api'
import { Character, type ClipName } from './characters/Character'
import { outfitFor } from './characters/outfits'

interface SuspectProps {
  suspect: PublicSuspect
  index: number
  isSelected: boolean
  hasSelection: boolean
  emotion: Emotion
  isSpeaking: boolean
  isIntroducing?: boolean
  onSelect: (id: string) => void
}

export function getSuspectX(index: number): number {
  return (index - 1) * 1.15
}

// Linguagem corporal por emoção, somada por cima da animação sentada.
const BODY: Record<Emotion, { speed: number; head: { x: number; y: number }; lean: number }> = {
  calmo: { speed: 1, head: { x: 0, y: 0 }, lean: 0 },
  nervoso: { speed: 1.7, head: { x: 0.08, y: 0.12 }, lean: -0.04 },
  irritado: { speed: 1.2, head: { x: -0.1, y: 0 }, lean: 0.2 },
  triste: { speed: 0.7, head: { x: 0.42, y: 0 }, lean: 0.1 },
  evasivo: { speed: 1, head: { x: 0.05, y: 0.55 }, lean: -0.06 },
}

export function Suspect({
  suspect,
  index,
  isSelected,
  hasSelection,
  emotion,
  isSpeaking,
  isIntroducing = false,
  onSelect,
}: SuspectProps) {
  const keyLightRef = useRef<THREE.PointLight>(null)
  const rimLightRef = useRef<THREE.PointLight>(null)
  const outfit = useMemo(() => outfitFor(suspect.id, suspect.look, index, suspect.name), [suspect.id, suspect.look, index, suspect.name])
  const scale = 0.97 + ((suspect.look.height || 1) - 1) * 0.5

  // Na apresentação da intro o suspeito levanta a cabeça e encara a câmera.
  const body = BODY[emotion]
  const head = isIntroducing ? { x: -0.12, y: 0 } : body.head
  const clip: ClipName = isSpeaking || isIntroducing ? 'Sitting_Talking_Loop' : 'Sitting_Idle_Loop'

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    const dim = hasSelection && !isSelected
    if (keyLightRef.current) {
      keyLightRef.current.intensity = THREE.MathUtils.damp(keyLightRef.current.intensity, isSelected ? 3.8 : dim ? 0 : 0.6, 6, dt)
    }
    if (rimLightRef.current) {
      rimLightRef.current.intensity = THREE.MathUtils.damp(rimLightRef.current.intensity, isSelected ? 2.6 : 0, 6, dt)
    }
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(suspect.id)
  }

  return (
    <group position={[getSuspectX(index), 0, -0.85]}>
      <pointLight ref={keyLightRef} position={[0, 1.9, 0.75]} color="#ffca7a" intensity={0} distance={3} decay={1.8} />
      <pointLight ref={rimLightRef} position={[0.2, 1.7, -0.6]} color="#7ab3ff" intensity={0} distance={2.4} decay={1.8} />

      {isSelected && (
        <Suspense fallback={null}>
          <Text
            position={[0, 1.62 * scale, 0.05]}
            fontSize={0.1}
            color="#ffb257"
            anchorX="center"
            anchorY="bottom"
            outlineWidth={0.01}
            outlineColor="#07080c"
          >
            {suspect.name}
          </Text>
        </Suspense>
      )}

      <group
        scale={scale}
        position={[0, 0, 0.2]} // à frente do encosto: a animação sentada leva o quadril para trás
        onClick={handleClick}
        onPointerOver={() => {
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto'
        }}
      >
        <Suspense fallback={null}>
          <Character outfit={outfit} clip={clip} speed={body.speed} headTilt={head} spineLean={isIntroducing ? 0 : body.lean} />
        </Suspense>
      </group>
    </group>
  )
}
