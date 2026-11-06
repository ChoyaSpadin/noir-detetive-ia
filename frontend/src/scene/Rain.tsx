import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface RainProps {
  highQuality: boolean
  position?: [number, number, number]
}

const DEFAULT_POS: [number, number, number] = [0, 0, 0]
const MAX_DROPS = 600
const LOW_DROPS = 250
const WIND_TILT = 0.09

// Pre-allocated outside useFrame to prevent per-frame garbage collection
const dummy = new THREE.Object3D()

export function Rain({ highQuality, position = DEFAULT_POS }: RainProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const activeCount = highQuality ? MAX_DROPS : LOW_DROPS

  const { positions, speeds } = useMemo(() => {
    const pos = new Float32Array(MAX_DROPS * 3)
    const spd = new Float32Array(MAX_DROPS)

    for (let i = 0; i < MAX_DROPS; i++) {
      const i3 = i * 3
      pos[i3] = (Math.random() - 0.5) * 6.4
      pos[i3 + 1] = Math.random() * 4.4 + 0.2
      pos[i3 + 2] = -2.85 - Math.random() * 2.4
      spd[i] = 5.2 + Math.random() * 2.8
    }

    return { positions: pos, speeds: spd }
  }, [])

  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.count = activeCount
    }
  }, [activeCount])

  useFrame((_, delta) => {
    const mesh = meshRef.current
    if (!mesh) return

    const dt = Math.min(delta, 0.05)
    dummy.rotation.set(0, 0, WIND_TILT)

    for (let i = 0; i < activeCount; i++) {
      const i3 = i * 3
      const speed = speeds[i]

      positions[i3 + 1] -= speed * dt
      positions[i3] -= speed * dt * WIND_TILT

      if (positions[i3 + 1] < 0.1) {
        positions[i3 + 1] = 4.3 + Math.random() * 0.4
        positions[i3] = (Math.random() - 0.5) * 6.4
      }

      dummy.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2])
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }

    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      position={position}
      args={[undefined, undefined, MAX_DROPS]}
      frustumCulled={false}
    >
      <boxGeometry args={[0.011, 0.42, 0.011]} />
      <meshBasicMaterial
        color="#8eb8e5"
        transparent
        opacity={0.42}
        depthWrite={false}
      />
    </instancedMesh>
  )
}
