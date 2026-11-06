import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { PublicSuspect } from '../api'
import { getSuspectX } from './Suspect'

interface CameraRigProps {
  suspects: PublicSuspect[]
  selectedId: string | null
}

// Pre-allocated vectors at module scope (zero allocations in useFrame)
const targetPos = new THREE.Vector3()
const targetLookAt = new THREE.Vector3()

export function CameraRig({ suspects, selectedId }: CameraRigProps) {
  const currentLookAt = useRef(new THREE.Vector3(0, 1.15, -0.8))

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const { width, height } = state.size
    const aspect = width / Math.max(height, 1)
    const isPortrait = aspect < 1
    const isWideDesktop = width > 900

    const cam = state.camera as THREE.PerspectiveCamera
    const desiredFov = isPortrait ? 56 : 44
    if (Math.abs(cam.fov - desiredFov) > 0.05) {
      cam.fov = THREE.MathUtils.damp(cam.fov, desiredFov, 5, dt)
      cam.updateProjectionMatrix()
    }

    const selectedIndex = selectedId
      ? suspects.findIndex((s) => s.id === selectedId)
      : -1

    if (selectedIndex === -1) {
      // Wide overview shot slowly orbiting/swaying for Intro or unselected state
      const baseZ = isPortrait ? 3.85 : 2.65
      const baseY = isPortrait ? 1.54 : 1.46
      const swayX = Math.sin(t * 0.32) * 0.52
      const swayZ = Math.cos(t * 0.22) * 0.16

      targetPos.set(swayX, baseY, baseZ + swayZ)
      targetLookAt.set(0, isPortrait ? 1.05 : 1.18, -0.75)
    } else {
      const sx = getSuspectX(selectedIndex)
      const gentleDriftX = Math.sin(t * 0.55) * 0.035
      const gentleDriftY = Math.cos(t * 0.45) * 0.02

      if (isPortrait) {
        // Portrait mobile: frame selected suspect in the upper half (above bottom sheet)
        targetPos.set(sx * 0.72 + gentleDriftX, 1.38 + gentleDriftY, 1.88)
        targetLookAt.set(sx, 0.96, -0.85)
      } else {
        // Landscape / Desktop: shift lookAt slightly right on >900px so suspect sits left of side panel
        const panelOffset = isWideDesktop ? 0.42 : 0
        targetPos.set(sx * 0.6 + panelOffset * 0.5 + gentleDriftX, 1.5 + gentleDriftY, 2.15)
        targetLookAt.set(sx + panelOffset, 1.08, -0.85)
      }
    }

    cam.position.x = THREE.MathUtils.damp(cam.position.x, targetPos.x, 3.8, dt)
    cam.position.y = THREE.MathUtils.damp(cam.position.y, targetPos.y, 3.8, dt)
    cam.position.z = THREE.MathUtils.damp(cam.position.z, targetPos.z, 3.8, dt)

    currentLookAt.current.x = THREE.MathUtils.damp(
      currentLookAt.current.x,
      targetLookAt.x,
      4.5,
      dt,
    )
    currentLookAt.current.y = THREE.MathUtils.damp(
      currentLookAt.current.y,
      targetLookAt.y,
      4.5,
      dt,
    )
    currentLookAt.current.z = THREE.MathUtils.damp(
      currentLookAt.current.z,
      targetLookAt.z,
      4.5,
      dt,
    )

    cam.lookAt(currentLookAt.current)
  })

  return null
}
