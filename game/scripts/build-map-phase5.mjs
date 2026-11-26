// Fase 5 (T5.1 + T5.2): Reorganiza a ilha inteira para o layout "Roadtrip Costeira",
// rotaciona o Circuito em 180 deg para o Leste/Sul, reconstroi o Santuario Celestial,
// gera terrain.png + terrain.glb 100% sincronizados, reposiciona props/vegetacao
// e renderiza map-day / map-night (1024x1024).
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import sharp from 'sharp'
import { Document, NodeIO, PropertyType, VertexLayout } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backupRoot = resolve(root, 'resources/backup-pre-phase5')
const stat = (...p) => resolve(root, 'static', ...p)

const ASSETS_TO_BACKUP = [
    'areas/areas.glb',
    'scenery/scenery.glb',
    'terrain/terrain.glb',
    'terrain/terrain.png',
    'respawns/respawnsReferences.glb',
    'birchTrees/birchTreesReferences.glb',
    'oakTrees/oakTreesReferences.glb',
    'cherryTrees/cherryTreesReferences.glb',
    'bushes/bushesReferences.glb',
    'flowers/flowersReferences.glb',
    'fences/fences.glb',
    'benches/benches.glb',
    'bricks/bricks.glb',
    'lanterns/lanterns.glb',
    'poleLights/poleLights.glb',
    'explosiveCrates/explosiveCrates.glb',
    'tornado/tornadoPathReferences.glb',
]

// Backup idempotente antes de qualquer modificacao
for(const rel of ASSETS_TO_BACKUP)
{
    const dst = resolve(backupRoot, rel)
    if(!existsSync(dst))
    {
        mkdirSync(dirname(dst), { recursive: true })
        copyFileSync(stat(rel), dst)
    }
}

const bkp = (rel) => resolve(backupRoot, rel)
const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
        'draco3d.decoder': await draco3d.createDecoderModule(),
        'draco3d.encoder': await draco3d.createEncoderModule(),
    })
    .setVertexLayout(VertexLayout.SEPARATE)

// Helpers matematicos
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const smoothstep = (e0, e1, x) =>
{
    const t = clamp((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)
}
const smin = (a, b, k = 8) =>
{
    const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)
}
const distToSegment = (px, pz, ax, az, bx, bz) =>
{
    const dx = bx - ax
    const dz = bz - az
    const l2 = dx * dx + dz * dz
    if(l2 === 0) return Math.hypot(px - ax, pz - az)
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1)
    return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}
