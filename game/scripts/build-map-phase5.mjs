// Etapa 1 — Arquipelago Victor Neves (100% autoral):
// - Remove areas legadas (cookie, toilet, bowling, behindTheScene) e pista antiga
// - Cria geografia em 3 peninsulas com canais reais, 2 pontes, Píer Sudoeste de madeira
//   e estradas organicas em curvas Catmull-Rom (zero asterisco reto no Leste)
// - Gera terrain.png + terrain.glb 100% sincronizados, distribui props sem flutuacao/colisao
//   e renderiza minimapa diorama sombreado (map-day / map-night 1024x1024).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
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
const smax = (a, b, k = 6) => -smin(-a, -b, k)

// Ruido geologico deterministico 2D (FBM suave para baías + Ridged angular para promontorios rochosos)
const hash2 = (ix, iz) =>
{
    let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263)
    n = (n ^ (n >>> 13)) >>> 0
    n = Math.imul(n, 1274126177) >>> 0
    return (n ^ (n >>> 16)) >>> 0
}
const GRADS_2D = [
    [ 1, 0 ], [ -1, 0 ], [ 0, 1 ], [ 0, -1 ],
    [ 0.7071, 0.7071 ], [ -0.7071, 0.7071 ], [ 0.7071, -0.7071 ], [ -0.7071, -0.7071 ]
]
const grad2 = (ix, iz, fx, fz) =>
{
    const g = GRADS_2D[hash2(ix, iz) & 7]
    return g[0] * fx + g[1] * fz
}
const noise2D = (x, z) =>
{
    const ix = Math.floor(x)
    const iz = Math.floor(z)
    const fx = x - ix
    const fz = z - iz
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
    const n00 = grad2(ix,     iz,     fx,     fz)
    const n10 = grad2(ix + 1, iz,     fx - 1, fz)
    const n01 = grad2(ix,     iz + 1, fx,     fz - 1)
    const n11 = grad2(ix + 1, iz + 1, fx - 1, fz - 1)
    const nx0 = n00 + (n10 - n00) * u
    const nx1 = n01 + (n11 - n01) * u
    return nx0 + (nx1 - nx0) * v
}
const fbm2D = (x, z, octaves = 3) =>
{
    let sum = 0
    let amp = 0.55
    let freq = 1
    let norm = 0
    for(let i = 0; i < octaves; i++)
    {
        sum += noise2D(x * freq, z * freq) * amp
        norm += amp
        freq *= 2.07
        amp *= 0.48
    }
    return sum / norm
}
const ridged2D = (x, z, octaves = 2) =>
{
    let sum = 0
    let amp = 0.62
    let freq = 1
    let norm = 0
    for(let i = 0; i < octaves; i++)
    {
        const r = (1 - Math.abs(noise2D(x * freq, z * freq))) * 2 - 1
        sum += r * amp
        norm += amp
        freq *= 2.15
        amp *= 0.45
    }
    return sum / norm
}
const sdOrientedEllipse = (wx, wz, cx, cz, rx, rz, ang) =>
{
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const dx = wx - cx
    const dz = wz - cz
    const u = dx * c + dz * s
    const v = -dx * s + dz * c
    const k0 = Math.hypot(u / rx, v / rz)
    if(k0 < 1e-6) return -Math.min(rx, rz)
    const k1 = Math.hypot(u / (rx * rx), v / (rz * rz))
    return k0 * (k0 - 1) / Math.max(k1, 1e-6)
}
const distToPolyline = (px, pz, segs) =>
{
    let bestD = 999
    let bestT = 0
    const n = segs.length
    for(let i = 0; i < n; i++)
    {
        const [ ax, az, bx, bz ] = segs[i]
        const dx = bx - ax
        const dz = bz - az
        const l2 = dx * dx + dz * dz
        const u = l2 === 0 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1)
        const d = Math.hypot(px - (ax + u * dx), pz - (az + u * dz))
        if(d < bestD)
        {
            bestD = d
            bestT = (i + u) / n
        }
    }
    return { dist: bestD, t: bestT }
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

// Curva Catmull-Rom 2D suavizada convertida em micro-segmentos
const sampleSpline = (pts, closed = false, stepsPerSeg = 10) =>
{
    const v = pts.map(([ x, z ]) => new THREE.Vector2(x, z))
    const n = v.length
    const getPt = (i) =>
    {
        if(closed)
            return v[((i % n) + n) % n]
        return v[clamp(i, 0, n - 1)]
    }
    const segs = []
    const count = closed ? n : n - 1
    for(let i = 0; i < count; i++)
    {
        const p0 = getPt(i - 1)
        const p1 = getPt(i)
        const p2 = getPt(i + 1)
        const p3 = getPt(i + 2)
        let prev = p1
        for(let s = 1; s <= stepsPerSeg; s++)
        {
            const t = s / stepsPerSeg
            const t2 = t * t
            const t3 = t2 * t
            const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
            const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
            const cur = new THREE.Vector2(x, y)
            segs.push([ prev.x, prev.y, cur.x, cur.y ])
            prev = cur
        }
    }
    return segs
}

// ============================================================================
// 1. Coordenadas Autorais do Arquipelago (9 areas principais + 5 arenas Leste)
// ============================================================================
const AREA_TARGETS = {
    landing:      { x: -46, z:   8 },
    career:       { x: -46, z: -24 },
    projects:     { x: -72, z: -16 },
    lab:          { x: -68, z: -48 },
    social:       { x: -44, z: -64 },
    altar:        { x: -12, z: -68 },
    achievements: { x:  14, z: -62 },
    timeMachine:  { x:  54, z: -48 },
    circuit:      { x:  36, z:  10 },
}

