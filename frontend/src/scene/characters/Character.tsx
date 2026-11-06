// Personagem humano com rig (Quaternius CC0), "vestido" em tempo de carregamento.
// O corpo base vem só de roupa íntima: dividimos a malha por osso dominante de cada triângulo
// (cabeça/mãos = pele; tronco/braços = paletó; pernas = calça; pés = sapato; faixa frontal = gravata)
// e trocamos os materiais. Cabelo e chapéu são presos ao osso da cabeça.
import { useAnimations, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'
const cloneSkinned = SkeletonUtils.clone

export type BodyType = 'male' | 'female'
export type HairStyle = 'long' | 'buns' | 'simpleparted' | 'buzzed' | 'none'
export type Headwear = 'fedora' | 'cap' | 'none'
export type ClipName =
  | 'Sitting_Idle_Loop'
  | 'Sitting_Talking_Loop'
  | 'Sitting_Enter'
  | 'Idle_Loop'
  | 'Idle_Talking_Loop'
  | 'Walk_Formal_Loop'
  | 'Interact'
  | 'Hit_Chest'
  | 'Death01'
  | 'PickUp_Table'

export interface Outfit {
  body: BodyType
  jacket: string
  pants: string
  accent: string // gravata / detalhe
  shoes?: string
  skinTint?: string // multiplica a textura de pele
  hair: HairStyle
  hairColor: string
  beard?: boolean
  headwear: Headwear
  headwearColor?: string
  silhouette?: boolean // tudo preto e sem rosto (cena do crime)
  front?: Front // padrão: terno nos homens
  shirt?: string // cor da camisa ou do avental
}

export interface CharacterProps {
  outfit: Outfit
  clip: ClipName
  /** Velocidade da animação (nervoso = mais rápido). */
  speed?: number
  /** Tocar o clipe uma vez e parar no último quadro. */
  once?: boolean
  /** Rotações extras somadas por cima da animação (radianos), para emoções. */
  headTilt?: { x: number; y: number }
  spineLean?: number
}

// Proteção: se alguma malha com rig tiver osso faltando, o three trava o frame inteiro
// ao calcular a esfera de limite. Aqui ela recebe uma esfera fixa e o resto da cena segue.
const origSphere = THREE.SkinnedMesh.prototype.computeBoundingSphere
THREE.SkinnedMesh.prototype.computeBoundingSphere = function (this: THREE.SkinnedMesh) {
  try {
    origSphere.call(this)
  } catch {
    if (import.meta.env.DEV) console.warn('SkinnedMesh sem ossos válidos:', this.name, this.parent?.name)
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3)
  }
}

const MODEL = (b: BodyType) => `/models/${b}.glb`
const ANIMS = '/models/anims.glb'
const HAIR = (h: Exclude<HairStyle, 'none'>) => `/models/hair/hair_${h}.glb`

const SKIN_BONES = /^(Head|neck_01|hand_[lr]|(index|middle|pinky|ring|thumb)_\d)/
const LEG_BONES = /^(pelvis|thigh_|calf_)/
const FOOT_BONES = /^(foot_|ball_)/

type Part = 0 | 1 | 2 | 3 | 4 | 5 // pele, paletó, calça, sapato, gravata, camisa/avental
export type Front = 'suit' | 'apron' | 'none'
const geometryCache = new Map<string, WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>>()