const rotate180YQuat = (q) =>
{
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
    const cur = q ? new THREE.Quaternion(q[0], q[1], q[2], q[3]) : new THREE.Quaternion()
    rot.multiply(cur)
    return [ rot.x, rot.y, rot.z, rot.w ]
}
const yawQuat = (yaw) =>
{
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    return [ q.x, q.y, q.z, q.w ]
}
const seededRng = (seed) =>
{
    let s = seed >>> 0
    return () =>
    {
        s = (s + 0x6d2b79f5) | 0
        let t = Math.imul(s ^ (s >>> 15), 1 | s)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ============================================================================
// 1. Novos Alvos das Areas & Respawns (Oeste / Norte / Ilhota + Circuito Leste)
// ============================================================================
const AREA_TARGETS = {
    landing:        { x: -42, z: -8 },
    career:         { x: -44, z: -38 },
    social:         { x: -44, z: -68 },
    projects:       { x: -72, z: -26 },
    lab:            { x: -72, z: -52 },
    cookie:         { x: -74, z: 2 },
    bowling:        { x: -62, z: 24 },
    behindTheScene: { x: -22, z: -36 },
    altar:          { x: -14, z: -68 },
    achievements:   { x: 12,  z: -68 },
    timeMachine:    { x: 54,  z: -46 },
    toilet:         { x: -82, z: -74 },
}

const RESPAWN_TARGETS = {
    respawnLanding:        { x: -51.7, y: 0.5,  z: -8.7,  yaw: -0.12 },
    respawnControls:       { x: -42.0, y: 0.5,  z: -12.0, yaw: 0 },
    respawnBonfire:        { x: -36.2, y: 0.5,  z: -2.5,  yaw: -2.2 },
    respawnCareer:         { x: -43.6, y: 0.5,  z: -27.5, yaw: Math.PI * 0.5 },
    respawnSocial:         { x: -47.2, y: 0.5,  z: -60.6, yaw: 0.55 },
    respawnOnlyFans:       { x: -36.0, y: 0.5,  z: -74.0, yaw: 1.05 },
    respawnProjects:       { x: -72.0, y: 1.11, z: -21.8, yaw: 1.16 },
    respawnLab:            { x: -67.3, y: 0.5,  z: -50.9, yaw: 2.75 },
    respawnCookie:         { x: -70.6, y: 0.5,  z: 3.1,   yaw: 2.92 },
    respawnBowling:        { x: -43.0, y: 0.5,  z: 17.3,  yaw: -2.58 },
    respawnBehindTheScene: { x: -25.6, y: 0.5,  z: -35.5, yaw: -0.18 },
    respawnAltar:          { x: -14.0, y: 0.5,  z: -56.0, yaw: Math.PI * 0.5 },
    respawnAchievements:   { x: 11.4,  y: 0.61, z: -57.6, yaw: 1.70 },
    respawnTimeMachine:    { x: 52.0,  y: 0.5,  z: -43.3, yaw: 0.87 },
    respawnToilet:         { x: -78.0, y: 0.5,  z: -74.7, yaw: -2.89 },
    respawnBridge:         { x: -28.0, y: 0.5,  z: -10.0, yaw: 0 },
    respawnTest:           { x: -42.0, y: 2.25, z: -52.0, yaw: 0 },
    // respawnCircuit sera derivado automaticamente por rotacao 180 deg do original
}

// ============================================================================
// 2. Atualizar areas.glb (rotacionar circuit 180, mover areas, reconstruir altar)
// ============================================================================
const areasDoc = await io.read(bkp('areas/areas.glb'))
const areasRoot = areasDoc.getRoot()
const areasScene = areasRoot.listScenes()[0]
const paletteMat = areasRoot.listMaterials().find(m => m.getName() === 'palette')

const disposeNodeTree = (node, parent) =>
{
    for(const c of [ ...node.listChildren() ])
        disposeNodeTree(c, node)
    const mesh = node.getMesh()
    if(mesh)
    {
        for(const p of mesh.listPrimitives()) p.dispose()
        mesh.dispose()
    }
    if(parent) parent.removeChild(node)
    else areasScene.removeChild(node)
    node.dispose()
}

// Remover cuboids orfaos da raiz (sobras antigas de landing)
for(const n of [ ...areasScene.listChildren() ])
{
    if(/^cuboid\./.test(n.getName()))
        disposeNodeTree(n, null)
}

// Substituir o antigo circuit pelo Parque das Paixoes no Leste (34, 0, 10)
const circuitNode = areasScene.listChildren().find(n => n.getName() === 'circuit')
{
    for(const child of [ ...circuitNode.listChildren() ])
        disposeNodeTree(child, circuitNode)
    circuitNode.setTranslation([ 34, 0, 10 ])
    circuitNode.setRotation([ 0, 0, 0, 1 ])
    circuitNode.addChild(areasDoc.createNode('refZoneBounding.circuit').setTranslation([ 0, 3.27, 0 ]).setScale([ 52, 52, 52 ]))
    circuitNode.addChild(areasDoc.createNode('refZoneFrustum.circuit').setTranslation([ 0, 3.27, 0 ]).setScale([ 58, 58, 58 ]))
}

// Reposicionar as 12 areas restantes
for(const [ name, target ] of Object.entries(AREA_TARGETS))
{
    const node = areasScene.listChildren().find(n => n.getName() === name)
    if(!node) throw new Error(`Area ausente: ${name}`)
    const t = node.getTranslation()
    node.setTranslation([ target.x, t[1], target.z ])
}

// Reconstruir o Santuario Celestial dentro de `altar` (zero caveiras / zero colunas escuras)
{
    const altarNode = areasScene.listChildren().find(n => n.getName() === 'altar')
    for(const c of [ ...altarNode.listChildren() ])
        disposeNodeTree(c, altarNode)

    const stoneUv = [ 54.5 / 128, 0.5 ] // #a49876 pedra clara
    const ivoryUv = [ 93.5 / 128, 0.5 ] // #fff2e8 marmore branco
    const goldUv  = [ 33.5 / 128, 0.5 ] // #e4a90c dourado solar

    const combineParts = (parts) =>
    {
        let total = 0
        const norms = parts.map(({ g, uv }) =>
        {
            const ng = g.index ? g.toNonIndexed() : g.clone()
            ng.computeVertexNormals()
            total += ng.getAttribute('position').count
            return { ng, uv }
        })
        const pos = new Float32Array(total * 3)
        const nor = new Float32Array(total * 3)
        const uvs = new Float32Array(total * 2)
        let off = 0
        for(const { ng, uv } of norms)
        {
            const p = ng.getAttribute('position')
            const n = ng.getAttribute('normal')
            for(let i = 0; i < p.count; i++)
            {
                const k = off + i
                pos[k * 3] = p.getX(i); pos[k * 3 + 1] = p.getY(i); pos[k * 3 + 2] = p.getZ(i)
                nor[k * 3] = n.getX(i); nor[k * 3 + 1] = n.getY(i); nor[k * 3 + 2] = n.getZ(i)
                uvs[k * 2] = uv[0]; uvs[k * 2 + 1] = uv[1]
            }
            off += p.count
            ng.dispose()
        }
        const buf = areasRoot.listBuffers()[0] ?? areasDoc.createBuffer()
        return areasDoc.createPrimitive()
            .setAttribute('POSITION', areasDoc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
            .setAttribute('NORMAL', areasDoc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
            .setAttribute('TEXCOORD_0', areasDoc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buf))
            .setMaterial(paletteMat)
    }

    const parts = []
    const addPart = (g, uv, tx = 0, ty = 0, tz = 0) =>
    {
        g.translate(tx, ty, tz)
        parts.push({ g, uv })
    }

    // Plataforma de marmore e ouro rente e dirigivel (evita afundar pneus)
    addPart(new THREE.CylinderGeometry(7.2, 7.8, 0.05, 16), stoneUv, 0, 0.025, 0)
    addPart(new THREE.CylinderGeometry(5.8, 6.2, 0.04, 16), ivoryUv, 0, 0.07, 0)
    addPart(new THREE.TorusGeometry(5.6, 0.07, 8, 32).rotateX(Math.PI * 0.5), goldUv, 0, 0.095, 0)

    // 6 colunas celestiais em arco (deixando o Sul +Z bem aberto para entrar com o carro)
    const colAngles = [ 2.25, 2.85, 3.55, 4.30, 5.05, 5.65 ] // pula ~PI/2 (Sul = +Z)
    const colPositions = []
    for(const ang of colAngles)
    {
        const cx = Math.cos(ang) * 5.2
        const cz = Math.sin(ang) * 5.2
        colPositions.push([ cx, cz ])
        addPart(new THREE.CylinderGeometry(0.46, 0.54, 0.42, 10), ivoryUv, cx, 0.30, cz)
        addPart(new THREE.CylinderGeometry(0.32, 0.38, 3.3, 10), ivoryUv, cx, 2.15, cz)
        addPart(new THREE.CylinderGeometry(0.50, 0.36, 0.38, 10), goldUv, cx, 3.95, cz)
    }

    // Anel superior dourado coroando as colunas
    addPart(new THREE.TorusGeometry(5.2, 0.22, 10, 32).rotateX(Math.PI * 0.5), goldUv, 0, 4.30, 0)

    const sanctuaryMesh = areasDoc.createMesh('sanctuaryStructure').addPrimitive(combineParts(parts))
    const sanctuaryGroup = areasDoc.createNode('physicalFixed.005').setMesh(sanctuaryMesh)

    for(let i = 0; i < colPositions.length; i++)
    {
        const [ cx, cz ] = colPositions[i]
        sanctuaryGroup.addChild(
            areasDoc.createNode(`cuboid.sanctuary${i}`)
                .setTranslation([ cx, 2.1, cz ])
                .setScale([ 0.9, 4.2, 0.9 ])
        )
    }
    altarNode.addChild(sanctuaryGroup)
    altarNode.addChild(areasDoc.createNode('refAltar').setTranslation([ 0, 0.11, 0 ]))
    altarNode.addChild(areasDoc.createNode('refCounter').setTranslation([ 4.4, 2.1, 4.8 ]).setRotation(yawQuat(-0.4)))
    altarNode.addChild(areasDoc.createNode('refZoneBounding.006').setTranslation([ 0, 3.27, 1.5 ]).setScale([ 12.5, 12.5, 12.5 ]))
    altarNode.addChild(areasDoc.createNode('refZoneFrustum.006').setTranslation([ 0, 3.27, 0 ]).setScale([ 15.0, 15.0, 15.0 ]))
}

await areasDoc.transform(prune({
    keepLeaves: true,
    keepExtras: true,
    keepAttributes: true,
    keepIndices: true,
    propertyTypes: [ PropertyType.MESH, PropertyType.PRIMITIVE, PropertyType.ACCESSOR, PropertyType.BUFFER ],
}))
await io.write(stat('areas/areas.glb'), areasDoc)

// ============================================================================
// 3. Atualizar scenery.glb (remover pista de corrida antiga + mover pontes/pedras)
// ============================================================================
const sceneryDoc = await io.read(bkp('scenery/scenery.glb'))
const sceneryScene = sceneryDoc.getRoot().listScenes()[0]
const ROAD_NODES = new Set(['refRoad','Cube.001','Cube.049','Cube.059','Cube.064','Cube.066','Cube.067','Cube.071','Cube.072','Cube.074','Cube.075','Cube.076','Cube.078','Cube.079'])

const disposeSceneryNode = (node) =>
{
    for(const c of [ ...node.listChildren() ])
        disposeSceneryNode(c)
    const mesh = node.getMesh()
    if(mesh)
    {
        for(const p of mesh.listPrimitives()) p.dispose()
        mesh.dispose()
    }
    sceneryScene.removeChild(node)
    node.dispose()
}

for(const node of [ ...sceneryScene.listChildren() ])
{
    const name = node.getName()
    if(ROAD_NODES.has(name))
    {
        disposeSceneryNode(node)
    }
    else if(name === 'bridgePhysicalFixed')
    {
        // Ponte cruzando o Canal Norte entre Career/BehindTheScene e o Santuario Celestial
        node.setTranslation([ -14, -0.10, -48 ])
        node.setRotation(yawQuat(0))
    }
    else if(name === 'bridgePhysicalFixed.001')
    {
        // Ponte cruzando a Lagoa Central entre Landing e Bowling
        node.setTranslation([ -46, -0.10, 2 ])
        node.setRotation(yawQuat(-0.35))
    }
    else if(name === 'slabes')
    {
        // Pedras decorativas entre Landing e Projects
        node.setTranslation([ -58, -0.39, -15 ])
    }
    else if(name === 'Cube.002')
    {
        // Degrau do Cookie Stand
        node.setTranslation([ -77, 0.35, -0.5 ])
    }
    else if(name === 'Cube.157')
    {
        // Pedra/penhasco decorativo atras do Toilet no Noroeste
        node.setTranslation([ -86, -0.14, -84 ])
    }
    else if(name === 'basaltRocksPhysicalStatic')
        node.setTranslation([ -26, -0.65, -62 ])
    else if(name === 'basaltRocksPhysicalStatic.001')
        node.setTranslation([ -58, -0.77, -10 ])
    else if(name === 'basaltRocksPhysicalStatic.002')
        node.setTranslation([ -30, -0.48, 12 ])
    else if(name === 'basaltRocksPhysicalStatic.003')
        node.setTranslation([ 20, 1.31, -70 ])
    else if(name === 'basaltRocksPhysicalStatic.004')
        node.setTranslation([ -6, 0.72, -78 ])
}
await io.write(stat('scenery/scenery.glb'), sceneryDoc)

// Sem pista de corrida no Parque Leste
const rotatedRoadTris = []

// ============================================================================
// 4. Atualizar respawnsReferences.glb
// ============================================================================
const respDoc = await io.read(bkp('respawns/respawnsReferences.glb'))
const respScene = respDoc.getRoot().listScenes()[0]
for(const node of respScene.listChildren())
{
    const name = node.getName()
    if(name === 'respawnCircuit')
    {
        node.setTranslation([ 34, 0.5, 10 ])
        node.setRotation(yawQuat(0.3))
    }
    else if(RESPAWN_TARGETS[name])
    {
        const cfg = RESPAWN_TARGETS[name]
        node.setTranslation([ cfg.x, cfg.y, cfg.z ])
        node.setRotation(yawQuat(cfg.yaw))
    }
}
await io.write(stat('respawns/respawnsReferences.glb'), respDoc)

// ============================================================================
// 5. Gerar novo terrain.png (512x512 RGBA) + terrain.glb (129x129) 100% sincronizados
// ============================================================================
// Rasterizar triangulos da pista num grid 384x384 + Distance Transform exato (2 passadas Chamfer)
const TRACK_GRID = 384
const trackDistGrid = new Float32Array(TRACK_GRID * TRACK_GRID).fill(1e6)
const cellMeters = 192 / (TRACK_GRID - 1)
{
    const ptTriDist = (px, pz, a, b, c) =>
    {
        // Ponto dentro do triangulo?
        const v0x = c[0] - a[0], v0z = c[1] - a[1]
        const v1x = b[0] - a[0], v1z = b[1] - a[1]
        const v2x = px - a[0],   v2z = pz - a[1]
        const dot00 = v0x * v0x + v0z * v0z
        const dot01 = v0x * v1x + v0z * v1z
        const dot02 = v0x * v2x + v0z * v2z
        const dot11 = v1x * v1x + v1z * v1z
        const dot12 = v1x * v2x + v1z * v2z
        const denom = dot00 * dot11 - dot01 * dot01
        if(Math.abs(denom) > 1e-8)
        {
            const u = (dot11 * dot02 - dot01 * dot12) / denom
            const v = (dot00 * dot12 - dot01 * dot02) / denom
            if(u >= 0 && v >= 0 && u + v <= 1) return 0
        }
        return Math.min(
            distToSegment(px, pz, a[0], a[1], b[0], b[1]),
            distToSegment(px, pz, b[0], b[1], c[0], c[1]),
            distToSegment(px, pz, c[0], c[1], a[0], a[1])
        )
    }

    for(const [a, b, c] of rotatedRoadTris)
    {
        const minX = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - 2 + 96) / 192 * (TRACK_GRID - 1)))
        const maxX = Math.min(TRACK_GRID - 1, Math.ceil((Math.max(a[0], b[0], c[0]) + 2 + 96) / 192 * (TRACK_GRID - 1)))
        const minZ = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - 2 + 96) / 192 * (TRACK_GRID - 1)))
        const maxZ = Math.min(TRACK_GRID - 1, Math.ceil((Math.max(a[1], b[1], c[1]) + 2 + 96) / 192 * (TRACK_GRID - 1)))
        for(let gz = minZ; gz <= maxZ; gz++)
        {
            const wz = (gz / (TRACK_GRID - 1) - 0.5) * 192
            for(let gx = minX; gx <= maxX; gx++)
            {
                const wx = (gx / (TRACK_GRID - 1) - 0.5) * 192
                const d = ptTriDist(wx, wz, a, b, c)
                const idx = gz * TRACK_GRID + gx
                if(d < trackDistGrid[idx]) trackDistGrid[idx] = d
            }
        }
    }
    // Chamfer distance transform em metros para distancia suave ate 25m
    const dDiag = Math.SQRT2 * cellMeters
    for(let gz = 0; gz < TRACK_GRID; gz++)
    {
        for(let gx = 0; gx < TRACK_GRID; gx++)
        {
            const idx = gz * TRACK_GRID + gx
            let v = trackDistGrid[idx]
            if(gx > 0) v = Math.min(v, trackDistGrid[idx - 1] + cellMeters)
            if(gz > 0) v = Math.min(v, trackDistGrid[idx - TRACK_GRID] + cellMeters)
            if(gx > 0 && gz > 0) v = Math.min(v, trackDistGrid[idx - TRACK_GRID - 1] + dDiag)
            if(gx < TRACK_GRID - 1 && gz > 0) v = Math.min(v, trackDistGrid[idx - TRACK_GRID + 1] + dDiag)
            trackDistGrid[idx] = v
        }
    }
    for(let gz = TRACK_GRID - 1; gz >= 0; gz--)
    {
        for(let gx = TRACK_GRID - 1; gx >= 0; gx--)
        {
            const idx = gz * TRACK_GRID + gx
            let v = trackDistGrid[idx]
            if(gx < TRACK_GRID - 1) v = Math.min(v, trackDistGrid[idx + 1] + cellMeters)
            if(gz < TRACK_GRID - 1) v = Math.min(v, trackDistGrid[idx + TRACK_GRID] + cellMeters)
            if(gx < TRACK_GRID - 1 && gz < TRACK_GRID - 1) v = Math.min(v, trackDistGrid[idx + TRACK_GRID + 1] + dDiag)
            if(gx > 0 && gz < TRACK_GRID - 1) v = Math.min(v, trackDistGrid[idx + TRACK_GRID - 1] + dDiag)
            trackDistGrid[idx] = v
        }
    }
}
const sampleTrackDist = (wx, wz) =>
{
    const fx = clamp((wx + 96) / 192 * (TRACK_GRID - 1), 0, TRACK_GRID - 1.001)
    const fz = clamp((wz + 96) / 192 * (TRACK_GRID - 1), 0, TRACK_GRID - 1.001)
    const x0 = Math.floor(fx), z0 = Math.floor(fz)
    const tx = fx - x0, tz = fz - z0
    const i00 = z0 * TRACK_GRID + x0
    const a = trackDistGrid[i00] * (1 - tx) + trackDistGrid[i00 + 1] * tx
    const b = trackDistGrid[i00 + TRACK_GRID] * (1 - tx) + trackDistGrid[i00 + TRACK_GRID + 1] * tx
    return a * (1 - tz) + b * tz
}

