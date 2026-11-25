// Atualiza game/static/areas/areas.glb para a Fase 4 (T4.1 + T4.2):
// - T4.1: substitui as 10 letras legadas de landing por VICTOR NEVES (11 letras fisicas)
// - T4.2: remove os 6 nos legados de social e substitui refStatuePhysicalDynamic por totem geometrico
import { statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const areasPath = resolve(root, 'static/areas/areas.glb')

const TAU = Math.PI * 2
const TARGET_LETTER_HEIGHT = 1.45
const TARGET_LETTER_DEPTH = 0.46
const IVORY_UV = [ 0.7356, 0.5 ] // swatch #fff2e8 usado nas letras originais (x ~ 94)

const makeLetterShapes = () =>
{
    const shapes = {}

    // V
    {
        const s = new THREE.Shape()
        s.moveTo(0.0, 1.0)
        s.lineTo(0.24, 1.0)
        s.lineTo(0.45, 0.34)
        s.lineTo(0.66, 1.0)
        s.lineTo(0.90, 1.0)
        s.lineTo(0.58, 0.0)
        s.lineTo(0.32, 0.0)
        s.closePath()
        shapes.V = s
    }

    // I
    {
        const s = new THREE.Shape()
        s.moveTo(0.0, 0.0)
        s.lineTo(0.26, 0.0)
        s.lineTo(0.26, 1.0)
        s.lineTo(0.0, 1.0)
        s.closePath()
        shapes.I = s
    }

    // C
    {
        const s = new THREE.Shape()
        const cx = 0.48
        const cy = 0.5
        const R = 0.5
        const r = 0.27
        const a1 = 0.24 * Math.PI
        const a2 = 1.76 * Math.PI
        s.moveTo(cx + R * Math.cos(a1), cy + R * Math.sin(a1))
        s.absarc(cx, cy, R, a1, a2, false)
        s.lineTo(cx + r * Math.cos(a2), cy + r * Math.sin(a2))
        s.absarc(cx, cy, r, a2, a1, true)
        s.closePath()
        shapes.C = s
    }

    // T
    {
        const s = new THREE.Shape()
        s.moveTo(0.30, 0.0)
        s.lineTo(0.54, 0.0)
        s.lineTo(0.54, 0.77)
        s.lineTo(0.84, 0.77)
        s.lineTo(0.84, 1.0)
        s.lineTo(0.0, 1.0)
        s.lineTo(0.0, 0.77)
        s.lineTo(0.30, 0.77)
        s.closePath()
        shapes.T = s
    }

    // O
    {
        const s = new THREE.Shape()
        s.moveTo(1.0, 0.5)
        s.absarc(0.5, 0.5, 0.5, 0, TAU, false)
        const hole = new THREE.Path()
        hole.moveTo(0.76, 0.5)
        hole.absarc(0.5, 0.5, 0.26, 0, TAU, true)
        s.holes.push(hole)
        shapes.O = s
    }

    // R
    {
        const s = new THREE.Shape()
        const aStart = -0.30 * Math.PI
        const aEnd = 0.50 * Math.PI
        const cx = 0.46
        const cy = 0.71
        const R = 0.29
        s.moveTo(0.0, 0.0)
        s.lineTo(0.24, 0.0)
        s.lineTo(0.24, 0.42)
        s.lineTo(0.40, 0.42)
        s.lineTo(0.62, 0.0)
        s.lineTo(0.88, 0.0)
        s.lineTo(cx + R * Math.cos(aStart), cy + R * Math.sin(aStart))
        s.absarc(cx, cy, R, aStart, aEnd, false)
        s.lineTo(0.0, 1.0)
        s.closePath()

        const hole = new THREE.Path()
        const hr = 0.11
        hole.moveTo(0.24, 0.60)
        hole.lineTo(0.24, 0.82)
        hole.lineTo(0.46, 0.82)
        hole.absarc(0.46, 0.71, hr, 0.5 * Math.PI, -0.5 * Math.PI, true)
        hole.lineTo(0.24, 0.60)
        hole.closePath()
        s.holes.push(hole)
        shapes.R = s
    }

    // N
    {
        const s = new THREE.Shape()
        s.moveTo(0.0, 0.0)
        s.lineTo(0.23, 0.0)
        s.lineTo(0.23, 0.58)
        s.lineTo(0.62, 0.0)
        s.lineTo(0.85, 0.0)
        s.lineTo(0.85, 1.0)
        s.lineTo(0.62, 1.0)
        s.lineTo(0.62, 0.42)
        s.lineTo(0.23, 1.0)
        s.lineTo(0.0, 1.0)
        s.closePath()
        shapes.N = s
    }

    // E
    {
        const s = new THREE.Shape()
        s.moveTo(0.0, 0.0)
        s.lineTo(0.74, 0.0)
        s.lineTo(0.74, 0.21)
        s.lineTo(0.24, 0.21)
        s.lineTo(0.24, 0.40)
        s.lineTo(0.64, 0.40)
        s.lineTo(0.64, 0.60)
        s.lineTo(0.24, 0.60)
        s.lineTo(0.24, 0.79)
        s.lineTo(0.74, 0.79)
        s.lineTo(0.74, 1.0)
        s.lineTo(0.0, 1.0)
        s.closePath()
        shapes.E = s
    }

    // S
    {
        const s = new THREE.Shape()
        s.moveTo(0.14, 0.0)
        s.lineTo(0.64, 0.0)
        s.lineTo(0.76, 0.12)
        s.lineTo(0.76, 0.47)
        s.lineTo(0.64, 0.59)
        s.lineTo(0.23, 0.62)
        s.lineTo(0.23, 0.81)
        s.lineTo(0.64, 0.81)
        s.lineTo(0.74, 0.90)
        s.lineTo(0.64, 1.0)
        s.lineTo(0.14, 1.0)
        s.lineTo(0.02, 0.88)
        s.lineTo(0.02, 0.53)
        s.lineTo(0.12, 0.41)
        s.lineTo(0.53, 0.38)
        s.lineTo(0.53, 0.19)
        s.lineTo(0.14, 0.19)
        s.lineTo(0.04, 0.10)
        s.closePath()
        shapes.S = s
    }

    return shapes
}

const buildLetterGeometry = (shape) =>
{
    const geom = new THREE.ExtrudeGeometry(shape, {
        depth: 0.28,
        bevelEnabled: true,
        bevelThickness: 0.04,
        bevelSize: 0.035,
        bevelSegments: 2,
        curveSegments: 16
    })
    geom.computeBoundingBox()
    const size = new THREE.Vector3()
    geom.boundingBox.getSize(size)

    const scaleXY = TARGET_LETTER_HEIGHT / size.y
    const scaleZ = TARGET_LETTER_DEPTH / size.z
    geom.scale(scaleXY, scaleXY, scaleZ)
    geom.center()
    geom.computeBoundingBox()
    geom.computeVertexNormals()

    const width = geom.boundingBox.max.x - geom.boundingBox.min.x
    const height = geom.boundingBox.max.y - geom.boundingBox.min.y
    const depth = geom.boundingBox.max.z - geom.boundingBox.min.z

    return { geometry: geom, width, height, depth }
}

const geometriesToGltfPrimitive = (doc, material, parts) =>
{
    let totalVertices = 0
    const normalizedParts = parts.map(({ geometry, uv }) =>
    {
        const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
        g.computeVertexNormals()
        const pos = g.getAttribute('position')
        totalVertices += pos.count
        return { g, uv }
    })

    const positions = new Float32Array(totalVertices * 3)
    const normals = new Float32Array(totalVertices * 3)
    const uvs = new Float32Array(totalVertices * 2)

    let offset = 0
    for(const { g, uv } of normalizedParts)
    {
        const pos = g.getAttribute('position')
        const norm = g.getAttribute('normal')
        for(let i = 0; i < pos.count; i++)
        {
            const idx = offset + i
            positions[ idx * 3 + 0 ] = pos.getX(i)
            positions[ idx * 3 + 1 ] = pos.getY(i)
            positions[ idx * 3 + 2 ] = pos.getZ(i)
            normals[ idx * 3 + 0 ] = norm.getX(i)
            normals[ idx * 3 + 1 ] = norm.getY(i)
            normals[ idx * 3 + 2 ] = norm.getZ(i)
            uvs[ idx * 2 + 0 ] = uv[ 0 ]
            uvs[ idx * 2 + 1 ] = uv[ 1 ]
        }
        offset += pos.count
        g.dispose()
    }

    const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
    const posAccessor = doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer)
    const normAccessor = doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer)
    const uvAccessor = doc.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer)

    return doc.createPrimitive()
        .setAttribute('POSITION', posAccessor)
        .setAttribute('NORMAL', normAccessor)
        .setAttribute('TEXCOORD_0', uvAccessor)
        .setMaterial(material)
}

