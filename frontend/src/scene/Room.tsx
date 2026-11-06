import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { playThunder } from '../audio/ambience'

interface RoomProps {
  highQuality: boolean
  active?: boolean
}

const CHAIR_X = [-1.15, 0, 1.15] as const

export function Room({ highQuality, active = true }: RoomProps) {
  const windowLightRef = useRef<THREE.PointLight>(null)
  const windowGlassMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const lampGroupRef = useRef<THREE.Group>(null)

  // Lightning timer state stored in ref to avoid re-renders and allocations
  const lightningState = useRef({
    nextStrikeAt: 6 + Math.random() * 6,
    elapsed: 0,
    strikeTimer: -1,
  })

  useFrame((state, delta) => {
    if (!active) return
    const dt = Math.min(delta, 0.1)
    const ls = lightningState.current
    ls.elapsed += dt

    // Subtle sway on pendant lamp
    if (lampGroupRef.current) {
      lampGroupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.9) * 0.022
      lampGroupRef.current.rotation.x = Math.cos(state.clock.elapsedTime * 0.65) * 0.014
    }

    // Trigger lightning every 8 to 15 seconds randomly
    if (ls.elapsed >= ls.nextStrikeAt) {
      ls.elapsed = 0
      ls.nextStrikeAt = 8 + Math.random() * 7
      ls.strikeTimer = 0
      playThunder()
    }

    let flashFactor = 0
    if (ls.strikeTimer >= 0) {
      ls.strikeTimer += dt
      const t = ls.strikeTimer
      // Double-pulse lightning profile
      if (t < 0.07) {
        flashFactor = 1.0
      } else if (t < 0.14) {
        flashFactor = 0.15
      } else if (t < 0.24) {
        flashFactor = 0.85
      } else if (t < 0.65) {
        flashFactor = Math.max(0, (0.65 - t) / 0.41) * 0.4
      } else {
        ls.strikeTimer = -1
      }
    }

    if (windowLightRef.current) {
      windowLightRef.current.intensity = 1.35 + flashFactor * 14.0
    }
    if (windowGlassMatRef.current) {
      windowGlassMatRef.current.emissiveIntensity = 0.55 + flashFactor * 2.8
    }
  })

  return (
    <group>
      {/* Ambient base light */}
      <ambientLight intensity={0.28} color="#1a2234" />

      {/* Cold blue fill light from the window */}
      <pointLight
        ref={windowLightRef}
        position={[0, 2.05, -2.15]}
        color="#5b8fd9"
        intensity={1.35}
        distance={10}
        decay={1.6}
      />

      {/* Secondary exterior backlight for rain/window silhouette */}
      <pointLight
        position={[0, 2.4, -3.4]}
        color="#3b68a8"
        intensity={1.8}
        distance={8}
      />

      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        {highQuality ? (
          <MeshReflectorMaterial
            blur={[200, 60]}
            resolution={512}
            mixBlur={0.9}
            mixStrength={0.65}
            roughness={0.62}
            depthScale={0.6}
            minDepthThreshold={0.3}
            maxDepthThreshold={1.2}
            color="#0b0d14"
            metalness={0.35}
            mirror={0.3}
          />
        ) : (
          <meshStandardMaterial
            color="#0b0d14"
            roughness={0.65}
            metalness={0.25}
          />
        )}
      </mesh>

      {/* Back wall segments framing the window at z = -2.6 */}
      <group position={[0, 0, -2.6]}>
        {/* Bottom wall below window */}
        <mesh position={[0, 0.45, 0]} receiveShadow>
          <boxGeometry args={[12, 0.9, 0.16]} />
          <meshStandardMaterial color="#0e111a" roughness={0.9} />
        </mesh>
        {/* Top wall above window */}
        <mesh position={[0, 3.45, 0]} receiveShadow>
          <boxGeometry args={[12, 1.3, 0.16]} />
          <meshStandardMaterial color="#0e111a" roughness={0.9} />
        </mesh>
        {/* Left wall beside window */}
        <mesh position={[-3.9, 1.85, 0]} receiveShadow>
          <boxGeometry args={[4.2, 1.9, 0.16]} />
          <meshStandardMaterial color="#0e111a" roughness={0.9} />
        </mesh>
        {/* Right wall beside window */}
        <mesh position={[3.9, 1.85, 0]} receiveShadow>
          <boxGeometry args={[4.2, 1.9, 0.16]} />
          <meshStandardMaterial color="#0e111a" roughness={0.9} />
        </mesh>

        {/* Window outer frame */}
        <mesh position={[0, 0.92, 0.04]}>
          <boxGeometry args={[3.72, 0.08, 0.22]} />
          <meshStandardMaterial color="#181c26" roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[0, 2.78, 0.04]}>
          <boxGeometry args={[3.72, 0.08, 0.22]} />
          <meshStandardMaterial color="#181c26" roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[-1.82, 1.85, 0.04]}>
          <boxGeometry args={[0.08, 1.9, 0.22]} />
          <meshStandardMaterial color="#181c26" roughness={0.6} metalness={0.3} />
        </mesh>
        <mesh position={[1.82, 1.85, 0.04]}>
          <boxGeometry args={[0.08, 1.9, 0.22]} />
          <meshStandardMaterial color="#181c26" roughness={0.6} metalness={0.3} />
        </mesh>

        {/* Window mullions (vertical & horizontal bars) */}
        <mesh position={[-0.6, 1.85, 0.02]}>
          <boxGeometry args={[0.045, 1.86, 0.12]} />
          <meshStandardMaterial color="#141821" roughness={0.7} />
        </mesh>
        <mesh position={[0.6, 1.85, 0.02]}>
          <boxGeometry args={[0.045, 1.86, 0.12]} />
          <meshStandardMaterial color="#141821" roughness={0.7} />
        </mesh>
        <mesh position={[0, 1.85, 0.02]}>
          <boxGeometry args={[3.6, 0.045, 0.12]} />
          <meshStandardMaterial color="#141821" roughness={0.7} />
        </mesh>

        {/* Bluish emissive translucent window glass */}
        <mesh position={[0, 1.85, -0.02]}>
          <planeGeometry args={[3.6, 1.86]} />
          <meshStandardMaterial
            ref={windowGlassMatRef}
            color="#152844"
            emissive="#29528a"
            emissiveIntensity={0.55}
            transparent
            opacity={0.44}
            roughness={0.2}
            metalness={0.1}
          />
        </mesh>
      </group>

      {/* Side walls for noir enclosure */}
      <mesh position={[-4.8, 2.0, -0.2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[8, 4.5]} />
        <meshStandardMaterial color="#090b10" roughness={0.95} />
      </mesh>
      <mesh position={[4.8, 2.0, -0.2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[8, 4.5]} />
        <meshStandardMaterial color="#090b10" roughness={0.95} />
      </mesh>

      {/* Interrogation Wooden Table in the center */}
      <group position={[0, 0, -0.15]}>
        {/* Table top */}
        <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.25, 0.07, 1.05]} />
          <meshStandardMaterial color="#2c1d13" roughness={0.68} metalness={0.08} />
        </mesh>
        {/* Table apron frame */}
        <mesh position={[0, 0.71, 0]} castShadow>
          <boxGeometry args={[3.05, 0.07, 0.88]} />
          <meshStandardMaterial color="#1f140d" roughness={0.8} />
        </mesh>
        {/* 4 Legs */}
        <mesh position={[-1.45, 0.37, -0.4]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.74, 0.08]} />
          <meshStandardMaterial color="#1b110b" roughness={0.8} />
        </mesh>
        <mesh position={[1.45, 0.37, -0.4]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.74, 0.08]} />
          <meshStandardMaterial color="#1b110b" roughness={0.8} />
        </mesh>
        <mesh position={[-1.45, 0.37, 0.4]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.74, 0.08]} />
          <meshStandardMaterial color="#1b110b" roughness={0.8} />
        </mesh>
        <mesh position={[1.45, 0.37, 0.4]} castShadow receiveShadow>
          <boxGeometry args={[0.08, 0.74, 0.08]} />
          <meshStandardMaterial color="#1b110b" roughness={0.8} />
        </mesh>

        {/* Noir props on the table: case folder & coffee mug */}
        <mesh position={[-0.35, 0.822, 0.14]} rotation={[0, 0.18, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.38, 0.015, 0.28]} />
          <meshStandardMaterial color="#a68350" roughness={0.85} />
        </mesh>
        <mesh position={[-0.33, 0.832, 0.14]} rotation={[0, 0.08, 0]}>
          <boxGeometry args={[0.32, 0.008, 0.24]} />
          <meshStandardMaterial color="#d8cfb8" roughness={0.9} />
        </mesh>
        <mesh position={[0.52, 0.86, 0.18]} castShadow>
          <cylinderGeometry args={[0.045, 0.04, 0.09, 12]} />
          <meshStandardMaterial color="#2a2e38" roughness={0.4} metalness={0.2} />
        </mesh>
      </group>

      {/* 3 Chairs behind the table for the suspects */}
      {CHAIR_X.map((x) => (
        <group key={x} position={[x, 0, -0.88]}>
          {/* Seat */}
          <mesh position={[0, 0.48, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.52, 0.05, 0.5]} />
            <meshStandardMaterial color="#1c1512" roughness={0.75} />
          </mesh>
          {/* Backrest */}
          <mesh position={[0, 0.86, -0.22]} castShadow receiveShadow>
            <boxGeometry args={[0.5, 0.72, 0.05]} />
            <meshStandardMaterial color="#1c1512" roughness={0.75} />
          </mesh>
          {/* Chair legs */}
          <mesh position={[-0.21, 0.24, -0.2]} castShadow>
            <boxGeometry args={[0.045, 0.48, 0.045]} />
            <meshStandardMaterial color="#120e0c" roughness={0.85} />
          </mesh>
          <mesh position={[0.21, 0.24, -0.2]} castShadow>
            <boxGeometry args={[0.045, 0.48, 0.045]} />
            <meshStandardMaterial color="#120e0c" roughness={0.85} />
          </mesh>
          <mesh position={[-0.21, 0.24, 0.2]} castShadow>
            <boxGeometry args={[0.045, 0.48, 0.045]} />
            <meshStandardMaterial color="#120e0c" roughness={0.85} />
          </mesh>
          <mesh position={[0.21, 0.24, 0.2]} castShadow>
            <boxGeometry args={[0.045, 0.48, 0.045]} />
            <meshStandardMaterial color="#120e0c" roughness={0.85} />
          </mesh>
        </group>
      ))}

      {/* Pendant Lamp with Amber SpotLight */}
      <group ref={lampGroupRef} position={[0, 3.6, -0.22]}>
        {/* Cord */}
        <mesh position={[0, -0.68, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1.36, 8]} />
          <meshStandardMaterial color="#111318" roughness={0.8} />
        </mesh>
        {/* Metal shade */}
        <mesh position={[0, -1.38, 0]} castShadow>
          <coneGeometry args={[0.34, 0.22, 20, 1, true]} />
          <meshStandardMaterial
            color="#181a22"
            roughness={0.45}
            metalness={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* Emissive bulb */}
        <mesh position={[0, -1.43, 0]}>
          <sphereGeometry args={[0.065, 12, 12]} />
          <meshStandardMaterial
            color="#ffe3b3"
            emissive="#ffb257"
            emissiveIntensity={2.8}
          />
        </mesh>
        {/* Warm glow around the bulb */}
        <pointLight
          position={[0, -1.46, 0]}
          color="#ffb257"
          intensity={1.1}
          distance={4.5}
          decay={2}
        />
        {/* Main Amber SpotLight with soft shadows */}
        <spotLight
          position={[0, -1.44, 0]}
          color="#ffb257"
          intensity={9.5}
          distance={9}
          angle={1.05}
          penumbra={0.75}
          decay={1.4}
          castShadow
          onUpdate={(self) => {
            self.shadow.mapSize.set(512, 512)
            self.shadow.bias = -0.0005
          }}
        />
      </group>
    </group>
  )
}