// Segmentos de estrada de pedra do novo mapa
const ROAD_SEGMENTS = [
    // Anel principal narrativo: Landing -> Career -> Social -> Santuario -> BehindTheScene -> Landing
    [ -42, -8,  -44, -27 ],
    [ -44, -27, -44, -46 ],
    [ -44, -46, -44, -61 ],
    [ -44, -61, -30, -56 ],
    [ -30, -56, -22, -36 ],
    [ -22, -36, -34, -22 ],
    [ -34, -22, -42, -8 ],
    // Ramal Norte ate Santuario Celestial + Cachoeira Achievements
    [ -22, -36, -14, -56 ],
    [ -14, -56, -14, -64 ],
    [ -14, -56,  11, -58 ],
    [  11, -58,  12, -64 ],
    // Braço Oeste: Landing -> Projects -> Lab -> Social
    [ -42, -8,  -66, -20 ],
    [ -66, -20, -70, -24 ],
    [ -70, -24, -68, -48 ],
    [ -68, -48, -56, -59 ],
    [ -56, -59, -44, -61 ],
    // Ramais Cookie, Bowling e Parque das Paixoes (Leste)
    [ -42, -8,  -69,  1 ],
    [ -42, -8,  -48,  6 ],
    [ -48,  6,  -44, 17 ],
    [ -42, -8,  -12, -10 ],
    [ -12, -10,  20,  10 ],
    [  20,  10,  34,  10 ],
    // Trilhas dentro do Parque das Paixoes ligando as 5 arenas
    [  34,  10,  24, -14 ], // Agro
    [  34,  10,  52, -10 ], // Tech
    [  34,  10,  54,  22 ], // Negocios
    [  34,  10,  28,  34 ], // Musica
    // Passagem rasa de areia para TimeMachine na ilhota NE
    [  38, -46,  52, -43 ],
]

