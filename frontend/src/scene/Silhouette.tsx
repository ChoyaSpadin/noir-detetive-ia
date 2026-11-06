import { Suspense, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Character, type ClipName } from './characters/Character'
import { OUTFITS } from './characters/outfits'

interface SilhouetteProps {
  active: boolean
}

// Figura sem rosto e sem cores: entra, envenena o copo e some. Não revela o culpado.
export function Silhouette({ active }: SilhouetteProps) {
  const rootRef = useRef<THREE.Group>(null)
  const st = useRef({ wasActive: false, elapsed: 0 })
  const [clip, setClip] = useState<ClipName>('Walk_Formal_Loop')

  useFrame((_, delta) => {
    const root = rootRef.current
    if (!root) return
    const s = st.current
    if (!active) {
      s.wasActive = false
      s.elapsed = 0
      root.visible = false
      return
    }
    if (!s.wasActive) {
      s.wasActive = true
      s.elapsed = 0
      root.position.set(-1.65, 0, -0.68)
    }
    const dt = Math.min(delta, 0.05)
    s.elapsed += dt
    const t = s.elapsed
    root.visible = t < 6.4

    let x = -1.65
    let z = -0.68
    let yaw = 0.95
    let next: ClipName = 'Walk_Formal_Loop'
    if (t < 1.8) {
      const p = THREE.MathUtils.smoothstep(t, 0, 1.8)
      x = THREE.MathUtils.lerp(-1.65, -0.3, p)
      z = THREE.MathUtils.lerp(-0.68, -0.5, p)
      yaw = THREE.MathUtils.lerp(1.2, 0.5, p)
    } else if (t < 3.9) {
      x = -0.3
      z = -0.5
      yaw = 0.5
      next = 'Interact' // gesto de despejar algo no copo
    } else {
      const p = THREE.MathUtils.smoothstep(t, 3.9, 6.2)
      x = THREE.MathUtils.lerp(-0.3, -2.35, p)
      z = THREE.MathUtils.lerp(-0.5, -0.82, p)
      yaw = -1.5
    }
    root.position.x = THREE.MathUtils.damp(root.position.x, x, 8, dt)
    root.position.z = THREE.MathUtils.damp(root.position.z, z, 8, dt)
    root.rotation.y = THREE.MathUtils.damp(root.rotation.y, yaw, 7, dt)
    if (next !== clip) setClip(next)
  })

  return (
    <group ref={rootRef} visible={false}>
      <Suspense fallback={null}>
        <Character outfit={OUTFITS.silhouette} clip={clip} />
      </Suspense>
    </group>
  )
}
