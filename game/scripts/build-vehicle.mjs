// Gera o protagonista 3D "Agro-Rover Futurista" em static/vehicle/default.glb
// Trator-Rover estilizado com capô chanfrado, cabine panoramica solar e cacamba traseira aberta
// para exibir trofeus das 5 paixoes (Agro, Tech, Negocios, Musica, Musculacao).
// Mantem 100% dos nomes de nos esperados por VisualVehicle.js e PhysicsVehicle.js.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { Document, NodeIO, VertexLayout } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vehiclePath = resolve(root, 'static/vehicle/default.glb')
const backupPath = resolve(root, 'resources/vehicle-default-original.glb')

if(!existsSync(backupPath))
{
    mkdirSync(dirname(backupPath), { recursive: true })
    copyFileSync(vehiclePath, backupPath)
}

// Swatches exatos de static/palette.png (128x4, row 2)
const UV = {
    dark:     [ 89.5 / 128, 0.5 ], // #1e0603 borracha / estrutura escura
    charcoal: [ 21.5 / 128, 0.5 ], // #4a413c para-choque / chassi
    gunmetal: [ 25.5 / 128, 0.5 ], // #575a5e metal / grade
    chrome:   [ 17.5 / 128, 0.5 ], // #c8c2c1 prata / escape / aro
    glass:    [ 13.5 / 128, 0.5 ], // #3dbbe7 vidro ciano-celeste
    ivory:    [ 93.5 / 128, 0.5 ], // #fff2e8 detalhe branco
    gold:     [ 33.5 / 128, 0.5 ], // #e4a90c emblema / detalhe dourado
}

const makeExtrudedProfile = (points, halfWidth, bevel = 0.04) =>
{
    const shape = new THREE.Shape()
    shape.moveTo(points[0][0], points[0][1])
    for(let i = 1; i < points.length; i++)
        shape.lineTo(points[i][0], points[i][1])
    shape.closePath()

    const geom = new THREE.ExtrudeGeometry(shape, {
        depth: halfWidth * 2 - bevel * 2,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 8,
    })
    geom.translate(0, 0, -(halfWidth - bevel))
    return geom
}

const partsToPrimitive = (doc, material, parts, { twoUV = false, bodyHeightRange = [-0.45, 0.72], bodyXRange = [-1.36, 1.40] } = {}) =>
{
    let totalVerts = 0
    const normalized = parts.map(({ geometry, uv }) =>
    {
        const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
        g.computeVertexNormals()
        totalVerts += g.getAttribute('position').count
        return { g, uv }
    })

    const positions = new Float32Array(totalVerts * 3)
    const normals = new Float32Array(totalVerts * 3)
    const uvs0 = new Float32Array(totalVerts * 2)
    const uvs1 = twoUV ? new Float32Array(totalVerts * 2) : null

    const [ minY, maxY ] = bodyHeightRange
    const [ minX, maxX ] = bodyXRange

    let offset = 0
    for(const { g, uv } of normalized)
    {
        const pos = g.getAttribute('position')
        const norm = g.getAttribute('normal')
        for(let i = 0; i < pos.count; i++)
        {
            const idx = offset + i
            const x = pos.getX(i)
            const y = pos.getY(i)
            const z = pos.getZ(i)
            positions[idx * 3 + 0] = x
            positions[idx * 3 + 1] = y
            positions[idx * 3 + 2] = z
            normals[idx * 3 + 0] = norm.getX(i)
            normals[idx * 3 + 1] = norm.getY(i)
            normals[idx * 3 + 2] = norm.getZ(i)

            if(uv === 'heightGradient')
            {
                const ty = Math.min(1, Math.max(0, (y - minY) / (maxY - minY)))
                uvs0[idx * 2 + 0] = 0.5
                uvs0[idx * 2 + 1] = ty
            }
            else
            {
                uvs0[idx * 2 + 0] = uv[0]
                uvs0[idx * 2 + 1] = uv[1]
            }

            if(uvs1)
            {
                const tx = Math.min(1, Math.max(0, 1 - (x - minX) / (maxX - minX)))
                const tz = Math.min(1, Math.max(0, (z + 0.85) / 1.7))
                uvs1[idx * 2 + 0] = tz
                uvs1[idx * 2 + 1] = tx
            }
        }
        offset += pos.count
        g.dispose()
    }

    const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer()
    const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvs0).setBuffer(buffer))
        .setMaterial(material)

    if(uvs1)
        prim.setAttribute('TEXCOORD_1', doc.createAccessor().setType('VEC2').setArray(uvs1).setBuffer(buffer))

    return prim
}

