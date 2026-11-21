// Compare two glb files node-by-node (names, transforms, userData). Usage: node verify_t21c.mjs [a.glb] [b.glb]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const aPath = process.argv[2] || path.join(here, '../static/eras/greybox/greybox.glb')
const bPath = process.argv[3] || path.join(here, 'out/greybox_t21c.glb')
const EPS = 1e-4

const load = (p) => new Promise((res, rej) => {
    const buf = fs.readFileSync(p)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    new GLTFLoader().parse(ab, '', res, rej)
})

const collect = (gltf) => {
    const map = new Map()
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((o) => {
        if(o === gltf.scene) return
        map.set(o.name, o)
    })
    return map
}

const mism = []
const pn = (o) => (o.parent && o.parent.parent === null ? "<root>" : o.parent?.name)
const num = (label, x, y) => { if(Math.abs(x - y) > EPS) mism.push(`${label}: ${x} vs ${y}`) }
const vec = (label, p, q, keys) => keys.forEach((k) => num(`${label}.${k}`, p[k], q[k]))

const [A, B] = await Promise.all([load(aPath), load(bPath)])
const ma = collect(A), mb = collect(B)
for(const n of ma.keys()) if(!mb.has(n)) mism.push(`missing in new: ${n}`)
for(const n of mb.keys()) if(!ma.has(n)) mism.push(`extra in new: ${n}`)

for(const [n, a] of ma){
    const b = mb.get(n)
    if(!b) continue
    vec(`${n}.pos`, a.position, b.position, ['x', 'y', 'z'])
    vec(`${n}.scale`, a.scale, b.scale, ['x', 'y', 'z'])
    // quaternion sign-insensitive
    const dot = a.quaternion.dot(b.quaternion)
    if(Math.abs(Math.abs(dot) - 1) > EPS) mism.push(`${n}.rot: dot=${dot}`)
    if(a.type !== b.type) mism.push(`${n}.type: ${a.type} vs ${b.type}`)
    if(pn(a) !== pn(b)) mism.push(`${n}.parent: ${pn(a)} vs ${pn(b)}`)
    const ua = a.userData, ub = b.userData
    for(const k of new Set([...Object.keys(ua), ...Object.keys(ub)])){
        const x = ua[k], y = ub[k]
        if(typeof x === 'number' && typeof y === 'number') num(`${n}.userData.${k}`, x, y)
        else if(JSON.stringify(x) !== JSON.stringify(y)) mism.push(`${n}.userData.${k}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`)
    }
    if(a.geometry && b.geometry){
        const pa = a.geometry.attributes.position, pb = b.geometry.attributes.position
        if(pa.count !== pb.count) mism.push(`${n}.vertCount: ${pa.count} vs ${pb.count}`)
    }
}

console.log(`nodes: ${ma.size} vs ${mb.size}`)
console.log(`mismatches: ${mism.length}`)
mism.slice(0, 40).forEach((m) => console.log('  ' + m))
process.exit(mism.length ? 1 : 0)


