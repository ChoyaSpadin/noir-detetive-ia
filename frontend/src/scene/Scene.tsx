import { useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import {
  EffectComposer,
  Bloom,
  Vignette,
  Noise,
} from '@react-three/postprocessing'
import type { Emotion, PrologueShot, PublicSuspect } from '../api'
import { Room } from './Room'
import { Rain } from './Rain'
import { Suspect } from './Suspect'
import { CameraRig } from './CameraRig'
import { CutsceneCamera } from './CutsceneCamera'
import { Street } from './sets/Street'
import { CrimeOffice } from './sets/CrimeOffice'

export interface CutsceneState {
  shot: PrologueShot
  suspectId: string | null
  lineIndex: number
}

export interface SceneProps {
  suspects: PublicSuspect[]
  selectedId: string | null
  emotions: Record<string, Emotion>
  speakingId: string | null
  cutscene: CutsceneState | null
  onSelect: (id: string) => void
}

const PLACEHOLDER_SUSPECTS: PublicSuspect[] = [
  {
    id: 'preview-1',
    name: 'Suspeito I',
    role: 'Silhueta',
    description: '',
    look: { color: '#242b38', accent: '#8c3b35', hat: true, height: 1.04 },
  },
  {
    id: 'preview-2',
    name: 'Suspeito II',
    role: 'Silhueta',
    description: '',
    look: { color: '#2f242c', accent: '#c9974c', hat: false, height: 0.96 },
  },
  {
    id: 'preview-3',
    name: 'Suspeito III',
    role: 'Silhueta',
    description: '',
    look: { color: '#1f2d2b', accent: '#4e7a8c', hat: true, height: 1.0 },
  },
]

const RAIN_POS_ROOM: [number, number, number] = [0, 0, 0]
const RAIN_POS_STREET: [number, number, number] = [0, 0, -34.2]
const RAIN_POS_OFFICE: [number, number, number] = [30, 0, 0]

export function Scene({
  suspects,
  selectedId,
  emotions,
  speakingId,
  cutscene,
  onSelect,
}: SceneProps) {
  const [dpr, setDpr] = useState<[number, number]>([1, 1.75])
  const [highQuality, setHighQuality] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    return window.innerWidth >= 768
  })

  const visibleSuspects =
    suspects.length > 0 ? suspects : PLACEHOLDER_SUSPECTS

  const isStreetActive = cutscene?.shot === 'establishing'
  const isOfficeActive =
    cutscene?.shot === 'crime' ||
    cutscene?.shot === 'arrival' ||
    cutscene?.shot === 'officer'
  const isRoomActive = !cutscene || cutscene.shot === 'suspect'

  const effectiveSelectedId = cutscene
    ? cutscene.shot === 'suspect'
      ? cutscene.suspectId
      : null
    : selectedId
  const hasSelection = effectiveSelectedId !== null && suspects.length > 0

  const rainPosition = isStreetActive
    ? RAIN_POS_STREET
    : isOfficeActive
      ? RAIN_POS_OFFICE
      : RAIN_POS_ROOM

  return (
    <div className="scene-container">
      <Canvas
        dpr={dpr}
        shadows
        camera={{ position: [0, 1.48, 2.8], fov: 46, near: 0.1, far: 25 }}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#07080c']} />
        <fog attach="fog" args={['#07080c', 3.8, 12.2]} />

        <PerformanceMonitor
          onDecline={() => {
            setDpr([1, 1])
            setHighQuality(false)
          }}
          onFallback={() => {
            setDpr([1, 1])
            setHighQuality(false)
          }}
          onIncline={() => {
            setDpr([1, 1.75])
            setHighQuality(true)
          }}
        />

        {cutscene ? (
          <CutsceneCamera
            shot={cutscene.shot}
            suspectId={cutscene.suspectId}
            lineIndex={cutscene.lineIndex}
            suspects={visibleSuspects}
          />
        ) : (
          <CameraRig suspects={visibleSuspects} selectedId={selectedId} />
        )}

        <Rain highQuality={highQuality} position={rainPosition} />

        {/* Set 1: Rua noturna (establishing) */}
        <group visible={isStreetActive}>
          <Street highQuality={highQuality} active={isStreetActive} />
        </group>

        {/* Set 2: Escritório do crime (crime, arrival, officer) */}
        <group visible={isOfficeActive}>
          <CrimeOffice
            phase={cutscene?.shot === 'crime' ? 'crime' : 'investigation'}
            highQuality={highQuality}
            active={isOfficeActive}
            officerSpeaking={cutscene?.shot === 'officer'}
          />
        </group>

        {/* Set 3: Sala de interrogatório (suspect + jogo principal) */}
        <group visible={isRoomActive}>
          <Room highQuality={highQuality} active={isRoomActive} />
          {visibleSuspects.map((suspect, index) => (
            <Suspect
              key={suspect.id}
              suspect={suspect}
              index={index}
              isSelected={effectiveSelectedId === suspect.id}
              hasSelection={hasSelection}
              emotion={emotions[suspect.id] ?? 'calmo'}
              isSpeaking={speakingId === suspect.id}
              isIntroducing={
                cutscene?.shot === 'suspect' &&
                cutscene.suspectId === suspect.id
              }
              onSelect={(id) => {
                if (!cutscene && suspects.length > 0) {
                  onSelect(id)
                }
              }}
            />
          ))}
        </group>

        {highQuality && (
          <EffectComposer multisampling={0}>
            <Bloom
              luminanceThreshold={0.78}
              luminanceSmoothing={0.35}
              intensity={0.45}
              mipmapBlur
            />
            <Vignette offset={0.24} darkness={0.72} />
            <Noise opacity={0.032} premultiply />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  )
}
