// Verify origens_blockout.glb with Three.js GLTFLoader.
// Usage: node verify_t210.mjs [path/to/origens_blockout.glb]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from '../node_modules/three/build/three.module.js'
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const glbPath = process.argv[2] || path.join(here, 'out/origens_blockout.glb')
const splinePath = path.join(here, 'out/origens_line_spline.json')

const buf = fs.readFileSync(glbPath)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(ab, '', resolve, reject)
})

gltf.scene.updateMatrixWorld(true)

const nodes = new Map()
const allNames = []
gltf.scene.traverse((obj) => {
    if (obj === gltf.scene) return
    allNames.push(obj.name)
    if (!nodes.has(obj.name)) nodes.set(obj.name, obj)
})

const pad2 = (n) => String(n).padStart(2, '0')
const requiredRefs = [
    'refRespawnOrigens',
    'refRespawn',
    'refMilestone1994',
    'refHouse1994',
    'refMilestone2005',
    'refMilestone2011',
    'refMilestoneContact',
    'refPipeContact',
    'refEndDotIsland',
    'refEndDotSphere',
    'refSecretTermite',
    'refBusStopOrigens',
    'refZoneBounding',
    'refZoneFrustum',
    ...[1, 2, 3, 4].map((i) => `refSeriema${i}`),
    ...Array.from({ length: 16 }, (_, i) => `refLinePoint${pad2(i + 1)}`),
    ...Array.from({ length: 12 }, (_, i) => `refNav${pad2(i + 1)}`),
    ...Array.from({ length: 5 }, (_, i) => `refCamera${i + 1}`),
    ...Array.from({ length: 20 }, (_, i) => `refSignal${pad2(i + 1)}`),
]

const missingRefs = requiredRefs.filter((r) => !nodes.has(r))
const requiredMeshes = ['OrigensLineRibbon', 'OrigensEndDotSphere', 'OrigensCapelo', 'screen']
const missingMeshes = requiredMeshes.filter((m) => !nodes.has(m))

const colliderCounts = { cuboid: 0, tube: 0, ball: 0, hull: 0, trimesh: 0 }
const dynamicToys = []
let meshCount = 0

gltf.scene.traverse((obj) => {
    if (obj === gltf.scene) return
    if (obj.isMesh) meshCount += 1
    const ln = obj.name.toLowerCase()
    for (const k of Object.keys(colliderCounts)) {
        if (ln.startsWith(k)) colliderCounts[k] += 1
    }
    if (ln.includes('physicaldynamic') && Number(obj.userData?.mass ?? 0) > 0) {
        dynamicToys.push(obj.name)
    }
})

const worldPos = (name) => {
    const o = nodes.get(name)
    if (!o) return null
    const v = new THREE.Vector3()
    o.getWorldPosition(v)
    return [Number(v.x.toFixed(3)), Number(v.y.toFixed(3)), Number(v.z.toFixed(3))]
}

let splineControlPointCount = 0
let splineSampleCount = 0
if (fs.existsSync(splinePath)) {
    const splineData = JSON.parse(fs.readFileSync(splinePath, 'utf8'))
    splineControlPointCount = Array.isArray(splineData.controlPoints) ? splineData.controlPoints.length : 0
    splineSampleCount = Array.isArray(splineData.samples) ? splineData.samples.length : 0
}

const report = {
    glbPath,
    totalObjects: allNames.length,
    uniqueNames: nodes.size,
    meshCount,
    missingRefs,
    missingMeshes,
    colliderCounts,
    totalColliders: Object.values(colliderCounts).reduce((a, b) => a + b, 0),
    dynamicToysCount: dynamicToys.length,
    splineControlPointCount,
    splineSampleCount,
    beatCoordsThreeJS: {
        O1_refRespawnOrigens: worldPos('refRespawnOrigens'),
        O2_refMilestone1994: worldPos('refMilestone1994'),
        O3_refPipeContact: worldPos('refPipeContact'),
        O3_refEndDotSphere: worldPos('refEndDotSphere'),
        O5_refMilestone2005: worldPos('refMilestone2005'),
        O7_refSecretTermite: worldPos('refSecretTermite'),
        O8_refMilestone2011: worldPos('refMilestone2011'),
        O10_refBusStopOrigens: worldPos('refBusStopOrigens'),
    },
}

console.log(JSON.stringify(report, null, 2))

if (missingRefs.length > 0 || missingMeshes.length > 0 || dynamicToys.length < 20 || splineControlPointCount !== 16) {
    process.exit(1)
}