/** Classifica cada vértice (pele, paletó, calça, sapato, gravata, camisa) e separa pele/tecido. Uma vez por geometria. */
function dressGeometry(mesh: THREE.SkinnedMesh, front: Front): THREE.BufferGeometry {
  const src = mesh.geometry
  if (!geometryCache.has(front)) geometryCache.set(front, new WeakMap())
  const cache = geometryCache.get(front)!
  const cached = cache.get(src)
  if (cached) return cached

  const geo = src.clone()
  const bones = mesh.skeleton.bones.map((b) => b.name)
  const skinIndex = geo.getAttribute('skinIndex')
  const skinWeight = geo.getAttribute('skinWeight')
  const pos = geo.getAttribute('position')
  const index = geo.getIndex()
  if (!index) return src
  geo.computeBoundingBox()
  const box = geo.boundingBox ?? new THREE.Box3()
  const h = box.max.y - box.min.y
  const cx = (box.max.x + box.min.x) / 2

  const vertexPart = new Uint8Array(pos.count)
  const nor = geo.getAttribute('normal')
  for (let v = 0; v < pos.count; v++) {
    let best = 0
    let bestW = -1
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k)
      if (w > bestW) {
        bestW = w
        best = skinIndex.getComponent(v, k)
      }
    }
    const bone = bones[best] ?? ''
    const y = (pos.getY(v) - box.min.y) / h
    const x = pos.getX(v)
    const z = pos.getZ(v)
    let part: Part = 1
    if (SKIN_BONES.test(bone)) part = 0
    else if (FOOT_BONES.test(bone)) part = 3
    else if (LEG_BONES.test(bone)) part = 2
    // Gravata: faixa estreita na frente do peito.
    const dx = Math.abs(x - cx) / h
    const facing = nor.getZ(v) > 0.35 && z > 0
    if (front === 'suit' && part === 1 && facing && y > 0.64 && y < 0.82) {
      // Abertura em V do paletó (mais larga perto do pescoço), com a gravata no meio.
      const half = 0.006 + (y - 0.64) * 0.32
      if (dx < half) part = dx < 0.01 && y < 0.79 ? 4 : 5
    }
    if (front === 'apron' && (part === 1 || part === 2) && facing && y > 0.46 && y < 0.66 && dx < 0.08) part = 5
    vertexPart[v] = part
  }

  // O corpo feminino base tem mais relevo no tronco: precisa de mais suavização para virar tecido.
  const female = /female/i.test(mesh.name) || /Female/.test(String((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name))
  if (female) flattenChest(geo, vertexPart, box)
  smoothCloth(geo, vertexPart, index, female ? 22 : 8)

  // Dois grupos: pele (triângulo todo de pele) e tecido. As cores do tecido vão por vértice,
  // assim as bordas da camisa, gravata e avental ficam suaves mesmo com triângulos grandes.
  const skinTris: number[] = []
  const clothTris: number[] = []
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i)
    const b = index.getX(i + 1)
    const c = index.getX(i + 2)
    if (vertexPart[a] === 0 && vertexPart[b] === 0 && vertexPart[c] === 0) skinTris.push(a, b, c)
    else clothTris.push(a, b, c)
  }
  geo.setIndex([...skinTris, ...clothTris])
  geo.clearGroups()
  geo.addGroup(0, skinTris.length, 0)
  geo.addGroup(skinTris.length, clothTris.length, 1)
  geo.userData = { parts: vertexPart } // objeto novo: clone() compartilha o userData da origem
  cache.set(src, geo)
  return geo
}

/**
 * Corpo feminino base: comprime para trás a frente do peito (só vértices de tecido),
 * com transição suave em altura e largura, para o vestido/uniforme não colar no corpo.
 */
function flattenChest(geo: THREE.BufferGeometry, part: Uint8Array, box: THREE.Box3) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const h = box.max.y - box.min.y
  const cx = (box.max.x + box.min.x) / 2
  const band: number[] = []
  for (let v = 0; v < pos.count; v++) {
    const y = (pos.getY(v) - box.min.y) / h
    if (part[v] === 1 && y > 0.66 && y < 0.8 && Math.abs(pos.getX(v) - cx) < h * 0.11) band.push(pos.getZ(v))
  }
  if (band.length < 10) return
  band.sort((a, b) => a - b)
  const zc = band[Math.floor(band.length * 0.5)] // plano de referência um pouco à frente do meio do tronco
  for (let v = 0; v < pos.count; v++) {
    if (part[v] !== 1 && part[v] !== 5) continue
    const y = (pos.getY(v) - box.min.y) / h
    const dx = Math.abs(pos.getX(v) - cx) / h
    if (y < 0.62 || y > 0.84 || dx > 0.14) continue
    const z = pos.getZ(v)
    if (z <= zc) continue
    // Peso em sino: máximo no meio do peito, zero nas bordas da faixa.
    const wy = Math.sin(((y - 0.62) / 0.22) * Math.PI)
    const wx = 1 - Math.min(1, dx / 0.14)
    const w = wy * wx * 0.55 // suaviza o volume sem apagar a silhueta feminina
    pos.setZ(v, z - (z - zc) * w)
  }
  pos.needsUpdate = true
}