const addGeo = (arr, geometry, uv, { tx = 0, ty = 0, tz = 0, rx = 0, ry = 0, rz = 0 } = {}) =>
{
    if(rx) geometry.rotateX(rx)
    if(ry) geometry.rotateY(ry)
    if(rz) geometry.rotateZ(rz)
    if(tx || ty || tz) geometry.translate(tx, ty, tz)
    arr.push({ geometry, uv })
}

const doc = new Document()
doc.createBuffer()

const matPalette = doc.createMaterial('palette').setBaseColorFactor([1, 1, 1, 1])
const matRed = doc.createMaterial('redGradient').setBaseColorFactor([1, 0.35, 0.21, 1])
const matOrangeEmissive = doc.createMaterial('emissiveOrangeRadialGradient').setBaseColorFactor([1, 0.6, 0.2, 1])
const matBlueEmissive = doc.createMaterial('emissiveBlueRadialGradient').setBaseColorFactor([0.2, 0.85, 1, 1])
const matDarkGray = doc.createMaterial('darkGray').setBaseColorFactor([0.18, 0.2, 0.24, 1])

const scene = doc.createScene('Scene')
const chassisNode = doc.createNode('chassis').setTranslation([ 0, 0.9071759, 0 ])
scene.addChild(chassisNode)

// 1. Carroceria pintada ("Agro-Rover Futurista" com cacamba traseira aberta)
{
    const bodyParts = []

    // Perfil robusto de Trator-Rover: frente elevada (+X), cabine panoramica no centro, cacamba baixa atras (-X)
    const mainProfile = [
        [-1.34, -0.32],
        [-1.34,  0.14], // tampa traseira baixa da cacamba
        [-0.36,  0.14], // piso livre da cacamba (-1.30..-0.36)
        [-0.24,  0.66], // teto traseiro da cabine
        [ 0.34,  0.66], // teto frontal da cabine
        [ 0.68,  0.24], // base do para-brisa
        [ 1.30,  0.18], // capo alto de trator futurista
        [ 1.40, -0.06], // bico chanfrado frontal
        [ 1.32, -0.32],
    ]
    addGeo(bodyParts, makeExtrudedProfile(mainProfile, 0.68, 0.055), 'heightGradient')

    // Para-lamas alargados estilo trator-rover nas 4 rodas
    for(const sx of [-0.88, 0.88])
    {
        for(const sz of [-0.74, 0.74])
        {
            addGeo(bodyParts, new THREE.BoxGeometry(0.72, 0.24, 0.22), 'heightGradient', { tx: sx, ty: -0.10, tz: sz })
        }
    }

    // Laterais da cacamba aberta para guardar os trofeus com segurança
    for(const sz of [-0.62, 0.62])
        addGeo(bodyParts, new THREE.BoxGeometry(1.00, 0.20, 0.10), 'heightGradient', { tx: -0.84, ty: 0.22, tz: sz })
    // Tampa traseira
    addGeo(bodyParts, new THREE.BoxGeometry(0.10, 0.20, 1.32), 'heightGradient', { tx: -1.30, ty: 0.22, tz: 0 })

    // Viseira superior do teto estilo trator
    addGeo(bodyParts, new THREE.BoxGeometry(0.72, 0.07, 1.32), 'heightGradient', { tx: 0.06, ty: 0.69, tz: 0 })

    const prim = partsToPrimitive(doc, matRed, bodyParts, { twoUV: true })
    chassisNode.addChild(doc.createNode('bodyPainted').setMesh(doc.createMesh('bodyPainted').addPrimitive(prim)))
}