// Lobulos organicos de terra seca (SDF negativo = terra, positivo = agua)
const LAND_CIRCLES = [
    // Continente Oeste principal
    [ -44, -10, 22 ],
    [ -46, -36, 20 ],
    [ -46, -64, 18 ],
    [ -68, -22, 17 ],
    [ -68, -48, 17 ],
    [ -72,   2, 14 ],
    [ -58,  22, 23 ], // Bowling peninsula
    [ -24, -34, 16 ], // BehindTheScene
    [ -80, -72, 12 ], // Toilet NW grove
    // Peninsulas do Santuario Celestial & Cachoeira
    [ -14, -68, 12 ],
    [  11, -60, 13 ],
    // Parque das Paixoes Leste & Ilhota TimeMachine
    [ -12, -10, 14 ],
    [  18,  10, 20 ],
    [  36,   8, 30 ],
    [  52, -10, 22 ],
    [  54,  22, 22 ],
    [  28,  34, 20 ],
    [  54, -46, 12 ],
    [  54,  52, 14 ],
]

// Canais e lagoas cavadas (forcam agua onde queremos pontes e enseadas!)
const WATER_CARVES = [
    // Lagoa Central-Oeste (abaixo da ponte 2 entre Landing e Bowling, sem tocar respawnBowling)
    [ -46, 3.5, 4.0 ],
    [ -31, 10, 6.2 ],
    // Canal Norte (abaixo da ponte 1 para o Santuario)
    [ -14, -50.5, 4.5 ],
    [ -25, -52, 5.2 ],
    // Enseada atras da Cachoeira de Achievements
    [ 12, -82, 11.5 ],
    // Baia Oceânica Aberta no Sudoeste (futura Passagem Underwater!)
    [ -78, 68, 28 ],
    [ -88, 46, 16 ],
]

