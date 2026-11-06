// Converte os pacotes CC0 da Quaternius (Universal Base Characters + Universal Animation Library)
// em GLBs leves para a web: texturas WebP reduzidas, malha comprimida (meshopt) e só as animações usadas.
// Uso: node scripts/build-assets.mjs "C:/caminho/para/pasta/dos/pacotes"
import fs from 'node:fs'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, resample, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

const RAW = process.argv[2] ?? path.resolve('../../noir')
const OUT = path.resolve('public/models')
const BASE = path.join(RAW, 'Universal Base Characters[Standard]')
const CHAR_DIR = path.join(BASE, 'Base Characters', 'Godot - UE')
const HAIR_DIR = path.join(BASE, 'Hairstyles', 'Origin at 0', 'glTF (Godot)')
const UAL = path.join(RAW, 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb')

const CLIPS = [
  'Sitting_Idle_Loop',
  'Sitting_Talking_Loop',
  'Sitting_Enter',
  'Idle_Loop',
  'Idle_Talking_Loop',
  'Walk_Formal_Loop',
  'Interact',
  'Hit_Chest',
  'Death01',
  'PickUp_Table',
]
const HAIRS = ['Hair_Long', 'Hair_Buns', 'Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Beard', 'Eyebrows_Regular', 'Eyebrows_Female']

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
fs.mkdirSync(path.join(OUT, 'hair'), { recursive: true })

// Alguns .gltf do pacote apontam para texturas com nome errado (ex.: "_png.png").
// Lê o JSON, procura o arquivo certo na mesma pasta ou em Textures/ e monta os recursos à mão.
async function readFixed(file) {
  const dir = path.dirname(file)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const resources = {}
  const find = (uri) => {
    const candidates = [uri, uri.replace('_png.png', '.png'), uri.replace('.png', '_png.png')]
    const dirs = [dir, path.join(BASE, 'Base Characters', 'Textures'), path.join(BASE, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)')]
    for (const d of dirs) for (const c of candidates) if (fs.existsSync(path.join(d, c))) return path.join(d, c)
    throw new Error(`textura não encontrada: ${uri}`)
  }
  for (const b of json.buffers ?? []) resources[b.uri] = new Uint8Array(fs.readFileSync(path.join(dir, b.uri)))
  for (const img of json.images ?? []) if (img.uri) resources[img.uri] = new Uint8Array(fs.readFileSync(find(img.uri)))
  return io.readJSON({ json, resources })
}

async function write(doc, file, textureSize) {
  const steps = [dedup(), weld(), prune()]
  if (textureSize) steps.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize] }))
  steps.push(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  await doc.transform(...steps)
  const out = path.join(OUT, file)
  await io.write(out, doc)
  console.log(`${file}: ${(fs.statSync(out).size / 1024).toFixed(0)} kB`)
}

for (const [name, src] of [
  ['male', 'Superhero_Male_FullBody.gltf'],
  ['female', 'Superhero_Female_FullBody.gltf'],
]) {
  await write(await readFixed(path.join(CHAR_DIR, src)), `${name}.glb`, 1024)
}

for (const hair of HAIRS) {
  const file = path.join(HAIR_DIR, `${hair}.gltf`)
  if (!fs.existsSync(file)) {
    console.warn(`(sem ${hair})`)
    continue
  }
  await write(await readFixed(file), `hair/${hair.toLowerCase()}.glb`, 512)
}

// Animações: mantém só os clipes usados e remove a malha do manequim.
const anims = await io.read(UAL)
const root = anims.getRoot()
for (const a of root.listAnimations()) {
  if (CLIPS.includes(a.getName())) continue
  // Descartar canais e samplers também; senão os dados ficam órfãos no arquivo.
  for (const ch of a.listChannels()) ch.dispose()
  for (const sm of a.listSamplers()) sm.dispose()
  a.dispose()
}
for (const n of root.listNodes()) if (n.getMesh()) n.setMesh(null).setSkin(null)
// Reduz o arquivo: tira dedos e ossos-folha, e só mantém translação em root/pelvis.
const FINE = /^(index|middle|pinky|ring|thumb)_|_leaf_/
for (const a of root.listAnimations()) {
  for (const ch of a.listChannels()) {
    const bone = ch.getTargetNode()?.getName() ?? ''
    const path = ch.getTargetPath()
    if (FINE.test(bone) || path === 'scale' || (path === 'translation' && !['root', 'pelvis'].includes(bone))) {
      const sm = ch.getSampler()
      ch.dispose()
      sm?.dispose()
    }
  }
}
for (const m of root.listMeshes()) m.dispose()
await anims.transform(resample())
console.log('clipes:', root.listAnimations().map((a) => a.getName()).join(', '))
await write(anims, 'anims.glb', 0)