const RESPAWN_TARGETS = {
    respawnLanding:      { x: -55.7, y: 0.5,  z:   7.3, yaw: -0.05 },
    respawnControls:     { x: -46.0, y: 0.5,  z:   4.0, yaw: 0 },
    respawnBonfire:      { x: -40.2, y: 0.5,  z:  13.5, yaw: -2.2 },
    respawnCareer:       { x: -45.6, y: 0.5,  z: -13.5, yaw: Math.PI * 0.5 },
    respawnSocial:       { x: -47.2, y: 0.5,  z: -56.6, yaw: 0.55 },
    respawnOnlyFans:     { x: -36.0, y: 0.5,  z: -70.0, yaw: 1.05 },
    respawnProjects:     { x: -72.0, y: 1.11, z: -11.8, yaw: 1.16 },
    respawnLab:          { x: -63.3, y: 0.5,  z: -46.9, yaw: 2.75 },
    respawnAltar:        { x: -12.0, y: 0.5,  z: -56.0, yaw: Math.PI * 0.5 },
    respawnAchievements: { x:  13.4, y: 0.61, z: -51.6, yaw: 1.70 },
    respawnTimeMachine:  { x:  52.0, y: 0.5,  z: -45.3, yaw: 0.87 },
    respawnBridge:       { x:  -2.0, y: 0.5,  z:   8.0, yaw: Math.PI * 0.5 },
    respawnCircuit:      { x:   9.5, y: 0.5,  z:   8.0, yaw: 0 },
    respawnTest:         { x: -44.0, y: 2.25, z: -50.0, yaw: 0 },
}

const PARK_ARENAS = [
    { x: 24, z: -16 },
    { x: 54, z: -10 },
    { x: 56, z:  22 },
    { x: 28, z:  38 },
    { x: 16, z:  12 },
]

const REMOVED_AREAS = new Set([ 'cookie', 'toilet', 'bowling', 'behindTheScene' ])
const REMOVED_RESPAWNS = new Set([ 'respawnCookie', 'respawnToilet', 'respawnBowling', 'respawnBehindTheScene' ])

// ============================================================================
// 1B. Estradas Organicas + SDF Costeira Realista (Baías Curvas + Promontórios Angulados)
// ============================================================================
const ROAD_SEGMENTS = [
    // Anel organico Campus Oeste
    ...sampleSpline([
        [-46,  8], [-46, -8], [-46, -24], [-44, -44], [-44, -64],
        [-58, -60], [-68, -48], [-74, -32], [-72, -16], [-64, 0]
    ], true, 8),
    // Ramal Norte atraves da Ponte 1 ate o Santuario & Cachoeira
    ...sampleSpline([[-44, -36], [-26, -34], [-12, -38], [-12, -55], [-12, -66]], false, 8),
    ...sampleSpline([[-12, -55], [2, -58], [14, -62]], false, 8),
    // Travessia central pela Ponte 2 ligando Oeste ao Leste
    ...sampleSpline([[-46, 8], [-28, 12], [-12, 8], [8, 8], [16, 12]], false, 8),
    // Loop costeiro organico do Parque das Paixoes no Leste (sem asterisco reto!)
    ...sampleSpline([
        [16, 12], [18, -4], [24, -16], [40, -18], [54, -10],
        [60, 6], [56, 22], [44, 34], [28, 38], [16, 26]
    ], true, 8),
    // Trilha costeira ate a ilha TimeMachine NE
    ...sampleSpline([[54, -10], [58, -28], [54, -48]], false, 8),
    // Acesso ao Píer Sudoeste na praia
    ...sampleSpline([[-46, 8], [-50, 22], [-56, 36], [-58, 42]], false, 8),
]

// Formas terrestres assimetricas (elipses rotacionadas em 3 peninsulas + istmo NE)
const LAND_SHAPES = [
    // Peninsula 1: Campus Oeste + Praia Sudoeste + cabeceiras de pontes
    [ -48,   8, 23, 19, -0.22 ], // Landing core
    [ -46, -24, 21, 18,  0.18 ], // Career core
    [ -46, -58, 22, 16, -0.35 ], // Social north cape
    [ -71, -16, 19, 14,  0.45 ], // Projects angled west promontory
    [ -68, -46, 19, 15, -0.42 ], // Lab NW angled headland
    [ -53,  31, 19, 14,  0.55 ], // SW Pier beach spit rumo a (-58, 42)
    [ -27, -30, 17, 13,  0.25 ], // West inner headland
    [ -12,   8, 12,  9.5,  0.08 ], // Cabeceira Oeste Ponte Central (-2, 8)
    [ -14, -36,  8.5, 9.5,  0.00 ], // Cabeceira Sul Ponte Norte (-12, -45)
    // Peninsula 2: Monte do Santuario & Cachoeira Norte
    [ -12, -65, 19, 14, -0.18 ], // Sanctuary highland
    [  14, -61, 17, 13,  0.42 ], // Achievements angled NE promontory
    [ -12, -53, 10,  8.5,  0.05 ], // Cabeceira Norte Ponte Norte
    // Peninsula 3: Parque das Paixoes Leste + Istmo & Promontorio TimeMachine NE
    [   8,   8, 12,  9.5, -0.08 ], // Cabeceira Leste Ponte Central (-2, 8)
    [  19,  10, 17, 15,  0.12 ], // Iron Arena west terrace
    [  25, -16, 20, 15, -0.32 ], // Fazenda Horizonte north cape
    [  53, -10, 22, 17,  0.38 ], // Hub Tech angled east cape
    [  55,  22, 22, 16, -0.40 ], // Praca Negocios SE promontory
    [  29,  36, 21, 15,  0.22 ], // Orla da Harmonia sweeping southern cove
    [  39,  10, 24, 21,  0.15 ], // Parque Leste central
    [  55, -49, 17, 12, -0.38 ], // TimeMachine NE faceted cape
    [  57, -28, 11, 15,  0.18 ], // Istmo costeiro curvado ligando Tech -> TimeMachine
]

// Canais continuos sob as pontes reais (zero pocinhas isoladas)
const CENTRAL_STRAIT_SEGS = sampleSpline([
    [-2, -38], [-2, -22], [-2, -8], [-2, 8], [-2, 22], [-6, 38], [-12, 62]
], false, 8)

const NORTH_STRAIT_SEGS = sampleSpline([
    [-30, -45], [-20, -45], [-12, -45], [-3, -45], [10, -42], [25, -45], [34, -58], [41, -80]
], false, 8)