// 2. Pecas estruturais comuns (palette)
{
    const commonParts = []

    // Chassi inferior reforcado + degraus laterais
    addGeo(commonParts, new THREE.BoxGeometry(2.62, 0.14, 1.24), UV.dark, { tx: 0.02, ty: -0.36, tz: 0 })
    for(const sz of [-0.74, 0.74])
        addGeo(commonParts, new THREE.BoxGeometry(0.56, 0.08, 0.18), UV.chrome, { tx: 0.05, ty: -0.28, tz: sz })

    // Piso da cacamba traseira em chassi escuro texturizado
    addGeo(commonParts, new THREE.BoxGeometry(0.94, 0.06, 1.14), UV.charcoal, { tx: -0.84, ty: 0.14, tz: 0 })

    // Para-choque dianteiro trator + quebra-mato cromado
    addGeo(commonParts, new THREE.BoxGeometry(0.20, 0.24, 1.48), UV.charcoal, { tx: 1.40, ty: -0.22, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.12, 0.07, 1.08), UV.chrome, { tx: 1.46, ty: -0.10, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.10, 0.22, 0.10), UV.gold, { tx: 1.43, ty: 0.04, tz: 0 })

    // Grade do motor com aletas e painel visor frontal (onde ficam os olhos expressivos!)
    addGeo(commonParts, new THREE.BoxGeometry(0.08, 0.26, 0.96), UV.dark, { tx: 1.38, ty: 0.08, tz: 0 })

    // Chamine de escapamento vertical lateral cromada (personalidade de trator!)
    addGeo(commonParts, new THREE.CylinderGeometry(0.065, 0.075, 0.78, 12), UV.chrome, { tx: 0.44, ty: 0.56, tz: -0.74 })
    addGeo(commonParts, new THREE.CylinderGeometry(0.08, 0.065, 0.12, 12), UV.dark, { tx: 0.44, ty: 0.96, tz: -0.74 })

    // Cabine panoramica envidracada + modulo solar no teto
    const cabinProfile = [
        [-0.24, 0.20],
        [-0.20, 0.62],
        [ 0.30, 0.62],
        [ 0.64, 0.24],
    ]
    addGeo(commonParts, makeExtrudedProfile(cabinProfile, 0.60, 0.02), UV.glass)
    addGeo(commonParts, new THREE.BoxGeometry(0.42, 0.04, 0.92), UV.glass, { tx: 0.04, ty: 0.73, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.50, 0.05, 1.02), UV.dark, { tx: 0.04, ty: 0.71, tz: 0 })

    // Roll-bar santo-antonio cromado atras da cabine
    for(const sz of [-0.54, 0.54])
        addGeo(commonParts, new THREE.BoxGeometry(0.10, 0.36, 0.08), UV.chrome, { tx: -0.28, ty: 0.42, tz: sz })
    addGeo(commonParts, new THREE.BoxGeometry(0.09, 0.08, 1.16), UV.chrome, { tx: -0.28, ty: 0.58, tz: 0 })

    // Para-choque traseiro + engate dourado
    addGeo(commonParts, new THREE.BoxGeometry(0.18, 0.20, 1.44), UV.charcoal, { tx: -1.36, ty: -0.24, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.16, 0.12, 0.24), UV.gold, { tx: -1.42, ty: -0.20, tz: 0 })

    const prim = partsToPrimitive(doc, matPalette, commonParts)
    chassisNode.addChild(doc.createNode('common').setMesh(doc.createMesh('common').addPrimitive(prim)))
}

