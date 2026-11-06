// Página de teste dos personagens (só em dev): http://localhost:5173/lab.html?clip=Sitting_Talking_Loop
import { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Character, type ClipName, type Outfit } from './scene/characters/Character'
import { OUTFITS } from './scene/characters/outfits'

const clip = (new URLSearchParams(location.search).get('clip') ?? 'Idle_Loop') as ClipName
const list: Outfit[] = Object.values(OUTFITS)

createRoot(document.getElementById('root')!).render(
  <Canvas shadows camera={{ position: [0, 1.5, 4.2], fov: 40 }}>
    <ambientLight intensity={0.35} />
    <spotLight position={[1.5, 4, 3]} intensity={60} angle={0.6} penumbra={0.6} castShadow color="#ffd9a0" />
    <directionalLight position={[-3, 2, -2]} intensity={0.8} color="#6f8cff" />
    <Suspense fallback={null}>
      {list.map((o, i) => (
        <group key={i} position={[(i - (list.length - 1) / 2) * 0.95, 0, 0]}>
          <Character outfit={o} clip={clip} />
        </group>
      ))}
    </Suspense>
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[10, 10]} />
      <meshStandardMaterial color="#222" />
    </mesh>
    <OrbitControls target={[0, 1.1, 0]} />
  </Canvas>,
)