const OUTER_BAYS = [
    // Enseada Oceanica SW aberta diante do Pier (-70, 54) -> OceanPassage (-74.5, 58.5)
    [ -77,  62, 26, 22,  0.45, 9.0 ],
    // Enseada NW
    [ -84, -72, 18, 15, -0.30, 8.0 ],
    // Enseada Norte atras da Cachoeira
    [  10, -84, 16, 12,  0.10, 8.0 ],
]

const PAVED_CIRCLES = [
    [ -46,   8, 10.5 ], // Landing
    [ -46, -24,  7.5 ], // Career
    [ -72, -16,  6.5 ], // Projects
    [ -68, -48,  6.5 ], // Lab
    [ -44, -64,  8.5 ], // Social
    [ -12, -68,  8.5 ], // Santuario
    [  14, -62,  7.0 ], // Conquistas
    [  54, -48,  6.5 ], // TimeMachine
    // Distritos Leste
    [  24, -16,  8.0 ], // Agro
    [  54, -10,  8.0 ], // Tech
    [  56,  22,  8.0 ], // Negocios
    [  28,  38,  8.5 ], // Musica
    [  16,  12,  7.5 ], // Musculacao
]

const SAFE_PLAZA_POINTS = [ ...Object.values(AREA_TARGETS), ...PARK_ARENAS ]

const evalTerrain = (wx, wz) =>
{
    let dLand = 999
    for(const [ cx, cz, rx, rz, ang ] of LAND_SHAPES)
        dLand = smin(dLand, sdOrientedEllipse(wx, wz, cx, cz, rx, rz, ang), 9.5)

    // Canal Central & Lagoa sob Ponte 2 (-2, 8)
    {
        const { dist, t } = distToPolyline(wx, wz, CENTRAL_STRAIT_SEGS)
        // Larga na lagoa (~9m em z ~ -20), estreita suavemente para 3.7m sob Ponte 2 (t ~ 0.5), alarga na baia sul (~10.5m)
        const bridgePinch = Math.exp(-Math.pow((t - 0.50) / 0.14, 2))
        const lagoonBulge = Math.exp(-Math.pow((t - 0.24) / 0.14, 2))
        const southFlare  = smoothstep(0.58, 0.96, t)
        const halfW = 5.4 - 1.75 * bridgePinch + 3.8 * lagoonBulge + 5.0 * southFlare
        dLand = smax(dLand, halfW - dist, 4.5)
    }

    // Estreito Norte sob Ponte 1 (-12, -45) ligando oeste -> lagoa -> nordeste
    {
        const { dist, t } = distToPolyline(wx, wz, NORTH_STRAIT_SEGS)
        const bridgePinch = Math.exp(-Math.pow((t - 0.28) / 0.12, 2))
        const neFlare     = smoothstep(0.55, 0.95, t)
        const halfW = 5.6 - 2.0 * bridgePinch + 5.2 * neFlare
        dLand = smax(dLand, halfW - dist, 4.5)
    }

    // Grandes baías externas com transicao suave (zero cortes retos)
    for(const [ cx, cz, rx, rz, ang, k ] of OUTER_BAYS)
        dLand = smax(dLand, -sdOrientedEllipse(wx, wz, cx, cz, rx, rz, ang), k)

    // Borda oceanica organica (substitui o antigo corte quadrado Math.max(|wx|-86, |wz|-86))
    const outerWarp = fbm2D(wx * 0.024 + 4.2, wz * 0.024 - 2.1, 2) * 5.0
    const outerRim = Math.hypot(wx * 0.97, wz * 0.99) - (87.0 + outerWarp)
    dLand = smax(dLand, outerRim, 7.0)

    const frameRim = Math.pow(Math.pow(Math.abs(wx) / 91, 6) + Math.pow(Math.abs(wz) / 91, 6), 1 / 6) * 91 - 91
    dLand = smax(dLand, frameRim, 4.0)

    let dRoad = 999
    for(const [ ax, az, bx, bz ] of ROAD_SEGMENTS)
        dRoad = Math.min(dRoad, distToSegment(wx, wz, ax, az, bx, bz))

    const dBridge = Math.min(
        Math.hypot(wx + 12, wz + 45),
        Math.hypot(wx + 2, wz - 8),
        Math.hypot(wx + 58, wz - 42)
    )
    let dPlaza = 999
    for(const pt of SAFE_PLAZA_POINTS)
        dPlaza = Math.min(dPlaza, Math.hypot(wx - pt.x, wz - pt.z))

    const safeFactor = smoothstep(7.5, 14.0, dBridge)
        * smoothstep(3.8, 8.5, dRoad)
        * smoothstep(9.0, 14.0, dPlaza)

    // Domain warp geologico: baías curvas suaves + promontorios rochosos facetados/angulados
    const u = wx + fbm2D(wx * 0.026 + 1.7, wz * 0.026 - 3.9, 2) * 5.6
    const v = wz + fbm2D(wx * 0.026 - 6.1, wz * 0.026 + 2.4, 2) * 5.6

    // Praias arenosas largas em SW Pier e Orla da Harmonia; cabos rochosos angulados nas pontas expostas
    const rawHeadland = smoothstep(-0.18, 0.42, fbm2D(wx * 0.032 - 5.3, wz * 0.032 + 2.9, 2))
    const beachProtect = smoothstep(10.0, 22.0, Math.hypot(wx + 58, wz - 42))
        * smoothstep(12.0, 24.0, Math.hypot(wx - 28, wz - 38))
    const headlandMask = rawHeadland * beachProtect

    const curveNoise = fbm2D(u * 0.044, v * 0.044, 3) * 4.0
    const angularNoise = ridged2D(u * 0.062 + 7.1, v * 0.062 - 3.4, 2) * 3.8
    const coastDetail = (curveNoise * (1 - headlandMask * 0.48) + angularNoise * (0.38 + headlandMask * 0.78)) * safeFactor
    const dCoast = dLand + coastDetail

    const beachWidth = 8.8 - headlandMask * 4.2
    const b = smoothstep(0.0, beachWidth, dCoast)

    const roadMask = smoothstep(4.2, 2.2, dRoad) * (1 - smoothstep(0.02, 0.22, b))

    let paved = 0
    for(const [ px, pz, pr ] of PAVED_CIRCLES)
        paved = Math.max(paved, smoothstep(pr + 1.5, pr - 1.0, Math.hypot(wx - px, wz - pz)))
    const dryCore = smoothstep(-0.8, -3.4, dCoast)
    const g = dryCore * (1 - roadMask) * (1 - paved)

    return { r: roadMask, g, b, dCoast, dRoad, headlandMask }
}

