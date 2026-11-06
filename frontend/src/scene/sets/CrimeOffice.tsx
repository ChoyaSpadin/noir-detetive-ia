import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { playThunder } from '../../audio/ambience'
import { Silhouette } from '../Silhouette'
import { Officer } from '../Officer'

export interface CrimeOfficeProps {
  phase: 'crime' | 'investigation'
  highQuality: boolean
  active: boolean
  officerSpeaking?: boolean
}

export function CrimeOffice({
  phase,
  highQuality,
  active,
  officerSpeaking = false,
}: CrimeOfficeProps) {
  const windowLightRef = useRef<THREE.PointLight>(null)
  const windowGlassMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const deskLampLightRef = useRef<THREE.PointLight>(null)
  const deskBulbMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const forensicFlashRef = useRef<THREE.PointLight>(null)
  const glassGroupRef = useRef<THREE.Group>(null)

  const stateRef = useRef({
    wasActive: false,
    prevPhase: phase,
    elapsed: 0,
    thunderFired: false,
    nextFlashAt: 1.6,
    flashTimer: -1,
  })

  useFrame((_, delta) => {
    const st = stateRef.current
    if (!active) {
      st.wasActive = false
      st.elapsed = 0
      st.thunderFired = false
      st.flashTimer = -1
      return
    }

    if (!st.wasActive || st.prevPhase !== phase) {
      st.wasActive = true
      st.prevPhase = phase
      st.elapsed = 0
      st.thunderFired = false
      st.nextFlashAt = 1.4
      st.flashTimer = -1
    }

    const dt = Math.min(delta, 0.05)
    st.elapsed += dt
    const t = st.elapsed

    if (phase === 'crime') {
      // Luminária de mesa pisca após a silhueta despejar o veneno (~3.8s a 5.2s)
      let lampFactor = 1
      if (t > 3.7 && t < 5.1) {
        lampFactor =
          Math.sin(t * 42) > 0.15 && Math.cos(t * 19) > -0.2 ? 0.12 : 1.35
      } else if (t >= 5.1) {
        lampFactor = 0.35
      }

      if (deskLampLightRef.current) {
        deskLampLightRef.current.intensity = 2.8 * lampFactor
      }
      if (deskBulbMatRef.current) {
        deskBulbMatRef.current.emissiveIntensity = 2.4 * lampFactor
      }

      // O copo tomba aos 4.3s e rola sobre a mesa
      if (glassGroupRef.current) {
        if (t < 4.3) {
          glassGroupRef.current.position.set(0.22, 0.845, 0.14)
          glassGroupRef.current.rotation.set(0, 0, 0)
        } else {
          const tipP = THREE.MathUtils.smoothstep(t, 4.3, 4.65)
          const rollP = THREE.MathUtils.smoothstep(t, 4.55, 5.65)
          glassGroupRef.current.position.set(
            0.22 + rollP * 0.28,
            0.845 - tipP * 0.02,
            0.14 + rollP * 0.06,
          )
          glassGroupRef.current.rotation.set(
            rollP * 2.8,
            rollP * 0.25,
            tipP * (Math.PI / 2 - 0.08),
          )
        }
      }

      // Relâmpago forte clareia a sala aos 4.8s
      if (t >= 4.8 && !st.thunderFired) {
        st.thunderFired = true
        playThunder()
      }

      let lightningFlash = 0
      const lt = t - 4.8
      if (lt >= 0 && lt < 0.08) lightningFlash = 1.0
      else if (lt >= 0.08 && lt < 0.15) lightningFlash = 0.2
      else if (lt >= 0.15 && lt < 0.26) lightningFlash = 0.9
      else if (lt >= 0.26 && lt < 0.75) {
        lightningFlash = Math.max(0, (0.75 - lt) / 0.49) * 0.45
      }

      if (windowLightRef.current) {
        windowLightRef.current.intensity = 1.1 + lightningFlash * 15.0
      }
      if (windowGlassMatRef.current) {
        windowGlassMatRef.current.emissiveIntensity = 0.5 + lightningFlash * 3.0
      }
      if (forensicFlashRef.current) {
        forensicFlashRef.current.intensity = 0
      }
    } else {
      // Phase === 'investigation' (arrival + officer)
      if (deskLampLightRef.current) {
        deskLampLightRef.current.intensity = 1.6
      }
      if (deskBulbMatRef.current) {
        deskBulbMatRef.current.emissiveIntensity = 1.8
      }
      if (windowLightRef.current) {
        windowLightRef.current.intensity = 1.35
      }
      if (windowGlassMatRef.current) {
        windowGlassMatRef.current.emissiveIntensity = 0.55
      }

      // Copo já caído sobre a mesa
      if (glassGroupRef.current) {
        glassGroupRef.current.position.set(0.5, 0.825, 0.2)
        glassGroupRef.current.rotation.set(2.8, 0.25, Math.PI / 2 - 0.08)
      }

      // Flashes fotográficos da perícia piscando de vez em quando
      if (t >= st.nextFlashAt) {
        st.nextFlashAt = t + 2.6 + Math.random() * 1.8
        st.flashTimer = 0
      }

      let flashVal = 0
      if (st.flashTimer >= 0) {
        st.flashTimer += dt
        const ft = st.flashTimer
        if (ft < 0.05) flashVal = 1.0
        else if (ft < 0.12) flashVal = 0.15
        else if (ft < 0.18) flashVal = 0.75
        else if (ft < 0.38) flashVal = (0.38 - ft) * 1.5
        else st.flashTimer = -1
      }

      if (forensicFlashRef.current) {
        forensicFlashRef.current.intensity = flashVal * 12.0
      }
    }
  })

  const isInvestigation = phase === 'investigation'

  return (
    <group position={[30, 0, 0]}>
      {/* Luz fria da janela e relâmpago */}
      <pointLight
        ref={windowLightRef}
        position={[0, 2.05, -2.15]}
        color="#5b8fd9"
        intensity={1.2}
        distance={10}
        decay={1.6}
      />

      {/* Luz fria de teto acesa durante a investigação */}
      {isInvestigation && (
        <pointLight
          position={[0, 2.85, 0.35]}
          color="#b8d4ff"
          intensity={3.2}
          distance={9.5}
          decay={1.5}
        />
      )}

      {/* Flash de câmera da perícia */}
      <pointLight
        ref={forensicFlashRef}
        position={[1.35, 1.55, 1.1]}
        color="#eef5ff"
        intensity={0}
        distance={9}
        decay={1.5}
      />

      {/* Piso do escritório */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        {highQuality ? (
          <MeshReflectorMaterial
            blur={[180, 50]}
            resolution={512}
            mixBlur={0.9}
            mixStrength={0.55}
            roughness={0.66}
            depthScale={0.5}
            minDepthThreshold={0.3}
            maxDepthThreshold={1.2}
            color="#0d0b0a"
            metalness={0.28}
            mirror={0.25}
          />
        ) : (
          <meshStandardMaterial
            color="#0d0b0a"
            roughness={0.68}
            metalness={0.2}
          />
        )}
      </mesh>

      {/* Parede do fundo com janela e persianas horizontais noir */}
      <group position={[0, 0, -2.6]}>
        <mesh position={[0, 0.45, 0]} receiveShadow>
          <boxGeometry args={[10, 0.9, 0.16]} />
          <meshStandardMaterial color="#121016" roughness={0.9} />
        </mesh>
        <mesh position={[0, 3.45, 0]} receiveShadow>
          <boxGeometry args={[10, 1.3, 0.16]} />
          <meshStandardMaterial color="#121016" roughness={0.9} />
        </mesh>
        <mesh position={[-3.4, 1.85, 0]} receiveShadow>
          <boxGeometry args={[3.2, 1.9, 0.16]} />
          <meshStandardMaterial color="#121016" roughness={0.9} />
        </mesh>
        <mesh position={[3.4, 1.85, 0]} receiveShadow>
          <boxGeometry args={[3.2, 1.9, 0.16]} />
          <meshStandardMaterial color="#121016" roughness={0.9} />
        </mesh>

        {/* Vidro azulado da janela */}
        <mesh position={[0, 1.85, -0.02]}>
          <planeGeometry args={[3.6, 1.86]} />
          <meshStandardMaterial
            ref={windowGlassMatRef}
            color="#152844"
            emissive="#29528a"
            emissiveIntensity={0.55}
            transparent
            opacity={0.46}
            roughness={0.2}
          />
        </mesh>

        {/* Persianas entreabertas na janela */}
        {[1.1, 1.35, 1.6, 1.85, 2.1, 2.35, 2.6].map((by) => (
          <mesh key={by} position={[0, by, 0.03]} rotation={[0.35, 0, 0]}>
            <boxGeometry args={[3.55, 0.025, 0.06]} />
            <meshStandardMaterial color="#171a24" roughness={0.7} />
          </mesh>
        ))}
      </group>

      {/* Paredes laterais e estante do escritório */}
      <mesh position={[-4.2, 2.0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[8, 4.5]} />
        <meshStandardMaterial color="#0b0a0e" roughness={0.95} />
      </mesh>
      <mesh position={[4.2, 2.0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[8, 4.5]} />
        <meshStandardMaterial color="#0b0a0e" roughness={0.95} />
      </mesh>

      {/* Estante / arquivo de madeira ao fundo direito */}
      <group position={[2.15, 0, -2.1]}>
        <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.1, 2.1, 0.42]} />
          <meshStandardMaterial color="#1f140e" roughness={0.8} />
        </mesh>
      </group>

      {/* Mesa executiva do escritório, cadeira, luminária, garrafa e copo */}
      <group position={[0, 0, -0.15]}>
        {/* Tampo da mesa */}
        <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.1, 0.08, 1.0]} />
          <meshStandardMaterial color="#2a1a11" roughness={0.62} metalness={0.1} />
        </mesh>
        {/* Blocos laterais de gavetas */}
        <mesh position={[-0.72, 0.38, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 0.76, 0.88]} />
          <meshStandardMaterial color="#1d120c" roughness={0.78} />
        </mesh>
        <mesh position={[0.72, 0.38, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.48, 0.76, 0.88]} />
          <meshStandardMaterial color="#1d120c" roughness={0.78} />
        </mesh>

        {/* Cadeira do escritório atrás da mesa */}
        <group position={[0.12, 0, -0.78]} rotation={[0, -0.28, 0]}>
          <mesh position={[0, 0.48, 0]} castShadow>
            <boxGeometry args={[0.56, 0.06, 0.54]} />
            <meshStandardMaterial color="#1a1210" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.92, -0.24]} castShadow>
            <boxGeometry args={[0.54, 0.82, 0.07]} />
            <meshStandardMaterial color="#1a1210" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.24, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.46, 10]} />
            <meshStandardMaterial color="#12141a" roughness={0.5} metalness={0.5} />
          </mesh>
        </group>

        {/* Luminária de mesa (banker's lamp) */}
        <group position={[-0.64, 0.82, -0.16]}>
          {/* Base de latão */}
          <mesh position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.11, 0.13, 0.04, 14]} />
            <meshStandardMaterial color="#b5893d" roughness={0.35} metalness={0.7} />
          </mesh>
          {/* Haste */}
          <mesh position={[0, 0.18, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.32, 10]} />
            <meshStandardMaterial color="#b5893d" roughness={0.35} metalness={0.7} />
          </mesh>
          {/* Cúpula */}
          <mesh position={[0, 0.34, 0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.075, 0.075, 0.24, 12, 1, false, 0, Math.PI]} />
            <meshStandardMaterial
              color="#1f593f"
              emissive="#123826"
              emissiveIntensity={0.6}
              roughness={0.3}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Lâmpada interna */}
          <mesh position={[0, 0.31, 0.02]}>
            <sphereGeometry args={[0.038, 10, 10]} />
            <meshStandardMaterial
              ref={deskBulbMatRef}
              color="#ffe5b5"
              emissive="#ffb257"
              emissiveIntensity={2.4}
            />
          </mesh>
          <pointLight
            ref={deskLampLightRef}
            position={[0.06, 0.28, 0.06]}
            color="#ffb257"
            intensity={2.8}
            distance={4.5}
            decay={1.8}
          />
        </group>

        {/* Garrafa de uísque */}
        <group position={[-0.08, 0.82, 0.06]}>
          <mesh position={[0, 0.11, 0]} castShadow>
            <cylinderGeometry args={[0.055, 0.058, 0.22, 14]} />
            <meshStandardMaterial
              color="#6e3514"
              emissive="#3b1906"
              emissiveIntensity={0.35}
              roughness={0.22}
              metalness={0.15}
            />
          </mesh>
          <mesh position={[0, 0.25, 0]}>
            <cylinderGeometry args={[0.02, 0.032, 0.08, 10]} />
            <meshStandardMaterial color="#6e3514" roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.022, 0.02, 0.025, 10]} />
            <meshStandardMaterial color="#c49a6c" roughness={0.8} />
          </mesh>
        </group>

        {/* Copo de uísque animado (em pé no crime, tomba e rola; caído na investigação) */}
        <group ref={glassGroupRef} position={[0.22, 0.845, 0.14]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.042, 0.036, 0.09, 14]} />
            <meshStandardMaterial
              color="#d9a15b"
              emissive="#8c5418"
              emissiveIntensity={0.45}
              transparent
              opacity={0.78}
              roughness={0.15}
              metalness={0.1}
            />
          </mesh>
        </group>

        {/* Poça de uísque derramado visível na investigação */}
        {isInvestigation && (
          <mesh position={[0.42, 0.822, 0.18]}>
            <cylinderGeometry args={[0.13, 0.13, 0.004, 16]} />
            <meshStandardMaterial
              color="#592e10"
              roughness={0.15}
              metalness={0.3}
            />
          </mesh>
        )}
      </group>

      {/* Silhueta sem rosto apenas durante a fase 'crime' */}
      <group visible={!isInvestigation}>
        <Silhouette active={active && !isInvestigation} />
      </group>

      {/* Elementos exclusivos da fase 'investigation' (arrival + officer) */}
      {isInvestigation && (
        <group>
          {/* Portal da porta na frente da sala (z = 2.52) */}
          <mesh position={[-0.92, 1.25, 2.52]}>
            <boxGeometry args={[0.14, 2.5, 0.18]} />
            <meshStandardMaterial color="#171311" roughness={0.8} />
          </mesh>
          <mesh position={[0.92, 1.25, 2.52]}>
            <boxGeometry args={[0.14, 2.5, 0.18]} />
            <meshStandardMaterial color="#171311" roughness={0.8} />
          </mesh>
          <mesh position={[0, 2.46, 2.52]}>
            <boxGeometry args={[1.98, 0.14, 0.18]} />
            <meshStandardMaterial color="#171311" roughness={0.8} />
          </mesh>

          {/* Faixa de isolamento amarela atravessando a porta */}
          <mesh position={[0, 1.36, 2.5]} rotation={[0, 0, -0.08]}>
            <boxGeometry args={[1.78, 0.068, 0.012]} />
            <meshStandardMaterial
              color="#f5c42f"
              emissive="#d9a316"
              emissiveIntensity={0.45}
              roughness={0.4}
            />
          </mesh>
          <mesh position={[0, 0.94, 2.52]} rotation={[0, 0, 0.05]}>
            <boxGeometry args={[1.78, 0.068, 0.012]} />
            <meshStandardMaterial
              color="#f5c42f"
              emissive="#d9a316"
              emissiveIntensity={0.38}
              roughness={0.4}
            />
          </mesh>

          {/* Contorno de giz no chão onde o corpo estava */}
          <group position={[0.68, 0.008, 0.88]} rotation={[0, -0.42, 0]}>
            {/* Contorno da cabeça */}
            <mesh position={[0, 0, -0.52]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.12, 0.145, 22]} />
              <meshStandardMaterial
                color="#eef2fa"
                emissive="#ffffff"
                emissiveIntensity={0.55}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Tronco de giz */}
            <mesh position={[-0.17, 0, -0.1]}>
              <boxGeometry args={[0.026, 0.004, 0.56]} />
              <meshStandardMaterial
                color="#eef2fa"
                emissive="#ffffff"
                emissiveIntensity={0.55}
              />
            </mesh>
            <mesh position={[0.17, 0, -0.1]}>
              <boxGeometry args={[0.026, 0.004, 0.56]} />
              <meshStandardMaterial
                color="#eef2fa"
                emissive="#ffffff"
                emissiveIntensity={0.55}
              />
            </mesh>
            {/* Braços abertos de giz */}
            <mesh position={[-0.36, 0, -0.22]} rotation={[0, 0.55, 0]}>
              <boxGeometry args={[0.38, 0.004, 0.025]} />
              <meshStandardMaterial
                color="#eef2fa"
                emissive="#ffffff"
                emissiveIntensity={0.55}
              />
            </mesh>
            <mesh position={[0.35, 0, -0.28]} rotation={[0, -0.4, 0]}>
              <boxGeometry args={[0.38, 0.004, 0.025]} />
              <meshStandardMaterial
                color="#eef2fa"
                emissive="#ffffff"
                emissiveIntensity={0.55}
              />
            </mesh>
            {/* Pernas de giz */}
            <mesh position={[-0.12, 0, 0.42]} rotation={[0, 0.15, 0]}>
              <boxGeometry args={[0.026, 0.004, 0.52]} />
              <meshStandardMaterial
                color="#eef2fa"
                emissive="#ffffff"
                emissiveIntensity={0.55}
              />
            </mesh>
            <mesh position={[0.14, 0, 0.42]} rotation={[0, -0.18, 0]}>
              <boxGeometry args={[0.026, 0.004, 0.52]} />
              <meshStandardMaterial
                color="#eef2fa"
                emissive="#ffffff"
                emissiveIntensity={0.55}
              />
            </mesh>

            {/* Marcadores amarelos de evidência da perícia */}
            <mesh position={[-0.38, 0.045, 0.08]} rotation={[0, 0.3, 0]}>
              <coneGeometry args={[0.055, 0.09, 4]} />
              <meshStandardMaterial
                color="#f5c42f"
                emissive="#d9a316"
                emissiveIntensity={0.4}
              />
            </mesh>
            <mesh position={[0.28, 0.045, -0.45]} rotation={[0, -0.2, 0]}>
              <coneGeometry args={[0.055, 0.09, 4]} />
              <meshStandardMaterial
                color="#f5c42f"
                emissive="#d9a316"
                emissiveIntensity={0.4}
              />
            </mesh>
          </group>

          {/* Policial parado no escritório, virado para a câmera */}
          <Officer isSpeaking={officerSpeaking} />
        </group>
      )}
    </group>
  )
}