// 3. Farois dianteiros & barra LED do teto
{
    const parts = []
    for(const sz of [-0.56, 0.56])
    {
        addGeo(parts, new THREE.CylinderGeometry(0.10, 0.10, 0.08, 12), [0.5, 0.5], { tx: 1.39, ty: -0.02, tz: sz, rz: Math.PI * 0.5 })
        addGeo(parts, new THREE.BoxGeometry(0.08, 0.07, 0.22), [0.5, 0.5], { tx: 0.42, ty: 0.70, tz: sz * 0.65 })
    }
    const prim = partsToPrimitive(doc, matOrangeEmissive, parts)
    chassisNode.addChild(doc.createNode('headlights').setMesh(doc.createMesh('headlights').addPrimitive(prim)))
}

// 4. Lanternas traseiras, luz de freio & setas
{
    const backParts = []
    addGeo(backParts, new THREE.BoxGeometry(0.06, 0.09, 1.18), [0.5, 0.5], { tx: -1.36, ty: -0.05, tz: 0 })
    chassisNode.addChild(doc.createNode('backLights').setMesh(doc.createMesh('backLights').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, backParts))))

    const stopParts = []
    addGeo(stopParts, new THREE.BoxGeometry(0.06, 0.06, 0.78), [0.5, 0.5], { tx: -0.32, ty: 0.66, tz: 0 })
    chassisNode.addChild(doc.createNode('stopLights').setMesh(doc.createMesh('stopLights').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, stopParts))))

    const leftParts = []
    addGeo(leftParts, new THREE.BoxGeometry(0.10, 0.07, 0.14), [0.5, 0.5], { tx: 1.34, ty: -0.10, tz: -0.68 })
    addGeo(leftParts, new THREE.BoxGeometry(0.10, 0.07, 0.16), [0.5, 0.5], { tx: -1.36, ty: 0.08, tz: -0.66 })
    chassisNode.addChild(doc.createNode('blinkerLeft').setMesh(doc.createMesh('blinkerLeft').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, leftParts))))

    const rightParts = []
    addGeo(rightParts, new THREE.BoxGeometry(0.10, 0.07, 0.14), [0.5, 0.5], { tx: 1.34, ty: -0.10, tz: 0.68 })
    addGeo(rightParts, new THREE.BoxGeometry(0.10, 0.07, 0.16), [0.5, 0.5], { tx: -1.36, ty: 0.08, tz: 0.66 })
    chassisNode.addChild(doc.createNode('blinkerRight').setMesh(doc.createMesh('blinkerRight').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, rightParts))))
}

// 5. Faixas de energia do Boost + 3 celulas no santo-antonio traseiro
{
    const energyParts = []
    for(const sz of [-0.74, 0.74])
        addGeo(energyParts, new THREE.BoxGeometry(0.84, 0.07, 0.05), [0.5, 0.5], { tx: 0.02, ty: -0.04, tz: sz })
    const prim = partsToPrimitive(doc, matDarkGray, energyParts, { twoUV: true })
    chassisNode.addChild(doc.createNode('energy').setMesh(doc.createMesh('energy').addPrimitive(prim)))

    const cellPositionsZ = [ -0.22, 0.0, 0.22 ]
    for(let i = 0; i < 3; i++)
    {
        const cellNode = doc.createNode(`cell${i + 1}`).setTranslation([ 0, 0.2, 0 ])
        const cagePrim = partsToPrimitive(doc, matPalette, [
            { geometry: (() => { const g = new THREE.BoxGeometry(0.12, 0.10, 0.12); g.translate(-0.26, 0.66, cellPositionsZ[i]); return g })(), uv: UV.chrome }
        ])
        const corePrim = partsToPrimitive(doc, matBlueEmissive, [
            { geometry: (() => { const g = new THREE.BoxGeometry(0.08, 0.12, 0.08); g.translate(-0.26, 0.69, cellPositionsZ[i]); return g })(), uv: [0.5, 0.5] }
        ])
        cellNode.addChild(doc.createNode(`cellsCage.${i + 1}`).setMesh(doc.createMesh(`cellsCage.${i + 1}`).addPrimitive(cagePrim)))
        cellNode.addChild(doc.createNode(`cellsEnergy.${i + 1}`).setMesh(doc.createMesh(`cellsEnergy.${i + 1}`).addPrimitive(corePrim)))
        chassisNode.addChild(cellNode)
    }
}