// ============================================================================
// 2. Atualizar areas.glb (remover legados + reposicionar autorais + Santuario)
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

for(const n of [ ...areasScene.listChildren() ])
{
    if(/^cuboid\./.test(n.getName()) || REMOVED_AREAS.has(n.getName()))
        disposeNodeTree(n, null)
}

// Parque das Paixoes no Leste (36, 0, 10)
const circuitNode = areasScene.listChildren().find(n => n.getName() === 'circuit')
{
    for(const child of [ ...circuitNode.listChildren() ])
        disposeNodeTree(child, circuitNode)
    circuitNode.setTranslation([ 36, 0, 10 ])
    circuitNode.setRotation([ 0, 0, 0, 1 ])
    circuitNode.addChild(areasDoc.createNode('refZoneBounding.circuit').setTranslation([ 0, 3.27, 0 ]).setScale([ 54, 54, 54 ]))
    circuitNode.addChild(areasDoc.createNode('refZoneFrustum.circuit').setTranslation([ 0, 3.27, 0 ]).setScale([ 60, 60, 60 ]))
}

for(const [ name, target ] of Object.entries(AREA_TARGETS))
{
    if(name === 'circuit') continue
    const node = areasScene.listChildren().find(n => n.getName() === name)
    if(!node) throw new Error(`Area ausente: ${name}`)
    const t = node.getTranslation()
    node.setTranslation([ target.x, t[1], target.z ])
}

const buildCombineParts = (targetDoc, targetRoot, targetMat) =>
{
    return (parts) =>
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
        const buf = targetRoot.listBuffers()[0] ?? targetDoc.createBuffer()
        return targetDoc.createPrimitive()
            .setAttribute('POSITION', targetDoc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
            .setAttribute('NORMAL', targetDoc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buf))
            .setAttribute('TEXCOORD_0', targetDoc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buf))
            .setMaterial(targetMat)
    }
}

// Reconstruir Santuario Celestial dentro de `altar`
{
    const altarNode = areasScene.listChildren().find(n => n.getName() === 'altar')
    for(const c of [ ...altarNode.listChildren() ])
        disposeNodeTree(c, altarNode)

    const stoneUv = [ 54.5 / 128, 0.5 ]
    const ivoryUv = [ 93.5 / 128, 0.5 ]
    const goldUv  = [ 33.5 / 128, 0.5 ]
    const combineParts = buildCombineParts(areasDoc, areasRoot, paletteMat)

    const parts = []
    const addPart = (g, uv, tx = 0, ty = 0, tz = 0) =>
    {
        g.translate(tx, ty, tz)
        parts.push({ g, uv })
    }

    addPart(new THREE.CylinderGeometry(7.2, 7.8, 0.05, 16), stoneUv, 0, 0.025, 0)
    addPart(new THREE.CylinderGeometry(5.8, 6.2, 0.04, 16), ivoryUv, 0, 0.07, 0)
    addPart(new THREE.TorusGeometry(5.6, 0.07, 8, 32).rotateX(Math.PI * 0.5), goldUv, 0, 0.095, 0)

    const colAngles = [ 2.25, 2.85, 3.55, 4.30, 5.05, 5.65 ]
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
// 3. Atualizar scenery.glb (pontes nos canais reais + Píer Sudoeste de madeira)
// ============================================================================
const sceneryDoc = await io.read(bkp('scenery/scenery.glb'))
const sceneryRoot = sceneryDoc.getRoot()
const sceneryScene = sceneryRoot.listScenes()[0]
const sceneryPalette = sceneryRoot.listMaterials().find(m => m.getName() === 'palette')

const REMOVE_SCENERY_NODES = new Set([
    'refRoad', 'Cube.001', 'Cube.002', 'Cube.049', 'Cube.059', 'Cube.064', 'Cube.066',
    'Cube.067', 'Cube.071', 'Cube.072', 'Cube.074', 'Cube.075', 'Cube.076', 'Cube.078', 'Cube.079', 'Cube.157'
])

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
    if(REMOVE_SCENERY_NODES.has(name))
    {
        disposeSceneryNode(node)
    }
    else if(name === 'bridgePhysicalFixed')
    {
        // Ponte cruzando o Canal Norte ate o Santuario Celestial (-12, -45)
        node.setTranslation([ -12, -0.08, -45 ])
        node.setRotation(yawQuat(0))
    }
    else if(name === 'bridgePhysicalFixed.001')
    {
        // Ponte cruzando a Lagoa Central entre Campus Oeste e Parque das Paixoes (-2, 8)
        node.setTranslation([ -2, -0.08, 8 ])
        node.setRotation(yawQuat(Math.PI * 0.5))
    }
    else if(name === 'slabes')
    {
        node.setTranslation([ -60, -0.39, -6 ])
    }
    else if(name === 'basaltRocksPhysicalStatic')
        node.setTranslation([ -26, -0.58, -62 ])
    else if(name === 'basaltRocksPhysicalStatic.001')
        node.setTranslation([ -62, -0.68, -28 ])
    else if(name === 'basaltRocksPhysicalStatic.002')
        node.setTranslation([ -24, -0.48, 22 ])
    else if(name === 'basaltRocksPhysicalStatic.003')
        node.setTranslation([ 22, 0.45, -72 ])
    else if(name === 'basaltRocksPhysicalStatic.004')
        node.setTranslation([ 68, 0.35, -18 ])
}