const buildGeometricTotemParts = () =>
{
    // Totem geometrico estilizavel no espaco local de refStatuePhysicalDynamic (y ~ -2.496 .. +1.90)
    // Swatches verificados em static/palette.png (row 2, 128x4):
    const stoneUv = [ 54.5 / 128, 0.5 ] // #a49876 pedra
    const goldUv = [ 74.5 / 128, 0.5 ]  // #f8a658 dourado solar
    const coralUv = [ 66.5 / 128, 0.5 ] // #ed3f1c coral-vermelho
    const ivoryUv = [ 94.5 / 128, 0.5 ] // #fff2e8 marfim

    const parts = []

    const addPart = (geometry, yCenter, rotY, uv) =>
    {
        if(rotY)
            geometry.rotateY(rotY)
        geometry.translate(0, yCenter, 0)
        parts.push({ geometry, uv })
    }

    // 1. Plinto inferior e degrau de pedra
    addPart(new THREE.CylinderGeometry(0.78, 0.88, 0.44, 8), -2.28, Math.PI / 8, stoneUv)
    addPart(new THREE.CylinderGeometry(0.62, 0.74, 0.42, 8), -1.85, Math.PI / 8, stoneUv)

    // 2. Anel dourado da base
    addPart(new THREE.CylinderGeometry(0.56, 0.58, 0.22, 8), -1.53, Math.PI / 8, goldUv)

    // 3. Fuste/obelisco principal afilado
    addPart(new THREE.CylinderGeometry(0.36, 0.52, 2.00, 8), -0.42, Math.PI / 8, stoneUv)

    // 4. Colarinho dourado superior e base do emblema
    addPart(new THREE.CylinderGeometry(0.46, 0.38, 0.26, 8), 0.71, Math.PI / 8, goldUv)
    addPart(new THREE.CylinderGeometry(0.34, 0.46, 0.18, 8), 0.93, Math.PI / 8, ivoryUv)

    // 5. Emblema octaedrico coral-vermelho coroado por ponta marfim
    const emblem = new THREE.OctahedronGeometry(0.48, 0)
    emblem.scale(1.0, 1.35, 1.0)
    addPart(emblem, 1.48, 0, coralUv)

    const cap = new THREE.ConeGeometry(0.24, 0.34, 4)
    addPart(cap, 2.02, Math.PI / 4, ivoryUv)

    return parts
}