const PAVED_CIRCLES = [
    [ -42, -8,  10.5 ], // Landing plaza
    [ -72, -26,  6.5 ], // Projects
    [ -72, -52,  6.0 ], // Lab
    [ -74,  2,   6.0 ], // Cookie
    [ -62, 24,  15.5 ], // Bowling lane & plaza
    [ -14, -68,  8.5 ], // Santuario Celestial
    [ -22, -36,  6.5 ], // BehindTheScene
    [  12, -68,  7.0 ], // Achievements
    [ -44, -66,  8.5 ], // Social
    // Pracas do Parque das Paixoes
    [  34,  10,  6.5 ], // Praca Central
    [  24, -14,  7.5 ], // Agro
    [  52, -10,  7.5 ], // Tech
    [  54,  22,  7.5 ], // Negocios
    [  28,  34,  8.0 ], // Musica
    [  20,  10,  7.5 ], // Musculacao
]

const evalTerrain = (wx, wz) =>
{
    let dLand = 999
    for(const [cx, cz, r] of LAND_CIRCLES)
        dLand = smin(dLand, Math.hypot(wx - cx, wz - cz) - r, 9)

    // Circuito tem leito seco amplo ao redor da pista
    const dTrack = sampleTrackDist(wx, wz)
    dLand = smin(dLand, dTrack - 9.5, 6)

    // Recorte natural da borda do mapa para manter oceano aberto nas margens
    const edgeMargin = Math.max(Math.abs(wx) - 86, Math.abs(wz) - 86)
    if(edgeMargin > 0) dLand = Math.max(dLand, edgeMargin)

    // Cavar lagoas / canais / baia SW
    for(const [cx, cz, r] of WATER_CARVES)
    {
        const dw = r - Math.hypot(wx - cx, wz - cz)
        dLand = Math.max(dLand, dw)
    }

    // Ondulacao suave costeira deterministica
    const wave = Math.sin(wx * 0.13 + wz * 0.09) * 1.4 + Math.cos(wx * 0.07 - wz * 0.15) * 1.2
    const dCoast = dLand + wave

    // Canal B: 0 = terra seca, 0..1 = praia -> fundo oceanico
    const b = smoothstep(0.0, 7.5, dCoast)

    // Canal R: estradas de pedra
    let dRoad = 999
    for(const [ax, az, bx, bz] of ROAD_SEGMENTS)
        dRoad = Math.min(dRoad, distToSegment(wx, wz, ax, az, bx, bz))
    const roadMask = smoothstep(4.2, 2.3, dRoad) * (1 - smoothstep(0.02, 0.22, b))

    // Canal G: grama (fora da agua, fora de estradas, fora do circuito e pracas pavimentadas)
    let paved = 0
    for(const [px, pz, pr] of PAVED_CIRCLES)
        paved = Math.max(paved, smoothstep(pr + 1.5, pr - 1.0, Math.hypot(wx - px, wz - pz)))
    const trackClear = smoothstep(6.2, 3.8, dTrack)
    const dryCore = smoothstep(-0.8, -3.4, dCoast)
    const g = dryCore * (1 - roadMask) * (1 - paved) * (1 - trackClear)

    return { r: roadMask, g, b, dCoast, dTrack, dRoad }
}