// Construir Píer de Madeira Sudoeste ((-58,42) -> (-70,54)) + Rocha Costeira Basáltica nos Promontórios
const headlandRockCoords = []
{
    const woodMatUv  = [ 62.5 / 128, 0.5 ] // #9d6844 madeira quente
    const darkWoodUv = [ 58.5 / 128, 0.5 ] // #6e452a vigas/pilares
    const goldLampUv = [ 33.5 / 128, 0.5 ] // #e4a90c lanternas do píer
    const basaltUvA  = [ 54.5 / 128, 0.5 ] // pedra fria ardosia
    const basaltUvB  = [ 50.5 / 128, 0.5 ] // basalto escuro
    const combineScenery = buildCombineParts(sceneryDoc, sceneryRoot, sceneryPalette)

    const pierParts = []
    const addPier = (g, uv, tx = 0, ty = 0, tz = 0, rx = 0) =>
    {
        if(rx) g.rotateX(rx)
        g.translate(tx, ty, tz)
        pierParts.push({ g, uv })
    }

    // Longarinas estruturais longitudinais
    for(const px of [ -1.8, 0, 1.8 ])
        addPier(new THREE.BoxGeometry(0.28, 0.22, 17.6), darkWoodUv, px, -0.02, 0)

    // Pranchas transversais com leve folga de píer artesanal
    for(let i = 0; i < 24; i++)
    {
        const pz = -8.2 + i * (16.4 / 23)
        const py = i === 0 ? 0.04 : 0.14
        const prx = i === 0 ? -0.10 : 0
        addPier(new THREE.BoxGeometry(4.5, 0.12, 0.56), woodMatUv, 0, py, pz, prx)
    }

    // Pilares fincados no fundo do mar + postes de amarração e lanternas douradas na ponta
    for(let i = 0; i < 6; i++)
    {
        const pz = -7.5 + i * 3.1
        for(const px of [ -2.1, 2.1 ])
        {
            addPier(new THREE.CylinderGeometry(0.18, 0.22, 2.2, 8), darkWoodUv, px, -0.55, pz)
            if(i === 5 || i === 2)
                addPier(new THREE.BoxGeometry(0.28, 0.18, 0.28), goldLampUv, px, 0.62, pz)
        }
    }

    const pierMesh = sceneryDoc.createMesh('swPierMesh').addPrimitive(combineScenery(pierParts))
    const pierNode = sceneryDoc.createNode('swPierPhysicalFixed')
        .setMesh(pierMesh)
        .setTranslation([ -64, 0.14, 48 ])
        .setRotation(yawQuat(-Math.PI * 0.25))

    // Collider dirigivel do deck plano + pequena rampa de entrada na areia
    pierNode.addChild(
        sceneryDoc.createNode('cuboid.swPierDeck')
            .setTranslation([ 0, 0.02, 0.2 ])
            .setScale([ 4.6, 0.34, 17.6 ])
    )
    pierNode.addChild(
        sceneryDoc.createNode('cuboid.swPierRamp')
            .setTranslation([ 0, -0.10, -8.8 ])
            .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.16).toArray())
            .setScale([ 4.6, 0.24, 2.4 ])
    )
    sceneryScene.addChild(pierNode)

    // 7 afloramentos basalticos esculpidos nos cabos angulados externos
    const headlandSectors = [
        [ -92, -70, -28,  -4 ], // West Projects Cape
        [ -86, -60, -62, -36 ], // NW Lab Cape
        [ -28,   0, -84, -64 ], // North Sanctuary Cliff
        [   6,  32, -78, -52 ], // NE Achievements Cape
        [  48,  74, -66, -36 ], // TimeMachine NE Point
        [  58,  82, -24,   6 ], // East Tech Point
        [  56,  80,  14,  40 ], // SE Business Cape
    ]

    const rockParts = []
    const rockColliders = []
    const rngRock = seededRng(7717)

    for(let s = 0; s < headlandSectors.length; s++)
    {
        const [ xMin, xMax, zMin, zMax ] = headlandSectors[s]
        let best = null
        let bestScore = -1e9
        for(let wx = xMin; wx <= xMax; wx += 2)
        {
            for(let wz = zMin; wz <= zMax; wz += 2)
            {
                const { dCoast, dRoad, headlandMask } = evalTerrain(wx, wz)
                if(dCoast < -1.8 || dCoast > 1.2 || dRoad < 7.0) continue
                if(Math.hypot(wx + 12, wz + 45) < 12 || Math.hypot(wx + 2, wz - 8) < 12 || Math.hypot(wx + 58, wz - 42) < 14) continue
                let nearPlaza = false
                for(const pt of SAFE_PLAZA_POINTS)
                    if(Math.hypot(wx - pt.x, wz - pt.z) < 10.5) { nearPlaza = true; break }
                if(nearPlaza) continue

                const score = Math.hypot(wx, wz) * 0.25 + headlandMask * 14 - Math.abs(dCoast + 0.3) * 4
                if(score > bestScore)
                {
                    bestScore = score
                    best = { x: wx, z: wz }
                }
            }
        }
        if(!best) continue
        headlandRockCoords.push(best)

        const { x: rx, z: rz } = best
        const { b } = evalTerrain(rx, rz)
        const baseY = -1.5 * b - 0.15

        // Rocha principal facetada + 3 colunas basalticas anguladas ao redor
        const mainGeo = new THREE.DodecahedronGeometry(1.15, 0)
        mainGeo.scale(1.25, 0.72, 1.05)
        mainGeo.rotateY(rngRock() * Math.PI * 2)
        mainGeo.rotateZ((rngRock() - 0.5) * 0.32)
        mainGeo.translate(rx, baseY + 0.45, rz)
        rockParts.push({ g: mainGeo, uv: basaltUvA })

        for(let p = 0; p < 3; p++)
        {
            const a = (p / 3) * Math.PI * 2 + rngRock() * 0.6
            const dist = 0.95 + rngRock() * 0.65
            const h = 0.95 + rngRock() * 0.95
            const rad = 0.42 + rngRock() * 0.28
            const col = new THREE.CylinderGeometry(rad * 0.76, rad, h, 6)
            col.rotateX((rngRock() - 0.5) * 0.42)
            col.rotateZ((rngRock() - 0.5) * 0.42)
            col.translate(rx + Math.cos(a) * dist, baseY + h * 0.36, rz + Math.sin(a) * dist)
            rockParts.push({ g: col, uv: p % 2 === 0 ? basaltUvB : basaltUvA })
        }

        rockColliders.push([ rx, baseY + 0.55, rz, s ])
    }

    if(rockParts.length > 0)
    {
        const rocksMesh = sceneryDoc.createMesh('coastalHeadlandRocksMesh').addPrimitive(combineScenery(rockParts))
        const rocksNode = sceneryDoc.createNode('coastalHeadlandRocksPhysicalFixed').setMesh(rocksMesh)
        for(const [ cx, cy, cz, idx ] of rockColliders)
        {
            rocksNode.addChild(
                sceneryDoc.createNode(`cuboid.headlandRock${idx}`)
                    .setTranslation([ cx, cy, cz ])
                    .setScale([ 2.4, 1.4, 2.4 ])
            )
        }
        sceneryScene.addChild(rocksNode)
    }
}