/**
 * Tira a anatomia de dentro da roupa: suaviza (Laplaciano) só os vértices de tecido,
 * infla um pouco ao longo da normal e recalcula as normais do tecido.
 */
function smoothCloth(geo: THREE.BufferGeometry, part: Uint8Array, index: THREE.BufferAttribute, iterations: number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute
  const n = pos.count
  const neighbors: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < index.count; i += 3) {
    const t = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) neighbors[t[a]].push(t[b])
  }
  // getX/Y/Z já desquantizam (o meshopt guarda posições como inteiros normalizados).
  const p = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    p[v * 3] = pos.getX(v)
    p[v * 3 + 1] = pos.getY(v)
    p[v * 3 + 2] = pos.getZ(v)
  }
  geo.computeBoundingBox()
  const size = geo.boundingBox ? geo.boundingBox.max.y - geo.boundingBox.min.y : 1
  const tmp = new Float32Array(p.length)
  // Vértices duplicados na mesma posição (costuras de UV) andam juntos, senão abrem frestas.
  const twins = new Map<string, number[]>()
  for (let v = 0; v < n; v++) {
    const key = `${Math.round((p[v * 3] / size) * 2e4)},${Math.round((p[v * 3 + 1] / size) * 2e4)},${Math.round((p[v * 3 + 2] / size) * 2e4)}`
    const list = twins.get(key)
    if (list) list.push(v)
    else twins.set(key, [v])
  }
  const seams = [...twins.values()].filter((l) => l.length > 1)
  for (const l of seams) {
    // tecido só se todos forem tecido; senão a costura fica presa
    if (l.some((v) => part[v] === 0 || part[v] === 3)) for (const v of l) if (part[v] !== 0 && part[v] !== 3) part[v] = 0
    const all = l.flatMap((v) => neighbors[v])
    for (const v of l) neighbors[v] = all
  }
  for (let it = 0; it < iterations; it++) {
    tmp.set(p)
    for (let v = 0; v < n; v++) {
      if (part[v] === 0 || part[v] === 3) continue // pele e sapato não mudam
      const nb = neighbors[v]
      if (!nb.length) continue
      let x = 0, y = 0, z = 0
      for (const j of nb) {
        x += tmp[j * 3]; y += tmp[j * 3 + 1]; z += tmp[j * 3 + 2]
      }
      const k = it % 2 === 0 ? 0.5 : -0.53 // Taubin: suaviza sem encolher
      p[v * 3] = tmp[v * 3] * (1 - k) + (x / nb.length) * k
      p[v * 3 + 1] = tmp[v * 3 + 1] * (1 - k) + (y / nb.length) * k
      p[v * 3 + 2] = tmp[v * 3 + 2] * (1 - k) + (z / nb.length) * k
    }
  }
  // Em fração da altura do corpo (1,77 m): ~1,2 cm no paletó, ~0,8 cm na calça.
  const inflate = [0, 0.0075, 0.0045, 0, 0.0078, 0.0072]
  for (let v = 0; v < n; v++) {
    const d = inflate[part[v]] * size
    if (!d) continue
    p[v * 3] += nor.getX(v) * d
    p[v * 3 + 1] += nor.getY(v) * d
    p[v * 3 + 2] += nor.getZ(v) * d
  }
  const origNormals = new Float32Array(n * 3)
  for (let v = 0; v < n; v++) {
    origNormals[v * 3] = nor.getX(v)
    origNormals[v * 3 + 1] = nor.getY(v)
    origNormals[v * 3 + 2] = nor.getZ(v)
  }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3))
  geo.computeVertexNormals()
  const nn = geo.getAttribute('normal') as THREE.BufferAttribute
  for (let v = 0; v < n; v++) {
    if (part[v] === 0) nn.setXYZ(v, origNormals[v * 3], origNormals[v * 3 + 1], origNormals[v * 3 + 2])
  }
}