// Escrever terrain.png (512x512 RGBA)
const T_SIZE = 512
const terrainPng = Buffer.alloc(T_SIZE * T_SIZE * 4)
for(let py = 0; py < T_SIZE; py++)
{
    const wz = (py / (T_SIZE - 1) - 0.5) * 192
    for(let px = 0; px < T_SIZE; px++)
    {
        const wx = (px / (T_SIZE - 1) - 0.5) * 192
        const { r, g, b } = evalTerrain(wx, wz)
        const o = (py * T_SIZE + px) * 4
        terrainPng[o + 0] = Math.round(clamp(r, 0, 1) * 255)
        terrainPng[o + 1] = Math.round(clamp(g, 0, 1) * 255)
        terrainPng[o + 2] = Math.round(clamp(b, 0, 1) * 255)
        terrainPng[o + 3] = 255
    }
}
await sharp(terrainPng, { raw: { width: T_SIZE, height: T_SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(stat('terrain/terrain.png'))

// Gerar terrain.glb (129x129 heightfield sincronizado)
{
    const geo = new THREE.PlaneGeometry(192, 192, 128, 128)
    geo.rotateX(-Math.PI * 0.5)
    const pos = geo.attributes.position
    for(let i = 0; i < pos.count; i++)
    {
        const wx = pos.getX(i)
        const wz = pos.getZ(i)
        const { b } = evalTerrain(wx, wz)
        pos.setY(i, -1.5 * b)
    }
    const tDoc = new Document()
    const buf = tDoc.createBuffer()
    const prim = tDoc.createPrimitive()
        .setAttribute('POSITION', tDoc.createAccessor().setType('VEC3').setArray(new Float32Array(pos.array)).setBuffer(buf))
        .setIndices(tDoc.createAccessor().setType('SCALAR').setArray(new Uint16Array(geo.index.array)).setBuffer(buf))
    const node = tDoc.createNode('terrain').setMesh(tDoc.createMesh('terrain').addPrimitive(prim))
    tDoc.createScene('Scene').addChild(node)
    await io.write(stat('terrain/terrain.glb'), tDoc)
    geo.dispose()
}

// ============================================================================
// 6. Reposicionar Props, Vegetacao e Brisa Celestial sobre terra seca livre
// ============================================================================
const PARK_ARENAS = [
    { x: 34, z: 10 },
    { x: 24, z: -14 },
    { x: 52, z: -10 },
    { x: 54, z: 22 },
    { x: 28, z: 34 },
    { x: 20, z: 10 },
]

const isDryClearSpot = (wx, wz, minRoadDist = 4.8) =>
{
    if(Math.abs(wx) > 84 || Math.abs(wz) > 84) return false
    const { b, dTrack, dRoad } = evalTerrain(wx, wz)
    if(b > 0.02 || dTrack < 6.8 || dRoad < minRoadDist) return false
    for(const target of [ ...Object.values(AREA_TARGETS), ...PARK_ARENAS ])
    {
        if(Math.hypot(wx - target.x, wz - target.z) < 11.5)
            return false
    }
    for(const r of Object.values(RESPAWN_TARGETS))
    {
        if(Math.hypot(wx - r.x, wz - r.z) < 5.5)
            return false
    }
    return true
}

const scatterPoints = (count, seed, minRoadDist = 4.8) =>
{
    const rng = seededRng(seed)
    const pts = []
    let tries = 0
    while(pts.length < count && tries < count * 80)
    {
        tries++
        const wx = (rng() * 2 - 1) * 82
        const wz = (rng() * 2 - 1) * 82
        if(isDryClearSpot(wx, wz, minRoadDist))
            pts.push([ wx, wz, rng() * Math.PI * 2 ])
    }
    return pts
}

const relocateRefGlb = async(rel, seed, yMode = 'preserve', minRoadDist = 5.0) =>
{
    const doc = await io.read(bkp(rel))
    const sc = doc.getRoot().listScenes()[0]
    const nodes = sc.listChildren()
    const pts = scatterPoints(nodes.length, seed, minRoadDist)
    for(let i = 0; i < nodes.length; i++)
    {
        const node = nodes[i]
        const [ wx, wz, yaw ] = pts[i % pts.length]
        const t = node.getTranslation()
        node.setTranslation([ wx, yMode === 'ground' ? 0 : t[1], wz ])
        if(yMode === 'preserveYaw')
            node.setRotation(yawQuat(yaw))
    }
    await io.write(stat(rel), doc)
    return pts
}

const birchPts = await relocateRefGlb('birchTrees/birchTreesReferences.glb', 101, 'ground', 5.4)
const oakPts   = await relocateRefGlb('oakTrees/oakTreesReferences.glb', 202, 'ground', 5.4)
const cherryPts = await relocateRefGlb('cherryTrees/cherryTreesReferences.glb', 303, 'ground', 5.4)
await relocateRefGlb('bushes/bushesReferences.glb', 404, 'preserve', 4.6)
await relocateRefGlb('flowers/flowersReferences.glb', 505, 'preserve', 4.2)
await relocateRefGlb('fences/fences.glb', 606, 'preserveYaw', 5.2)
await relocateRefGlb('benches/benches.glb', 707, 'preserveYaw', 4.8)
await relocateRefGlb('bricks/bricks.glb', 808, 'preserve', 5.5)
await relocateRefGlb('lanterns/lanterns.glb', 909, 'preserveYaw', 4.5)
await relocateRefGlb('poleLights/poleLights.glb', 1010, 'preserveYaw', 4.3)
const cratePts = await relocateRefGlb('explosiveCrates/explosiveCrates.glb', 1111, 'preserve', 5.2)

// Caminho da Brisa Celestial partindo ao redor do Santuario Celestial (-14, -68)
{
    const doc = await io.read(bkp('tornado/tornadoPathReferences.glb'))
    const sc = doc.getRoot().listScenes()[0]
    const nodes = sc.listChildren().sort((a, b) => a.getName().localeCompare(b.getName()))
    for(let i = 0; i < nodes.length; i++)
    {
        const ang = (i / nodes.length) * Math.PI * 2
        const rad = 32 + Math.sin(ang * 3) * 10
        const wx = -24 + Math.cos(ang) * rad
        const wz = -34 + Math.sin(ang) * rad
        const t = nodes[i].getTranslation()
        nodes[i].setTranslation([ clamp(wx, -82, 82), t[1], clamp(wz, -82, 82) ])
    }
    await io.write(stat('tornado/tornadoPathReferences.glb'), doc)
}

// ============================================================================
// 7. Renderizar Novo Mapa 2D (map-day / map-night 1024x1024) exato [-96, +96]
// ============================================================================
const renderMap = async(isNight) =>
{
    const M = 1024
    const buf = Buffer.alloc(M * M * 4)

    const hexToRgb = (h) => [ parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16) ]
    const mixRgb = (a, b, t) => [ a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t ]

    const cDeep  = hexToRgb(isNight ? '#0e244c' : '#12487a')
    const cShal  = hexToRgb(isNight ? '#1b4f78' : '#34cfc4')
    const cSand  = hexToRgb(isNight ? '#877656' : '#f4d38c')
    const cGrass = hexToRgb(isNight ? '#2e6336' : '#76c442')
    const cRoad  = hexToRgb(isNight ? '#6e6a65' : '#ead4ae')
    const cTrack = hexToRgb(isNight ? '#2c303a' : '#3b3e47')
    const cFoam  = hexToRgb(isNight ? '#70c8e8' : '#e8fbff')

    for(let py = 0; py < M; py++)
    {
        const wz = (py / (M - 1) - 0.5) * 192
        for(let px = 0; px < M; px++)
        {
            const wx = (px / (M - 1) - 0.5) * 192
            const { r, g, b, dTrack } = evalTerrain(wx, wz)

            let col = b > 0.35
                ? mixRgb(cShal, cDeep, clamp((b - 0.35) / 0.55, 0, 1))
                : mixRgb(cSand, cShal, clamp(b / 0.35, 0, 1))

            // Espuma suave na linha da praia
            if(b > 0.08 && b < 0.16)
                col = mixRgb(col, cFoam, 0.55)

            // Grama e estradas
            col = mixRgb(col, cGrass, g)
            col = mixRgb(col, cRoad, r)

            // Pista do Circuito rotacionada com zebras suaves
            if(dTrack < 1.15)
            {
                if(dTrack > 0.35)
                {
                    const stripe = Math.floor((wx + wz) * 0.48) % 2 === 0
                    col = hexToRgb(stripe ? '#e84838' : '#f7f9fc')
                }
                else
                {
                    col = cTrack
                }
            }

            const o = (py * M + px) * 4
            buf[o + 0] = Math.round(col[0])
            buf[o + 1] = Math.round(col[1])
            buf[o + 2] = Math.round(col[2])
            buf[o + 3] = 255
        }
    }

    // Overlays nitidos SVG: pontes, Santuario dourado, boliche e marcador oceanico SW (futura passagem underwater)
    const toPx = (wx, wz) => [ ((wx / 192) + 0.5) * M, ((wz / 192) + 0.5) * M ]
    const [sx, sy] = toPx(-14, -68)
    const [bx1, by1] = toPx(-14, -51)
    const [bx2, by2] = toPx(-48, 6)
    const [bowX, bowY] = toPx(-62, 24)
    const [uwX, uwY] = toPx(-78, 68)
    const [landX, landY] = toPx(-42, -8)

    const parkBadges = [
        { x: 24, z: -14, c: '#2d8a4e', r: 16 },
        { x: 52, z: -10, c: '#22d3ee', r: 16 },
        { x: 54, z:  22, c: '#eab308', r: 16 },
        { x: 28, z:  34, c: '#c67c3b', r: 17 },
        { x: 20, z:  10, c: '#dc2626', r: 16 },
    ].map(({ x, z, c, r }) =>
    {
        const [ px, py ] = toPx(x, z)
        return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" fill="none" stroke="${c}" stroke-width="4" opacity="0.88"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r - 7}" fill="${c}" opacity="0.32"/>`
    }).join('')

    const treeDots = [
        ...birchPts.map(([x, z]) => ({ x, z, c: isNight ? '#1f6e45' : '#2fa866', r: 9 })),
        ...oakPts.map(([x, z]) => ({ x, z, c: isNight ? '#9a7814' : '#f2b705', r: 8 })),
        ...cherryPts.map(([x, z]) => ({ x, z, c: isNight ? '#a6435e' : '#ff6f91', r: 8 })),
    ].map(({ x, z, c, r }) =>
    {
        const [ px, py ] = toPx(x, z)
        return `<circle cx="${(px + 2).toFixed(1)}" cy="${(py + 3).toFixed(1)}" r="${r}" fill="#0b2f52" opacity="0.25"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" fill="${c}"/>`
    }).join('')

    const overlaySvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${M}" height="${M}" viewBox="0 0 ${M} ${M}">
        <rect x="${bx1 - 14}" y="${by1 - 24}" width="28" height="48" rx="4" fill="#c7834c" stroke="#6b4426" stroke-width="3"/>
        <g transform="translate(${bx2} ${by2}) rotate(-20)">
            <rect x="-14" y="-24" width="28" height="48" rx="4" fill="#c7834c" stroke="#6b4426" stroke-width="3"/>
        </g>
        <rect x="${bowX - 65}" y="${bowY - 20}" width="130" height="40" rx="8" fill="${isNight ? '#40485e' : '#f2dfc2'}" opacity="0.9"/>
        <circle cx="${landX}" cy="${landY}" r="22" fill="${isNight ? '#3d4c68' : '#f7e5c2'}" opacity="0.75"/>
        <circle cx="${sx}" cy="${sy}" r="26" fill="none" stroke="#ffd97d" stroke-width="5" opacity="0.9"/>
        <circle cx="${sx}" cy="${sy}" r="14" fill="#ffe89c" opacity="${isNight ? 0.95 : 0.7}"/>
        <circle cx="${uwX}" cy="${uwY}" r="18" fill="none" stroke="#68e1fd" stroke-width="3" stroke-dasharray="6 5" opacity="0.7"/>
        <circle cx="${uwX}" cy="${uwY}" r="6" fill="#34cfc4" opacity="0.8"/>
        ${parkBadges}
        ${treeDots}
    </svg>`)

    const baseImg = sharp(buf, { raw: { width: M, height: M, channels: 4 } })
        .composite([{ input: overlaySvg, top: 0, left: 0 }])

    const name = isNight ? 'map-night' : 'map-day'
    await baseImg.clone().png({ compressionLevel: 9 }).toFile(stat('ui/map', `${name}.png`))
    await baseImg.clone().webp({ quality: 86 }).toFile(stat('ui/map', `${name}.webp`))
}

await renderMap(false)
await renderMap(true)

console.log(`Fase 5 aplicada com sucesso! Caixotes explosivos: ${cratePts.length}, Triangulos de circuito: ${rotatedRoadTris.length}`)