// 6. Roda Trator-Rover robusta (`wheelContainer`)
{
    const wheelContainer = doc.createNode('wheelContainer').setTranslation([ 0.9, -0.42, -0.75 ])
    scene.addChild(wheelContainer)

    const wheelCylinder = doc.createNode('wheelCylinder')
    wheelContainer.addChild(wheelCylinder)

    const tireParts = []
    const tire = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 24)
    addGeo(tireParts, tire, UV.dark, { rx: Math.PI * 0.5 })
    // Garras/gomes todo-terreno
    for(let t = 0; t < 12; t++)
    {
        const ang = (t / 12) * Math.PI * 2
        const lug = new THREE.BoxGeometry(0.07, 0.05, 0.36)
        addGeo(tireParts, lug, UV.charcoal, {
            tx: Math.cos(ang) * 0.415,
            ty: Math.sin(ang) * 0.415,
            rz: ang - Math.PI * 0.5,
        })
    }
    const hub = new THREE.CylinderGeometry(0.24, 0.24, 0.40, 16)
    addGeo(tireParts, hub, UV.gunmetal, { rx: Math.PI * 0.5 })
    for(let k = 0; k < 6; k++)
    {
        const ang = (k / 6) * Math.PI * 2
        const spoke = new THREE.BoxGeometry(0.22, 0.06, 0.04)
        addGeo(tireParts, spoke, UV.chrome, {
            tx: Math.cos(ang) * 0.12,
            ty: Math.sin(ang) * 0.12,
            tz: -0.195,
            rz: ang,
        })
    }
    wheelCylinder.addChild(doc.createNode('wheel').setMesh(doc.createMesh('wheel').addPrimitive(partsToPrimitive(doc, matPalette, tireParts))))

    const paintedParts = []
    const lip = new THREE.TorusGeometry(0.24, 0.036, 8, 20)
    addGeo(paintedParts, lip, [0.5, 0.5], { tz: -0.195 })
    const cap = new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12)
    addGeo(paintedParts, cap, [0.5, 0.5], { rx: Math.PI * 0.5, tz: -0.20 })
    wheelCylinder.addChild(doc.createNode('wheelPainted').setMesh(doc.createMesh('wheelPainted').addPrimitive(partsToPrimitive(doc, matRed, paintedParts))))

    const guardParts = []
    addGeo(guardParts, new THREE.BoxGeometry(0.62, 0.11, 0.36), UV.charcoal, { tx: 0, ty: 0.46, tz: 0 })
    wheelContainer.addChild(doc.createNode('wheelGuard').setMesh(doc.createMesh('wheelGuard').addPrimitive(partsToPrimitive(doc, matPalette, guardParts))))

    const suspParts = []
    addGeo(suspParts, new THREE.CylinderGeometry(0.06, 0.06, 0.85, 8), UV.gold, { tx: 0, ty: 0.44, tz: 0 })
    wheelContainer.addChild(doc.createNode('wheelSuspension').setTranslation([ 0, 0.48, 0 ]).setMesh(doc.createMesh('wheelSuspension').addPrimitive(partsToPrimitive(doc, matPalette, suspParts))))
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE)
await io.write(vehiclePath, doc)
console.log(`Agro-Rover Futurista salvo em ${vehiclePath} (${(statSync(vehiclePath).size / 1024).toFixed(1)} KB)`)