/** Geometria da instância: compartilha os atributos e só acrescenta as cores do figurino. */
function paintGeometry(base: THREE.BufferGeometry, colors: string[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr)
  geo.setIndex(base.getIndex())
  for (const g of base.groups) geo.addGroup(g.start, g.count, g.materialIndex)
  geo.boundingBox = base.boundingBox
  geo.boundingSphere = base.boundingSphere
  const parts = base.userData.parts as Uint8Array
  const palette = colors.map((c) => new THREE.Color(c))
  const col = new Float32Array(parts.length * 3)
  for (let v = 0; v < parts.length; v++) {
    const c = palette[parts[v]]
    col[v * 3] = c.r
    col[v * 3 + 1] = c.g
    col[v * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}

function fabric(color: string, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 })
}

function makeHat(kind: Exclude<Headwear, 'none'>, color: string): THREE.Group {
  const g = new THREE.Group()
  const mat = fabric(color, 0.7)
  if (kind === 'fedora') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 24), mat)
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.11, 20), mat)
    crown.position.y = 0.06
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.101, 0.101, 0.022, 20), fabric('#111111', 0.5))
    band.position.y = 0.017
    g.add(brim, crown, band)
  } else {
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.1, 0.07, 20), mat)
    top.position.y = 0.035
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 20, 1, false, -Math.PI / 2, Math.PI), fabric('#0c0c0c', 0.3))
    visor.position.set(0, 0.003, 0.06)
    visor.scale.set(1, 1, 0.8)
    const badge = new THREE.Mesh(
      new THREE.CircleGeometry(0.018, 12),
      new THREE.MeshStandardMaterial({ color: '#d4a838', emissive: '#a07818', emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.3 }),
    )
    badge.position.set(0, 0.04, 0.112)
    g.add(top, visor, badge)
  }
  g.traverse((o) => {
    o.castShadow = true
  })
  return g
}

/** Prende um objeto posicionado no espaço do personagem (pose de bind) ao osso da cabeça. */
function attachToBone(root: THREE.Object3D, bone: THREE.Object3D, obj: THREE.Object3D) {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert()
  obj.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, root.matrixWorld))
  bone.add(obj)
}