const disposeSubtree = (node, rootNode) =>
{
    for(const child of [ ...node.listChildren() ])
        disposeSubtree(child, node)

    const mesh = node.getMesh()
    if(mesh)
    {
        for(const prim of mesh.listPrimitives())
            prim.dispose()
        mesh.dispose()
    }

    const skin = node.getSkin()
    if(skin)
        skin.dispose()

    if(rootNode)
        rootNode.removeChild(node)

    node.dispose()
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const beforeSize = statSync(areasPath).size
const doc = await io.read(areasPath)
const gltfRoot = doc.getRoot()

const paletteMaterial = gltfRoot.listMaterials().find(m => m.getName() === 'palette')
if(!paletteMaterial)
    throw new Error('Material "palette" nao encontrado em areas.glb')

/**
 * T4.1: Letras fisicas VICTOR NEVES em LandingArea
 */
const landingNode = gltfRoot.listNodes().find(n => n.getName() === 'landing')
if(!landingNode)
    throw new Error('Grupo "landing" nao encontrado em areas.glb')

for(const child of [ ...landingNode.listChildren() ])
{
    if(child.getName().startsWith('refLettersPhysicalDynamic'))
        disposeSubtree(child, landingNode)
}

const shapes = makeLetterShapes()
const phrase = [ 'V', 'I', 'C', 'T', 'O', 'R', ' ', 'N', 'E', 'V', 'E', 'S' ]
const letterSpacing = 0.22
const spaceWidth = 0.82

const builtLetters = phrase.map((ch) =>
{
    if(ch === ' ')
        return { ch, space: true, width: spaceWidth }
    return { ch, space: false, ...buildLetterGeometry(shapes[ch]) }
})

const totalWidth = builtLetters.reduce((sum, item, idx) =>
    sum + item.width + (idx < builtLetters.length - 1 && !item.space && !builtLetters[idx + 1].space ? letterSpacing : 0)
, 0)

// Alinhamento diagonal original do Landing: +theta (25 deg) -> local +X aponta da esquerda (V) para a direita (S)
const rotationQuat = [ 0, 0.2164, 0, 0.9763 ]
const angle = 2 * Math.asin(0.2164)
const alongX = Math.cos(angle)
const alongZ = -Math.sin(angle)
const center = [ -5.211, -2.528, 3.086 ]

let cursor = -totalWidth / 2
let letterIndex = 0

for(let i = 0; i < builtLetters.length; i++)
{
    const item = builtLetters[i]
    if(item.space)
    {
        cursor += item.width
        continue
    }

    letterIndex++
    const suffix = String(letterIndex).padStart(3, '0')
    const centerOffset = cursor + item.width / 2
    const pos = [
        center[0] + alongX * centerOffset,
        center[1],
        center[2] + alongZ * centerOffset
    ]

    const prim = geometriesToGltfPrimitive(doc, paletteMaterial, [
        { geometry: item.geometry, uv: IVORY_UV }
    ])
    item.geometry.dispose()

    const mesh = doc.createMesh(`victorNevesLetter.${suffix}`).addPrimitive(prim)
    const node = doc.createNode(`refLettersPhysicalDynamic.${suffix}`)
        .setTranslation(pos)
        .setRotation(rotationQuat)
        .setExtras({ mass: 0.2 })
        .setMesh(mesh)

    const collider = doc.createNode(`cuboid.letter${suffix}`)
        .setTranslation([ 0, 0, 0 ])
        .setScale([ item.width, item.height, 0.44 ])

    node.addChild(collider)
    landingNode.addChild(node)

    cursor += item.width + (i < builtLetters.length - 1 && !builtLetters[i + 1].space ? letterSpacing : 0)
}

/**
 * T4.2: Limpeza de SocialArea + Totem geometrico em refStatuePhysicalDynamic
 */
const socialNode = gltfRoot.listNodes().find(n => n.getName() === 'social')
if(!socialNode)
    throw new Error('Grupo "social" nao encontrado em areas.glb')

const legacyPrefixes = [
    'baguiraPhysicalDynamic',
    'sudoPhysicalDynamic',
    'boyPhysicalDynamic',
    'twitchPhysicalDynamic',
    'blueskyPhysicalDynamic',
    'discordPhysicalDynamic'
]
const removedLegacy = []
for(const child of [ ...socialNode.listChildren() ])
{
    if(legacyPrefixes.some(prefix => child.getName().startsWith(prefix)))
    {
        removedLegacy.push(child.getName())
        disposeSubtree(child, socialNode)
    }
}

const statueNode = socialNode.listChildren().find(n => n.getName() === 'refStatuePhysicalDynamic')
if(!statueNode)
    throw new Error('No "refStatuePhysicalDynamic" nao encontrado em social')

for(const child of [ ...statueNode.listChildren() ])
    disposeSubtree(child, statueNode)

const oldStatueMesh = statueNode.getMesh()
if(oldStatueMesh)
{
    for(const prim of oldStatueMesh.listPrimitives())
        prim.dispose()
    oldStatueMesh.dispose()
}

const totemParts = buildGeometricTotemParts()
const totemPrim = geometriesToGltfPrimitive(doc, paletteMaterial, totemParts)
const totemMesh = doc.createMesh('socialTotem').addPrimitive(totemPrim)
statueNode.setMesh(totemMesh)
statueNode.setRotation([ 0, 0, 0, 1 ])

const totemCollider = doc.createNode('cuboid.034')
    .setTranslation([ 0, -0.3, 0 ])
    .setScale([ 1.25, 4.4, 1.25 ])
statueNode.addChild(totemCollider)

await doc.transform(prune({
    keepLeaves: true,
    keepExtras: true,
    keepAttributes: true,
    keepIndices: true,
    propertyTypes: [
        PropertyType.SKIN,
        PropertyType.MESH,
        PropertyType.PRIMITIVE,
        PropertyType.ACCESSOR,
        PropertyType.BUFFER
    ]
}))
await io.write(areasPath, doc)

const afterSize = statSync(areasPath).size
console.log(`T4.1: ${letterIndex} letras geradas (VICTOR NEVES)`)
console.log(`T4.2: ${removedLegacy.length} nos legados removidos (${removedLegacy.join(', ')}) + refStatuePhysicalDynamic substituido por totem geometrico`)
console.log(`areas.glb: ${(beforeSize / 1024).toFixed(1)} KB -> ${(afterSize / 1024).toFixed(1)} KB`)
