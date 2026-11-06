import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { MeshReflectorMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { playThunder } from '../../audio/ambience'

interface StreetProps {
  highQuality: boolean
  active: boolean
}

const SIREN_RED = new THREE.Color('#ff2e2e')
const SIREN_BLUE = new THREE.Color('#2b7bff')

const WINDOW_ROWS = [2.15, 3.65, 5.15, 6.65] as const
const WINDOW_COLS = [-2.1, -0.7, 0.7, 2.1] as const

export function Street({ highQuality, active }: StreetProps) {
  const sirenLightRef = useRef<THREE.PointLight>(null)
  const redDomeMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const blueDomeMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const neonMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const flickerWinMat1Ref = useRef<THREE.MeshStandardMaterial>(null)
  const flickerWinMat2Ref = useRef<THREE.MeshStandardMaterial>(null)
  const skyFlashLightRef = useRef<THREE.PointLight>(null)

  const stateRef = useRef({
    wasActive: false,
    elapsed: 0,
    thunderPlayed: false,
  })

  useFrame((state, delta) => {
    const st = stateRef.current
    if (!active) {
      st.wasActive = false
      st.elapsed = 0
      st.thunderPlayed = false
      return
    }
    if (!st.wasActive) {
      st.wasActive = true
      st.elapsed = 0
      st.thunderPlayed = false
    }

    const dt = Math.min(delta, 0.05)
    st.elapsed += dt
    const t = state.clock.elapsedTime

    // Sirene policial alternando entre vermelho e azul
    const sirenCycle = Math.sin(t * 9.5)
    const isRedPhase = sirenCycle >= 0
    const pulse = Math.abs(sirenCycle)

    if (sirenLightRef.current) {
      sirenLightRef.current.color.copy(isRedPhase ? SIREN_RED : SIREN_BLUE)
      sirenLightRef.current.intensity = 1.6 + pulse * 3.8
    }
    if (redDomeMatRef.current) {
      redDomeMatRef.current.emissiveIntensity = isRedPhase ? 1.2 + pulse * 2.8 : 0.25
    }
    if (blueDomeMatRef.current) {
      blueDomeMatRef.current.emissiveIntensity = !isRedPhase ? 1.2 + pulse * 2.8 : 0.25
    }

    // Oscilação elétrica sutil do letreiro de néon
    if (neonMatRef.current) {
      const buzz =
        Math.sin(t * 29) > 0.92 ? 1.3 : 2.8 + Math.sin(t * 4.5) * 0.25
      neonMatRef.current.emissiveIntensity = buzz
    }

    // Janelas piscando no prédio
    if (flickerWinMat1Ref.current) {
      const f1 = Math.sin(t * 17.3) > 0.86 ? 0.15 : 1.65
      flickerWinMat1Ref.current.emissiveIntensity = f1
    }
    if (flickerWinMat2Ref.current) {
      const f2 = Math.cos(t * 11.7) > 0.78 ? 1.9 : 0.45
      flickerWinMat2Ref.current.emissiveIntensity = f2
    }

    // Relâmpago na rua aos ~2.2s da tomada
    if (st.elapsed >= 2.2 && !st.thunderPlayed) {
      st.thunderPlayed = true
      playThunder()
    }
    if (skyFlashLightRef.current) {
      const flashT = st.elapsed - 2.2
      let flash = 0
      if (flashT >= 0 && flashT < 0.08) flash = 1
      else if (flashT >= 0.14 && flashT < 0.24) flash = 0.8
      else if (flashT >= 0.24 && flashT < 0.6) flash = (0.6 - flashT) * 0.8
      skyFlashLightRef.current.intensity = 0.9 + flash * 12
    }
  })

  return (
    <group position={[0, 0, -40]}>
      {/* Luz noturna fria do céu e relâmpago */}
      <pointLight
        ref={skyFlashLightRef}
        position={[0, 6.5, 3.2]}
        color="#4e79b8"
        intensity={0.9}
        distance={16}
        decay={1.5}
      />

      {/* Asfalto molhado da rua (reflexivo apenas em qualidade alta) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 2.8]} receiveShadow>
        <planeGeometry args={[18, 12]} />
        {highQuality ? (
          <MeshReflectorMaterial
            blur={[220, 70]}
            resolution={512}
            mixBlur={0.9}
            mixStrength={0.78}
            roughness={0.52}
            depthScale={0.6}
            minDepthThreshold={0.25}
            maxDepthThreshold={1.25}
            color="#07090f"
            metalness={0.4}
            mirror={0.38}
          />
        ) : (
          <meshStandardMaterial
            color="#07090f"
            roughness={0.58}
            metalness={0.28}
          />
        )}
      </mesh>

      {/* Calçada em frente ao hotel */}
      <mesh position={[0, 0.08, 0.95]} receiveShadow>
        <boxGeometry args={[16, 0.16, 1.9]} />
        <meshStandardMaterial color="#12151f" roughness={0.82} />
      </mesh>

      {/* Prédios vizinhos em silhueta nas laterais */}
      <mesh position={[-5.6, 3.6, -0.8]}>
        <boxGeometry args={[3.6, 7.2, 1.2]} />
        <meshStandardMaterial color="#090b11" roughness={0.95} />
      </mesh>
      <mesh position={[5.6, 4.1, -0.8]}>
        <boxGeometry args={[3.6, 8.2, 1.2]} />
        <meshStandardMaterial color="#090b11" roughness={0.95} />
      </mesh>

      {/* Fachada principal do Hotel / Edifício Noir */}
      <group position={[0, 0, 0]}>
        <mesh position={[0, 4.2, -0.6]} receiveShadow>
          <boxGeometry args={[7.4, 8.4, 1.2]} />
          <meshStandardMaterial color="#0f131d" roughness={0.88} />
        </mesh>

        {/* Cornijas horizontais da fachada */}
        {[1.45, 2.95, 4.45, 5.95, 7.55].map((y) => (
          <mesh key={y} position={[0, y, 0.06]}>
            <boxGeometry args={[7.56, 0.12, 0.18]} />
            <meshStandardMaterial color="#171c29" roughness={0.75} />
          </mesh>
        ))}

        {/* Marquise da entrada térrea */}
        <mesh position={[0, 1.38, 0.52]} castShadow>
          <boxGeometry args={[2.3, 0.16, 0.95]} />
          <meshStandardMaterial color="#1b1412" roughness={0.65} />
        </mesh>
        {/* Porta dupla iluminada do hotel */}
        <mesh position={[0, 0.68, 0.02]}>
          <boxGeometry args={[1.25, 1.22, 0.08]} />
          <meshStandardMaterial
            color="#2b1c12"
            emissive="#ff9d42"
            emissiveIntensity={0.65}
            roughness={0.5}
          />
        </mesh>

        {/* Grade de janelas nos andares superiores (algumas acesas, duas piscando) */}
        {WINDOW_ROWS.map((y, rIdx) =>
          WINDOW_COLS.map((x, cIdx) => {
            const idx = rIdx * 4 + cIdx
            const isFlicker1 = idx === 2
            const isFlicker2 = idx === 9
            const isWarmLit = idx === 0 || idx === 5 || idx === 7 || idx === 10 || idx === 12
            const isCoolLit = idx === 3 || idx === 6 || idx === 14

            return (
              <group key={`${rIdx}-${cIdx}`} position={[x, y, 0.02]}>
                {/* Moldura da janela */}
                <mesh>
                  <boxGeometry args={[0.78, 0.96, 0.08]} />
                  <meshStandardMaterial color="#181d2a" roughness={0.75} />
                </mesh>
                {/* Vidro da janela */}
                <mesh position={[0, 0, 0.03]}>
                  <planeGeometry args={[0.64, 0.82]} />
                  {isFlicker1 ? (
                    <meshStandardMaterial
                      ref={flickerWinMat1Ref}
                      color="#ffcf8c"
                      emissive="#ff9f45"
                      emissiveIntensity={1.6}
                      roughness={0.3}
                    />
                  ) : isFlicker2 ? (
                    <meshStandardMaterial
                      ref={flickerWinMat2Ref}
                      color="#ffe0ad"
                      emissive="#ffb257"
                      emissiveIntensity={1.2}
                      roughness={0.3}
                    />
                  ) : isWarmLit ? (
                    <meshStandardMaterial
                      color="#ffd599"
                      emissive="#ff9e42"
                      emissiveIntensity={1.35}
                      roughness={0.3}
                    />
                  ) : isCoolLit ? (
                    <meshStandardMaterial
                      color="#243f66"
                      emissive="#3b68a8"
                      emissiveIntensity={0.75}
                      roughness={0.3}
                    />
                  ) : (
                    <meshStandardMaterial
                      color="#0a0d14"
                      roughness={0.4}
                      metalness={0.2}
                    />
                  )}
                </mesh>
              </group>
            )
          }),
        )}

        {/* Letreiro de néon vertical âmbar/vermelho com bloom */}
        <group position={[-1.42, 3.55, 0.34]}>
          {/* Caixa suporte do letreiro */}
          <mesh>
            <boxGeometry args={[0.48, 2.35, 0.14]} />
            <meshStandardMaterial color="#161218" roughness={0.6} metalness={0.4} />
          </mesh>
          {/* Tubos/placas emissivas de néon */}
          <mesh position={[0, 0, 0.075]}>
            <boxGeometry args={[0.32, 2.08, 0.04]} />
            <meshStandardMaterial
              ref={neonMatRef}
              color="#ff7a4d"
              emissive="#ff4726"
              emissiveIntensity={2.8}
              roughness={0.2}
            />
          </mesh>
          {/* Barras horizontais âmbar de destaque no néon */}
          {[-0.75, -0.25, 0.25, 0.75].map((ny) => (
            <mesh key={ny} position={[0, ny, 0.1]}>
              <boxGeometry args={[0.42, 0.08, 0.03]} />
              <meshStandardMaterial
                color="#ffe0a3"
                emissive="#ffb257"
                emissiveIntensity={3.1}
              />
            </mesh>
          ))}
          {highQuality && (
            <pointLight
              position={[0, 0, 0.45]}
              color="#ff5e36"
              intensity={2.4}
              distance={5.5}
              decay={1.8}
            />
          )}
        </group>
      </group>

      {/* Poste de rua clássico com luz âmbar */}
      <group position={[2.25, 0.16, 1.55]}>
        {/* Base do poste */}
        <mesh position={[0, 0.22, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.13, 0.44, 10]} />
          <meshStandardMaterial color="#151821" roughness={0.6} metalness={0.5} />
        </mesh>
        {/* Coluna vertical */}
        <mesh position={[0, 1.55, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.06, 2.65, 10]} />
          <meshStandardMaterial color="#151821" roughness={0.6} metalness={0.5} />
        </mesh>
        {/* Braço superior */}
        <mesh position={[-0.28, 2.82, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.035, 0.6, 8]} />
          <meshStandardMaterial color="#151821" roughness={0.6} metalness={0.5} />
        </mesh>
        {/* Cúpula e lâmpada emissiva */}
        <mesh position={[-0.52, 2.78, 0]}>
          <coneGeometry args={[0.18, 0.12, 12]} />
          <meshStandardMaterial color="#1b202c" roughness={0.5} metalness={0.6} />
        </mesh>
        <mesh position={[-0.52, 2.71, 0]}>
          <sphereGeometry args={[0.075, 10, 10]} />
          <meshStandardMaterial
            color="#ffe8bd"
            emissive="#ffb85c"
            emissiveIntensity={3.0}
          />
        </mesh>
        <pointLight
          position={[-0.52, 2.6, 0]}
          color="#ffb85c"
          intensity={3.6}
          distance={7.5}
          decay={1.6}
        />
      </group>

      {/* Viatura antiga simples (caixa + cabine + rodas) com sirene vermelho/azul */}
      <group position={[-1.25, 0.02, 2.35]} rotation={[0, 0.24, 0]}>
        {/* Chassi inferior */}
        <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.05, 0.36, 0.88]} />
          <meshStandardMaterial color="#0e1422" roughness={0.45} metalness={0.35} />
        </mesh>
        {/* Faixa branca lateral de polícia */}
        <mesh position={[0, 0.33, 0]}>
          <boxGeometry args={[0.82, 0.32, 0.9]} />
          <meshStandardMaterial color="#d4dbe8" roughness={0.5} metalness={0.2} />
        </mesh>
        {/* Cabine superior */}
        <mesh position={[-0.08, 0.63, 0]} castShadow>
          <boxGeometry args={[1.04, 0.32, 0.78]} />
          <meshStandardMaterial color="#0e1422" roughness={0.45} metalness={0.35} />
        </mesh>
        {/* Vidros da cabine */}
        <mesh position={[-0.08, 0.63, 0]}>
          <boxGeometry args={[1.06, 0.22, 0.72]} />
          <meshStandardMaterial color="#1d2f4a" roughness={0.25} metalness={0.6} />
        </mesh>

        {/* 4 Rodas */}
        {[
          [-0.64, 0.18, 0.44],
          [0.64, 0.18, 0.44],
          [-0.64, 0.18, -0.44],
          [0.64, 0.18, -0.44],
        ].map(([wx, wy, wz], idx) => (
          <mesh
            key={idx}
            position={[wx, wy, wz]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.18, 0.18, 0.12, 14]} />
            <meshStandardMaterial color="#08090d" roughness={0.85} />
          </mesh>
        ))}

        {/* Faróis dianteiros */}
        <mesh position={[1.03, 0.34, 0.28]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.065, 0.065, 0.03, 10]} />
          <meshStandardMaterial
            color="#fff4d6"
            emissive="#ffd685"
            emissiveIntensity={2.4}
          />
        </mesh>
        <mesh position={[1.03, 0.34, -0.28]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.065, 0.065, 0.03, 10]} />
          <meshStandardMaterial
            color="#fff4d6"
            emissive="#ffd685"
            emissiveIntensity={2.4}
          />
        </mesh>

        {/* Giroflex / Sirene no teto piscando vermelho e azul */}
        <mesh position={[-0.08, 0.81, 0]}>
          <boxGeometry args={[0.16, 0.04, 0.36]} />
          <meshStandardMaterial color="#252b38" roughness={0.4} metalness={0.6} />
        </mesh>
        <mesh position={[-0.08, 0.86, -0.1]}>
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshStandardMaterial
            ref={redDomeMatRef}
            color="#ff4d4d"
            emissive="#ff1e1e"
            emissiveIntensity={2.5}
          />
        </mesh>
        <mesh position={[-0.08, 0.86, 0.1]}>
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshStandardMaterial
            ref={blueDomeMatRef}
            color="#4d8eff"
            emissive="#1e6dff"
            emissiveIntensity={0.4}
          />
        </mesh>
        <pointLight
          ref={sirenLightRef}
          position={[-0.08, 1.05, 0]}
          color="#ff2e2e"
          intensity={3.2}
          distance={6.5}
          decay={1.6}
        />
      </group>
    </group>
  )
}
