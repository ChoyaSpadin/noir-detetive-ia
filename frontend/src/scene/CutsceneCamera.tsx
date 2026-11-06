import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { PrologueShot, PublicSuspect } from '../api'
import { getSuspectX } from './Suspect'

export interface CutsceneCameraProps {
  shot: PrologueShot
  suspectId: string | null
  lineIndex: number
  suspects: PublicSuspect[]
}

// Vetores pré-alocados no escopo de módulo (zero alocações dentro do useFrame)
const desiredPos = new THREE.Vector3()
const desiredLookAt = new THREE.Vector3()

export function CutsceneCamera({
  shot,
  suspectId,
  suspects,
}: CutsceneCameraProps) {
  const { camera } = useThree()
  const prevShotRef = useRef<PrologueShot | null>(null)
  const shotTimeRef = useRef<number>(0)
  const currentLookAt = useRef(new THREE.Vector3(0, 1.5, -40))
  const reducedMotionRef = useRef<boolean>(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionRef.current = mq.matches
    const handleChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches
    }
    mq.addEventListener?.('change', handleChange)
    return () => {
      mq.removeEventListener?.('change', handleChange)
    }
  }, [])

  // Restaura rotação z da câmera ao desmontar a câmera da cutscene
  useEffect(() => {
    return () => {
      camera.rotation.z = 0
    }
  }, [camera])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const reduced = reducedMotionRef.current
    const { width, height } = state.size
    const isPortrait = width / Math.max(height, 1) < 1

    const cam = state.camera as THREE.PerspectiveCamera
    const targetFov = isPortrait ? 54 : 44
    if (Math.abs(cam.fov - targetFov) > 0.05) {
      cam.fov = THREE.MathUtils.damp(cam.fov, targetFov, 6, dt)
      cam.updateProjectionMatrix()
    }

    const isCut = prevShotRef.current !== shot
    if (isCut) {
      prevShotRef.current = shot
      shotTimeRef.current = 0
    } else {
      shotTimeRef.current += dt
    }

    const st = shotTimeRef.current
    let targetDutchAngle = 0

    switch (shot) {
      case 'establishing': {
        // Rua em z = -40: travelling lento de baixo para cima + dolly in na fachada
        const p = reduced ? 0.5 : THREE.MathUtils.smoothstep(st, 0, 8.5)
        const swayX = reduced ? 0 : Math.sin(t * 0.45) * 0.08
        desiredPos.set(
          THREE.MathUtils.lerp(-0.45, 0.12, p) + swayX,
          THREE.MathUtils.lerp(0.78, 1.92, p),
          THREE.MathUtils.lerp(-34.1, -35.85, p),
        )
        desiredLookAt.set(
          0,
          THREE.MathUtils.lerp(1.45, 3.15, p),
          -40.0,
        )
        break
      }

      case 'crime': {
        // Escritório em x = 30: câmera baixa e inclinada (dutch angle)
        const p = reduced ? 0.4 : THREE.MathUtils.smoothstep(st, 0, 10.0)
        const swayY = reduced ? 0 : Math.sin(t * 0.8) * 0.018
        desiredPos.set(
          30 + THREE.MathUtils.lerp(0.82, 0.35, p),
          THREE.MathUtils.lerp(0.68, 0.78, p) + swayY,
          THREE.MathUtils.lerp(1.52, 1.15, p),
        )
        desiredLookAt.set(30 - 0.06, 0.94, -0.25)
        targetDutchAngle = reduced
          ? 0.14
          : 0.17 + Math.sin(t * 0.65) * 0.022
        break
      }

      case 'arrival': {
        // Escritório em x = 30: primeira pessoa entrando pela porta com balanço de passos
        const p = reduced ? 0.75 : THREE.MathUtils.smoothstep(st, 0, 6.2)
        const walking = !reduced && st < 6.0
        const stepBobY = walking ? Math.abs(Math.sin(st * 5.2)) * 0.036 : 0
        const stepSwayX = walking ? Math.sin(st * 2.6) * 0.026 : 0
        targetDutchAngle = walking ? Math.sin(st * 2.6) * 0.014 : 0

        desiredPos.set(
          30 + 0.12 + stepSwayX,
          1.46 + stepBobY,
          THREE.MathUtils.lerp(3.15, 1.48, p),
        )
        desiredLookAt.set(
          30 + THREE.MathUtils.lerp(0.05, -0.18, p),
          THREE.MathUtils.lerp(1.22, 1.04, p),
          -0.25,
        )
        break
      }

      case 'officer': {
        // Policial parado em [30 - 0.55, 0, 0.65]: plano médio com leve movimento
        const driftX = reduced ? 0 : Math.sin(t * 0.6) * 0.035
        const driftY = reduced ? 0 : Math.cos(t * 0.48) * 0.02
        const pushZ = reduced ? 0.08 : Math.min(st * 0.022, 0.18)

        // Personagem real tem ~1,8 m: câmera na altura dos olhos, enquadrando do peito para cima.
        desiredPos.set(
          30 - 0.3 + driftX,
          1.62 + driftY,
          (isPortrait ? 3.05 : 2.5) - pushZ,
        )
        desiredLookAt.set(30 - 0.55, isPortrait ? 1.38 : 1.48, 0.65)
        break
      }

      case 'suspect': {
        // Sala de interrogatório em [0, 0, 0]: enquadra o suspeito de suspectId
        const idx = suspectId
          ? suspects.findIndex((s) => s.id === suspectId)
          : 0
        const validIdx = idx >= 0 ? idx : 0
        const sx = getSuspectX(validIdx)
        const driftX = reduced ? 0 : Math.sin(t * 0.55) * 0.032
        const driftY = reduced ? 0 : Math.cos(t * 0.45) * 0.018

        if (isPortrait) {
          desiredPos.set(sx * 0.72 + driftX, 1.36 + driftY, 1.82)
          desiredLookAt.set(sx, 1.0, -0.85)
        } else {
          desiredPos.set(sx * 0.62 + driftX, 1.42 + driftY, 1.98)
          desiredLookAt.set(sx, 1.08, -0.85)
        }
        break
      }
    }

    if (isCut) {
      // Corte seco de câmera entre sets distantes
      cam.position.copy(desiredPos)
      currentLookAt.current.copy(desiredLookAt)
    } else {
      const dampSpeed = shot === 'suspect' ? 4.2 : 6.0
      cam.position.x = THREE.MathUtils.damp(
        cam.position.x,
        desiredPos.x,
        dampSpeed,
        dt,
      )
      cam.position.y = THREE.MathUtils.damp(
        cam.position.y,
        desiredPos.y,
        dampSpeed,
        dt,
      )
      cam.position.z = THREE.MathUtils.damp(
        cam.position.z,
        desiredPos.z,
        dampSpeed,
        dt,
      )

      currentLookAt.current.x = THREE.MathUtils.damp(
        currentLookAt.current.x,
        desiredLookAt.x,
        dampSpeed + 0.5,
        dt,
      )
      currentLookAt.current.y = THREE.MathUtils.damp(
        currentLookAt.current.y,
        desiredLookAt.y,
        dampSpeed + 0.5,
        dt,
      )
      currentLookAt.current.z = THREE.MathUtils.damp(
        currentLookAt.current.z,
        desiredLookAt.z,
        dampSpeed + 0.5,
        dt,
      )
    }

    cam.lookAt(currentLookAt.current)
    if (targetDutchAngle !== 0) {
      cam.rotation.z = targetDutchAngle
    }
  })

  return null
}