export function Character({ outfit, clip, speed = 1, once = false, headTilt, spineLean = 0 }: CharacterProps) {
  const base = useGLTF(MODEL(outfit.body))
  const { animations } = useGLTF(ANIMS)
  const hairGltf = useGLTF(HAIR(outfit.hair === 'none' ? 'buzzed' : outfit.hair))
  const beardGltf = useGLTF('/models/hair/hair_beard.glb')
  const group = useRef<THREE.Group>(null)

  const { scene, head, spine } = useMemo(() => {
    const t0 = performance.now()
    const scene = cloneSkinned(base.scene) as THREE.Group
    const sil = outfit.silhouette === true
    const skinMat = (orig: THREE.Material) => {
      if (sil) return fabric('#030304', 1)
      const m = (orig as THREE.MeshStandardMaterial).clone()
      m.vertexColors = false // o glTF liga isso; as cores por vértice são só do tecido
      if (outfit.skinTint) m.color.set(outfit.skinTint)
      return m
    }
    const clothColors = sil
      ? ['#050507', '#050507', '#050507', '#020203', '#050507', '#050507']
      : [outfit.jacket, outfit.jacket, outfit.pants, outfit.shoes ?? '#151210', outfit.accent, outfit.shirt ?? '#a9a295']
    const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: sil ? 1 : 0.82, metalness: 0.02 })

    let head: THREE.Bone | null = null
    let spine: THREE.Bone | null = null
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        if (o.name === 'Head') head = o as THREE.Bone
        if (o.name === 'spine_02') spine = o as THREE.Bone
      }
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      mesh.castShadow = true
      mesh.frustumCulled = false
      // Esfera fixa: evita o cálculo pelos ossos (o three faz isso para ordenar objetos).
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.3)
      const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name
      if (/Superhero/.test(name)) {
        const dressed = dressGeometry(mesh, outfit.front ?? 'none')
        mesh.geometry = paintGeometry(dressed, clothColors)
        mesh.material = [skinMat(mesh.material as THREE.Material), clothMat]
      } else if (sil) {
        mesh.visible = false // olhos e sobrancelhas somem na silhueta
      } else if (/Hair/.test(name)) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone()
        m.color.set(outfit.hairColor)
        mesh.material = m
      }
    })

    if (head) {
      const h = head as THREE.Bone
      if (outfit.hair !== 'none' && !sil) {
        const hair = hairGltf.scene.clone(true)
        hair.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            const mat = (m.material as THREE.MeshStandardMaterial).clone()
            mat.color.set(outfit.hairColor)
            m.material = mat
            m.castShadow = true
          }
        })
        attachToBone(scene, h, hair)
      }
      if (outfit.beard && !sil) {
        const beard = beardGltf.scene.clone(true)
        beard.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) {
            const mat = (m.material as THREE.MeshStandardMaterial).clone()
            mat.color.set(outfit.hairColor)
            m.material = mat
          }
        })
        attachToBone(scene, h, beard)
      }
      if (outfit.headwear !== 'none') {
        const hat = makeHat(outfit.headwear, sil ? '#050507' : (outfit.headwearColor ?? '#1b1b1f'))
        // Topo da cabeça no espaço do personagem (altura ~1,77 m na pose de bind).
        const top = outfit.body === 'male' ? 1.74 : 1.71
        hat.position.set(0, top, -0.01)
        if (outfit.headwear === 'fedora') hat.rotation.x = -0.08
        attachToBone(scene, h, hat)
      }
    }
    if (import.meta.env.DEV) console.info(`[Character] ${outfit.body}/${outfit.hair} montado em ${(performance.now() - t0).toFixed(0)} ms`)
    return { scene, head: head as THREE.Bone | null, spine: spine as THREE.Bone | null }
  }, [base.scene, hairGltf.scene, beardGltf.scene, outfit])

  const { actions, mixer } = useAnimations(animations, group)

  useEffect(() => {
    const action = actions[clip]
    if (!action) return
    action.reset()
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = once
    action.fadeIn(0.35).play()
    return () => {
      action.fadeOut(0.35)
    }
  }, [actions, clip, once])

  useEffect(() => {
    mixer.timeScale = speed
  }, [mixer, speed])

  // Emoções somadas por cima da animação (depois do mixer, que roda antes no mesmo frame).
  const tilt = useRef({ x: 0, y: 0, lean: 0 })
  useFrame((_, delta) => {
    const t = tilt.current
    const k = 1 - Math.exp(-6 * Math.min(delta, 0.05))
    t.x += ((headTilt?.x ?? 0) - t.x) * k
    t.y += ((headTilt?.y ?? 0) - t.y) * k
    t.lean += (spineLean - t.lean) * k
    if (head) {
      head.rotation.x += t.x
      head.rotation.y += t.y
    }
    if (spine) spine.rotation.x += t.lean
  })

  return (
    <group ref={group} dispose={null}>
      <primitive object={scene} />
    </group>
  )
}

useGLTF.preload(MODEL('male'))
useGLTF.preload(MODEL('female'))
useGLTF.preload(ANIMS)