await io.write(stat('scenery/scenery.glb'), sceneryDoc)

// ============================================================================
// 4. Atualizar respawnsReferences.glb (remover obsoletos, reposicionar validos)
// ============================================================================
const respDoc = await io.read(bkp('respawns/respawnsReferences.glb'))
const respScene = respDoc.getRoot().listScenes()[0]
for(const node of [ ...respScene.listChildren() ])
{
    const name = node.getName()
    if(REMOVED_RESPAWNS.has(name))
    {
        respScene.removeChild(node)
        node.dispose()
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
// 5. Gerar terrain.png (512x512 RGBA) + terrain.glb (129x129) sincronizados
// ============================================================================

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

// Gerar terrain.glb (129x129)
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
// 6. Distribuicao Poisson-Disc dos Props & Vegetacao (zero flutuacao / sobreposicao)
// ============================================================================
const isDryClearSpot = (wx, wz, minRoadDist = 4.8) =>
{
    if(Math.abs(wx) > 86 || Math.abs(wz) > 86) return false
    const { b, dCoast, dRoad } = evalTerrain(wx, wz)
    if(dCoast > -1.8 || b > 0.005 || dRoad < minRoadDist) return false
    // Manter longe das pontes (-12, -45) e (-2, 8) e do píer (-64, 48)
    if(Math.hypot(wx + 12, wz + 45) < 8) return false
    if(Math.hypot(wx + 2, wz - 8) < 8) return false
    if(Math.hypot(wx + 60, wz - 44) < 9.5) return false

    for(const rock of headlandRockCoords)
    {
        if(Math.hypot(wx - rock.x, wz - rock.z) < 5.5)
            return false
    }
    for(const target of [ ...Object.values(AREA_TARGETS), ...PARK_ARENAS ])
    {
        if(Math.hypot(wx - target.x, wz - target.z) < 11.2)
            return false
    }
    for(const r of Object.values(RESPAWN_TARGETS))
    {
        if(Math.hypot(wx - r.x, wz - r.z) < 5.2)
            return false
    }
    return true
}

const placedGlobalProps = []
const scatterPoints = (count, seed, minRoadDist = 4.8, minSelfDist = 4.5, trackGlobally = false) =>
{
    const rng = seededRng(seed)
    const pts = []
    let tries = 0
    const maxTries = count * 220
    const globalClearDist = Math.min(minSelfDist * 0.55, 3.2)
    while(pts.length < count && tries < maxTries)
    {
        tries++
        const wx = (rng() * 2 - 1) * 84
        const wz = (rng() * 2 - 1) * 84
        const relaxed = tries > maxTries * 0.72
        if(!isDryClearSpot(wx, wz, relaxed ? Math.max(3.6, minRoadDist - 0.8) : minRoadDist))
            continue

        const selfLimit = relaxed ? minSelfDist * 0.65 : minSelfDist
        const globalLimit = relaxed ? globalClearDist * 0.7 : globalClearDist
        let tooClose = false
        for(const [ ox, oz ] of pts)
        {
            if(Math.hypot(wx - ox, wz - oz) < selfLimit) { tooClose = true; break }
        }
        if(!tooClose && trackGlobally)
        {
            for(const [ ox, oz ] of placedGlobalProps)
            {
                if(Math.hypot(wx - ox, wz - oz) < globalLimit) { tooClose = true; break }
            }
        }
        if(tooClose) continue

        const entry = [ wx, wz, rng() * Math.PI * 2 ]
        pts.push(entry)
        if(trackGlobally)
            placedGlobalProps.push([ wx, wz ])
    }
    if(pts.length === 0)
        throw new Error(`scatterPoints nao encontrou pontos validos (seed=${seed}, count=${count})`)
    return pts
}

const relocateRefGlb = async(rel, seed, minRoadDist = 5.0, minSelfDist = 4.5, preserveYaw = false, trackGlobally = false) =>
{
    const doc = await io.read(bkp(rel))
    const sc = doc.getRoot().listScenes()[0]
    const nodes = sc.listChildren()
    const pts = scatterPoints(nodes.length, seed, minRoadDist, minSelfDist, trackGlobally)
    for(let i = 0; i < nodes.length; i++)
    {
        const node = nodes[i]
        const [ wx, wz, yaw ] = pts[i % pts.length]
        node.setTranslation([ wx, 0, wz ]) // Aterrar tudo exatamente no solo (y = 0)
        if(preserveYaw)
            node.setRotation(yawQuat(yaw))
    }
    await io.write(stat(rel), doc)
    return pts
}

const birchPts  = await relocateRefGlb('birchTrees/birchTreesReferences.glb',   101, 5.4, 4.6, false, true)
const oakPts    = await relocateRefGlb('oakTrees/oakTreesReferences.glb',       202, 5.4, 4.6, false, true)
const cherryPts = await relocateRefGlb('cherryTrees/cherryTreesReferences.glb', 303, 5.4, 4.6, false, true)
await relocateRefGlb('bushes/bushesReferences.glb',   404, 4.8, 3.2, false, false)
await relocateRefGlb('flowers/flowersReferences.glb', 505, 4.2, 2.5, false, false)
await relocateRefGlb('fences/fences.glb',             606, 5.2, 6.0, true, true)
await relocateRefGlb('benches/benches.glb',           707, 5.0, 6.5, true, true)
await relocateRefGlb('bricks/bricks.glb',             808, 5.6, 7.0, false, true)
await relocateRefGlb('lanterns/lanterns.glb',         909, 4.6, 5.5, true, true)
await relocateRefGlb('poleLights/poleLights.glb',     1010, 4.5, 6.0, true, true)
const cratePts = await relocateRefGlb('explosiveCrates/explosiveCrates.glb', 1111, 5.5, 7.5, false, true)

// Brisa Celestial partindo sobre o Canal Norte (-14, -48)
{
    const doc = await io.read(bkp('tornado/tornadoPathReferences.glb'))
    const sc = doc.getRoot().listScenes()[0]
    const nodes = sc.listChildren().sort((a, b) => a.getName().localeCompare(b.getName()))
    for(let i = 0; i < nodes.length; i++)
    {
        const ang = (i / nodes.length) * Math.PI * 2
        const rad = 28 + Math.sin(ang * 3) * 8
        const wx = -24 + Math.cos(ang) * rad
        const wz = -22 + Math.sin(ang) * rad
        const t = nodes[i].getTranslation()
        nodes[i].setTranslation([ clamp(wx, -82, 82), t[1], clamp(wz, -82, 82) ])
    }
    await io.write(stat('tornado/tornadoPathReferences.glb'), doc)
}

// ============================================================================
// 7. Renderizar Minimapa Diorama Sombreado (map-day / map-night 1024x1024)
// ============================================================================
const renderMap = async(isNight) =>
{
    const M = 1024
    const buf = Buffer.alloc(M * M * 4)

    const hexToRgb = (h) => [ parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16) ]
    const mixRgb = (a, b, t) => [ a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t ]

    const cDeep   = hexToRgb(isNight ? '#0a1c3c' : '#0f3d6e')
    const cMidSea = hexToRgb(isNight ? '#15406b' : '#1b769c')
    const cShal   = hexToRgb(isNight ? '#215f87' : '#3bd8cc')
    const cSand   = hexToRgb(isNight ? '#827154' : '#f5d794')
    const cSlate  = hexToRgb(isNight ? '#3b4963' : '#94a3b8')
    const cGrass  = hexToRgb(isNight ? '#2a5d34' : '#71c244')
    const cRoad   = hexToRgb(isNight ? '#686462' : '#ecd6b0')
    const cRoadHi = hexToRgb(isNight ? '#7c7672' : '#f7e7c8')
    const cFoam   = hexToRgb(isNight ? '#7dd4f0' : '#effcff')

    // Amostrar grade de altitude costeira para micro-relevo direcional (luz NW -> SE)
    const gridB = new Float32Array(M * M)
    const gridR = new Float32Array(M * M)
    const gridG = new Float32Array(M * M)
    const gridH = new Float32Array(M * M)
    for(let py = 0; py < M; py++)
    {
        const wz = (py / (M - 1) - 0.5) * 192
        for(let px = 0; px < M; px++)
        {
            const wx = (px / (M - 1) - 0.5) * 192
            const { r, g, b, headlandMask } = evalTerrain(wx, wz)
            const idx = py * M + px
            gridB[idx] = b
            gridR[idx] = r
            gridG[idx] = g
            gridH[idx] = headlandMask
        }
    }

    for(let py = 0; py < M; py++)
    {
        const wz = (py / (M - 1) - 0.5) * 192
        const pyUp = Math.max(0, py - 2)
        for(let px = 0; px < M; px++)
        {
            const wx = (px / (M - 1) - 0.5) * 192
            const pxLt = Math.max(0, px - 2)
            const idx = py * M + px
            const b = gridB[idx]
            const r = gridR[idx]
            const g = gridG[idx]
            const h = gridH[idx]

            // Praia dourada nas enseadas suaves + borda basaltica ardosia nos promontorios angulados
            const shoreCol = h > 0.35
                ? mixRgb(cSand, cSlate, clamp((h - 0.35) / 0.65, 0, 1) * 0.72)
                : cSand

            // Gradiente oceanico em 3 faixas
            let col = b > 0.50
                ? mixRgb(cMidSea, cDeep, clamp((b - 0.50) / 0.50, 0, 1))
                : (b > 0.16
                    ? mixRgb(cShal, cMidSea, clamp((b - 0.16) / 0.34, 0, 1))
                    : mixRgb(shoreCol, cShal, clamp(b / 0.16, 0, 1)))

            // Contornos suaves de profundidade & espuma costeira
            if(b > 0.08 && b < 0.14)
                col = mixRgb(col, cFoam, 0.58)
            else if(b > 0.24 && b < 0.28)
                col = mixRgb(col, cFoam, 0.24)
            else if(b > 0.44 && b < 0.465)
                col = mixRgb(col, cShal, 0.18)

            // Grama com micro-ondulacao sutil + estrada com borda suavizada
            const grassTone = Math.sin(wx * 0.18) * Math.cos(wz * 0.18) * 0.06
            const gCol = [ clamp(cGrass[0] * (1 + grassTone), 0, 255), clamp(cGrass[1] * (1 + grassTone), 0, 255), clamp(cGrass[2] * (1 + grassTone), 0, 255) ]
            col = mixRgb(col, gCol, g)
            col = mixRgb(col, mixRgb(cRoad, cRoadHi, clamp(1 - r, 0, 1)), r)

            // Relevo direcional diorama ao redor de bordas costeiras e desnivel
            const slope = (gridB[pyUp * M + pxLt] - b) * 110
            const shade = clamp(slope, -18, 16)
            col[0] = clamp(col[0] + shade, 0, 255)
            col[1] = clamp(col[1] + shade, 0, 255)
            col[2] = clamp(col[2] + shade, 0, 255)

            const o = idx * 4
            buf[o + 0] = Math.round(col[0])
            buf[o + 1] = Math.round(col[1])
            buf[o + 2] = Math.round(col[2])
            buf[o + 3] = 255
        }
    }

    // Overlays vetoriais diorama: pontes reais, píer SW, biomas e copas das arvores com sombra
    const toPx = (wx, wz) => [ ((wx / 192) + 0.5) * M, ((wz / 192) + 0.5) * M ]
    const [ sx, sy ]     = toPx(-12, -68)
    const [ bx1, by1 ]   = toPx(-12, -45)
    const [ bx2, by2 ]   = toPx(-2, 8)
    const [ uwX, uwY ]   = toPx(-74.5, 58.5)
    const [ pierX, pierY ] = toPx(-64, 48)
    const [ landX, landY ] = toPx(-46, 8)
    const [ agroX, agroY ] = toPx(24, -16)
    const [ techX, techY ] = toPx(54, -10)
    const [ bizX, bizY ]   = toPx(56, 22)
    const [ musX, musY ]   = toPx(28, 38)
    const [ gymX, gymY ]   = toPx(16, 12)

    const treeDots = [
        ...birchPts.map(([x, z]) => ({ x, z, c: isNight ? '#1f6e45' : '#2fa866', r: 8.5 })),
        ...oakPts.map(([x, z]) =>   ({ x, z, c: isNight ? '#9a7814' : '#f2b705', r: 7.5 })),
        ...cherryPts.map(([x, z]) =>({ x, z, c: isNight ? '#a6435e' : '#ff6f91', r: 7.5 })),
    ].map(({ x, z, c, r }) =>
    {
        const [ px, py ] = toPx(x, z)
        return `<circle cx="${(px + 2.5).toFixed(1)}" cy="${(py + 3.5).toFixed(1)}" r="${r}" fill="#082442" opacity="0.28"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" fill="${c}"/>`
    }).join('')

    const overlaySvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${M}" height="${M}" viewBox="0 0 ${M} ${M}">
        <!-- Lotes tematicos suaves dos distritos -->
        <circle cx="${agroX}" cy="${agroY}" r="36" fill="${isNight ? '#3e4a22' : '#dfb956'}" opacity="0.45"/>
        <circle cx="${techX}" cy="${techY}" r="34" fill="${isNight ? '#193550' : '#38bdf8'}" opacity="0.28"/>
        <circle cx="${bizX}"  cy="${bizY}"  r="34" fill="${isNight ? '#44361d' : '#eab308'}" opacity="0.30"/>
        <rect x="${musX - 30}" y="${musY - 22}" width="60" height="44" rx="10" fill="${isNight ? '#4d3221' : '#c67c3b'}" opacity="0.55"/>
        <rect x="${gymX - 28}" y="${gymY - 22}" width="56" height="44" rx="8" fill="${isNight ? '#2c303a' : '#475569'}" opacity="0.45"/>

        <!-- Praca inicial & Santuario Celestial -->
        <circle cx="${landX}" cy="${landY}" r="26" fill="${isNight ? '#3d4c68' : '#f7e5c2'}" opacity="0.72"/>
        <circle cx="${sx}" cy="${sy}" r="28" fill="none" stroke="#ffd97d" stroke-width="5" opacity="0.9"/>
        <circle cx="${sx}" cy="${sy}" r="14" fill="#ffe89c" opacity="${isNight ? 0.95 : 0.72}"/>

        <!-- Pontes sobre os canais reais -->
        <rect x="${bx1 - 14}" y="${by1 - 24}" width="28" height="48" rx="4" fill="#c7834c" stroke="#5e3a1e" stroke-width="3"/>
        <g transform="translate(${bx2} ${by2}) rotate(90)">
            <rect x="-14" y="-24" width="28" height="48" rx="4" fill="#c7834c" stroke="#5e3a1e" stroke-width="3"/>
        </g>

        <!-- Píer Sudoeste de madeira rumo a Passagem Oceanica -->
        <g transform="translate(${pierX} ${pierY}) rotate(45)">
            <rect x="-13" y="-48" width="26" height="96" rx="3" fill="#b87644" stroke="#5e3a1e" stroke-width="3"/>
        </g>
        <circle cx="${uwX}" cy="${uwY}" r="20" fill="none" stroke="#68e1fd" stroke-width="3.5" stroke-dasharray="6 5" opacity="0.85"/>
        <circle cx="${uwX}" cy="${uwY}" r="7" fill="#34cfc4" opacity="0.9"/>

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

// Verificacao automatica de travessias, cabeceiras, píer e areas
const diagChecks = [
    [ 'Canal Ponte Norte (-12,-45)', evalTerrain(-12, -45).b, (v) => v > 0.25 ],
    [ 'Canal Ponte Central (-2,8)',  evalTerrain(-2, 8).b,   (v) => v > 0.25 ],
    [ 'Cabeceira Norte S (-12,-38)', evalTerrain(-12, -38).b,(v) => v < 0.05 ],
    [ 'Cabeceira Norte N (-12,-52)', evalTerrain(-12, -52).b,(v) => v < 0.05 ],
    [ 'Cabeceira Central O (-9,8)',  evalTerrain(-9, 8).b,   (v) => v < 0.05 ],
    [ 'Cabeceira Central L (5,8)',   evalTerrain(5, 8).b,    (v) => v < 0.05 ],
    [ 'Entrada Pier SW (-58,42)',    evalTerrain(-58, 42).b, (v) => v < 0.05 ],
    [ 'Ponta Pier SW (-70,54)',      evalTerrain(-70, 54).b, (v) => v > 0.45 ],
    [ 'Passagem Submarina (-74.5,58.5)', evalTerrain(-74.5, 58.5).b, (v) => v > 0.65 ],
]
for(const [ name, target ] of [ ...Object.entries(AREA_TARGETS), ...PARK_ARENAS.map((p, i) => [ `parkArena${i}`, p ]) ])
    diagChecks.push([ `Area ${name}`, evalTerrain(target.x, target.z).b, (v) => v < 0.05 ])
for(const [ name, target ] of Object.entries(RESPAWN_TARGETS))
{
    if(name === 'respawnBridge') continue
    diagChecks.push([ `Respawn ${name}`, evalTerrain(target.x, target.z).b, (v) => v < 0.05 ])
}

const failedDiag = diagChecks.filter(([ , v, pred ]) => !pred(v))
console.log(`Coastline diag: ${diagChecks.length - failedDiag.length}/${diagChecks.length} checks PASS, afloramentos basalticos: ${headlandRockCoords.length}/7`)
if(failedDiag.length > 0)
{
    for(const [ label, val ] of failedDiag)
        console.error(`FAIL ${label}: b=${val.toFixed(4)}`)
    process.exitCode = 1
}

console.log(`Etapa 1+Costa Arquipelago concluida! Caixotes: ${cratePts.length}, Arvores: ${birchPts.length + oakPts.length + cherryPts.length}, Estradas: ${ROAD_SEGMENTS.length} segs`)
