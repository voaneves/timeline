// Gera um novo veiculo estilizado "Coastal Rally GT" em static/vehicle/default.glb
// Mantem 100% de compatibilidade com VisualVehicle.js e PhysicsVehicle.js.
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
    dark:     [ 89.5 / 128, 0.5 ], // #1e0603 borracha / friso escuro
    charcoal: [ 21.5 / 128, 0.5 ], // #4a413c para-choque / chassi
    gunmetal: [ 25.5 / 128, 0.5 ], // #575a5e metal / difusor
    chrome:   [ 17.5 / 128, 0.5 ], // #c8c2c1 prata / escape / aro
    glass:    [ 13.5 / 128, 0.5 ], // #3dbbe7 vidro ciano-celeste
    ivory:    [ 93.5 / 128, 0.5 ], // #fff2e8 detalhe esportivo branco
    gold:     [ 33.5 / 128, 0.5 ], // #e4a90c emblema / pinca dourada
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

const partsToPrimitive = (doc, material, parts, { twoUV = false, bodyHeightRange = [-0.45, 0.65], bodyXRange = [-1.36, 1.38] } = {}) =>
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

// -----------------------------------------------------------------------------
// Documento GLTF
// -----------------------------------------------------------------------------
const doc = new Document()
doc.createBuffer()

const matPalette = doc.createMaterial('palette').setBaseColorFactor([1, 1, 1, 1])
const matRed = doc.createMaterial('redGradient').setBaseColorFactor([1, 0.35, 0.21, 1])
const matOrangeEmissive = doc.createMaterial('emissiveOrangeRadialGradient').setBaseColorFactor([1, 0.6, 0.2, 1])
const matBlueEmissive = doc.createMaterial('emissiveBlueRadialGradient').setBaseColorFactor([0.2, 0.85, 1, 1])
const matDarkGray = doc.createMaterial('darkGray').setBaseColorFactor([0.18, 0.2, 0.24, 1])

const scene = doc.createScene('Scene')

// Chassis root (alinhado com VisualVehicle.js)
const chassisNode = doc.createNode('chassis').setTranslation([ 0, 0.9071759, 0 ])
scene.addChild(chassisNode)

// 1. Carroceria pintada (Coastal Rally GT Coupe)
{
    const bodyParts = []

    // Silhueta principal fastback esportiva (+X frente)
    const mainProfile = [
        [-1.34, -0.32],
        [-1.34,  0.14],
        [-1.18,  0.22], // deck traseiro
        [-0.78,  0.24],
        [-0.42,  0.58], // teto fastback
        [ 0.22,  0.58], // teto
        [ 0.68,  0.22], // base para-brisa
        [ 1.32,  0.04], // capo esportivo inclinado
        [ 1.38, -0.18], // bico frontal
        [ 1.28, -0.32],
    ]
    addGeo(bodyParts, makeExtrudedProfile(mainProfile, 0.72, 0.055), 'heightGradient')

    // Ombros / para-lamas alargados (fender flares dianteiros e traseiros)
    for(const sx of [-0.88, 0.88])
    {
        for(const sz of [-0.74, 0.74])
        {
            const flare = new THREE.BoxGeometry(0.68, 0.26, 0.20)
            addGeo(bodyParts, flare, 'heightGradient', { tx: sx, ty: -0.14, tz: sz })
        }
    }

    // Saias laterais esportivas entre as rodas
    for(const sz of [-0.75, 0.75])
    {
        const skirt = new THREE.BoxGeometry(1.12, 0.16, 0.16)
        addGeo(bodyParts, skirt, 'heightGradient', { tx: 0, ty: -0.26, tz: sz })
    }

    // Scoop de teto estilo rally
    addGeo(bodyParts, new THREE.BoxGeometry(0.32, 0.08, 0.42), 'heightGradient', { tx: -0.05, ty: 0.62, tz: 0 })

    // Aerofolio traseiro (asa superior)
    addGeo(bodyParts, new THREE.BoxGeometry(0.34, 0.06, 1.48), 'heightGradient', { tx: -1.26, ty: 0.48, tz: 0, rz: 0.14 })

    const prim = partsToPrimitive(doc, matRed, bodyParts, { twoUV: true })
    chassisNode.addChild(doc.createNode('bodyPainted').setMesh(doc.createMesh('bodyPainted').addPrimitive(prim)))
}

// 2. Pecas comuns (palette)
{
    const commonParts = []

    // Chassi inferior / piso
    addGeo(commonParts, new THREE.BoxGeometry(2.58, 0.14, 1.24), UV.dark, { tx: 0.02, ty: -0.36, tz: 0 })

    // Para-choque dianteiro + splitter esportivo + skid plate
    addGeo(commonParts, new THREE.BoxGeometry(0.18, 0.22, 1.50), UV.charcoal, { tx: 1.38, ty: -0.25, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.24, 0.06, 1.56), UV.gunmetal, { tx: 1.42, ty: -0.34, tz: 0 })
    // Grade frontal + barra de protecao rally
    addGeo(commonParts, new THREE.BoxGeometry(0.08, 0.18, 0.92), UV.dark, { tx: 1.39, ty: -0.10, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.10, 0.05, 0.86), UV.chrome, { tx: 1.45, ty: -0.20, tz: 0 })

    // Difusor traseiro + para-choque traseiro
    addGeo(commonParts, new THREE.BoxGeometry(0.16, 0.24, 1.48), UV.charcoal, { tx: -1.35, ty: -0.24, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.20, 0.12, 1.18), UV.gunmetal, { tx: -1.36, ty: -0.32, tz: 0 })

    // Escapamentos duplos alinhados aos trails (-1.28, 0.1, +-0.55)
    for(const sz of [-0.55, 0.55])
    {
        const pipe = new THREE.CylinderGeometry(0.075, 0.085, 0.26, 12)
        addGeo(commonParts, pipe, UV.chrome, { tx: -1.36, ty: -0.22, tz: sz, rz: Math.PI * 0.5 })
    }

    // Cabine envidracada (para-brisa inclinado, teto escuro, vidros laterais e vigia traseiro)
    const cabinProfile = [
        [-0.72, 0.22],
        [-0.40, 0.54],
        [ 0.20, 0.54],
        [ 0.66, 0.21],
    ]
    addGeo(commonParts, makeExtrudedProfile(cabinProfile, 0.64, 0.02), UV.glass)

    // Colunas e moldura do teto
    addGeo(commonParts, new THREE.BoxGeometry(0.60, 0.05, 1.24), UV.dark, { tx: -0.10, ty: 0.57, tz: 0 })

    // Retrovisores laterais
    for(const sz of [-0.80, 0.80])
        addGeo(commonParts, new THREE.BoxGeometry(0.14, 0.10, 0.16), UV.charcoal, { tx: 0.44, ty: 0.26, tz: sz })

    // Suportes do aerofolio traseiro
    for(const sz of [-0.46, 0.46])
        addGeo(commonParts, new THREE.BoxGeometry(0.14, 0.26, 0.06), UV.dark, { tx: -1.22, ty: 0.34, tz: sz })

    // Rack de teto + barra para farois auxiliares
    addGeo(commonParts, new THREE.BoxGeometry(0.12, 0.06, 0.94), UV.charcoal, { tx: 0.16, ty: 0.62, tz: 0 })
    for(const sz of [-0.26, 0.26])
        addGeo(commonParts, new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10), UV.dark, { tx: 0.20, ty: 0.67, tz: sz, rz: Math.PI * 0.5 })

    // Emblema esportivo frontal + faixa ivory
    addGeo(commonParts, new THREE.BoxGeometry(0.05, 0.08, 0.16), UV.gold, { tx: 1.43, ty: -0.09, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.60, 0.02, 0.18), UV.ivory, { tx: 0.96, ty: 0.14, tz: 0, rz: -0.22 })

    const prim = partsToPrimitive(doc, matPalette, commonParts)
    chassisNode.addChild(doc.createNode('common').setMesh(doc.createMesh('common').addPrimitive(prim)))
}

// 3. Farois dianteiros + DRL + auxiliares do teto
{
    const parts = []
    for(const sz of [-0.52, 0.52])
    {
        addGeo(parts, new THREE.BoxGeometry(0.12, 0.11, 0.26), [0.5, 0.5], { tx: 1.35, ty: -0.03, tz: sz, rz: -0.2 })
        addGeo(parts, new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), [0.5, 0.5], { tx: 0.26, ty: 0.67, tz: sz * 0.5, rz: Math.PI * 0.5 })
    }
    const prim = partsToPrimitive(doc, matOrangeEmissive, parts)
    chassisNode.addChild(doc.createNode('headlights').setMesh(doc.createMesh('headlights').addPrimitive(prim)))
}

// 4. Lanternas traseiras + luz de freio + setas
{
    const backParts = []
    addGeo(backParts, new THREE.BoxGeometry(0.06, 0.09, 1.18), [0.5, 0.5], { tx: -1.35, ty: 0.06, tz: 0 })
    chassisNode.addChild(doc.createNode('backLights').setMesh(doc.createMesh('backLights').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, backParts))))

    const stopParts = []
    addGeo(stopParts, new THREE.BoxGeometry(0.06, 0.05, 0.72), [0.5, 0.5], { tx: -1.39, ty: 0.49, tz: 0 })
    chassisNode.addChild(doc.createNode('stopLights').setMesh(doc.createMesh('stopLights').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, stopParts))))

    const leftParts = []
    addGeo(leftParts, new THREE.BoxGeometry(0.12, 0.07, 0.14), [0.5, 0.5], { tx: 1.32, ty: -0.10, tz: -0.68 })
    addGeo(leftParts, new THREE.BoxGeometry(0.10, 0.07, 0.16), [0.5, 0.5], { tx: -1.35, ty: 0.06, tz: -0.66 })
    chassisNode.addChild(doc.createNode('blinkerLeft').setMesh(doc.createMesh('blinkerLeft').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, leftParts))))

    const rightParts = []
    addGeo(rightParts, new THREE.BoxGeometry(0.12, 0.07, 0.14), [0.5, 0.5], { tx: 1.32, ty: -0.10, tz: 0.68 })
    addGeo(rightParts, new THREE.BoxGeometry(0.10, 0.07, 0.16), [0.5, 0.5], { tx: -1.35, ty: 0.06, tz: 0.66 })
    chassisNode.addChild(doc.createNode('blinkerRight').setMesh(doc.createMesh('blinkerRight').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, rightParts))))
}

// 5. Faixas de energia do Boost (`energy`) + 3 celulas no deck traseiro (`cell1..3`)
{
    const energyParts = []
    for(const sz of [-0.77, 0.77])
        addGeo(energyParts, new THREE.BoxGeometry(0.86, 0.07, 0.05), [0.5, 0.5], { tx: -0.04, ty: -0.08, tz: sz })
    addGeo(energyParts, new THREE.BoxGeometry(0.18, 0.06, 0.64), [0.5, 0.5], { tx: -0.98, ty: 0.24, tz: 0 })
    const prim = partsToPrimitive(doc, matDarkGray, energyParts, { twoUV: true })
    chassisNode.addChild(doc.createNode('energy').setMesh(doc.createMesh('energy').addPrimitive(prim)))

    const cellPositionsZ = [ -0.22, 0.0, 0.22 ]
    for(let i = 0; i < 3; i++)
    {
        const cellNode = doc.createNode(`cell${i + 1}`).setTranslation([ 0, 0.2, 0 ])
        const cagePrim = partsToPrimitive(doc, matPalette, [
            { geometry: (() => { const g = new THREE.BoxGeometry(0.14, 0.10, 0.14); g.translate(-0.98, 0.14, cellPositionsZ[i]); return g })(), uv: UV.chrome }
        ])
        const corePrim = partsToPrimitive(doc, matBlueEmissive, [
            { geometry: (() => { const g = new THREE.BoxGeometry(0.10, 0.12, 0.10); g.translate(-0.98, 0.17, cellPositionsZ[i]); return g })(), uv: [0.5, 0.5] }
        ])
        cellNode.addChild(doc.createNode(`cellsCage.${i + 1}`).setMesh(doc.createMesh(`cellsCage.${i + 1}`).addPrimitive(cagePrim)))
        cellNode.addChild(doc.createNode(`cellsEnergy.${i + 1}`).setMesh(doc.createMesh(`cellsEnergy.${i + 1}`).addPrimitive(corePrim)))
        chassisNode.addChild(cellNode)
    }
}

// 6. Roda modelo (`wheelContainer` — clonada 4x por VisualVehicle.js)
{
    const wheelContainer = doc.createNode('wheelContainer').setTranslation([ 0.9, -0.42, -0.75 ])
    scene.addChild(wheelContainer)

    const wheelCylinder = doc.createNode('wheelCylinder')
    wheelContainer.addChild(wheelCylinder)

    // Pneu + cubos + raios esportivos
    const tireParts = []
    const tire = new THREE.CylinderGeometry(0.41, 0.41, 0.34, 24)
    addGeo(tireParts, tire, UV.dark, { rx: Math.PI * 0.5 })
    const sidewall = new THREE.CylinderGeometry(0.32, 0.32, 0.355, 20)
    addGeo(tireParts, sidewall, UV.charcoal, { rx: Math.PI * 0.5 })
    const hub = new THREE.CylinderGeometry(0.24, 0.24, 0.37, 16)
    addGeo(tireParts, hub, UV.gunmetal, { rx: Math.PI * 0.5 })
    // 5 raios esportivos
    for(let k = 0; k < 5; k++)
    {
        const ang = (k / 5) * Math.PI * 2
        const spoke = new THREE.BoxGeometry(0.22, 0.055, 0.04)
        addGeo(tireParts, spoke, UV.chrome, {
            tx: Math.cos(ang) * 0.12,
            ty: Math.sin(ang) * 0.12,
            tz: -0.175,
            rz: ang,
        })
    }
    wheelCylinder.addChild(doc.createNode('wheel').setMesh(doc.createMesh('wheel').addPrimitive(partsToPrimitive(doc, matPalette, tireParts))))

    // Aro pintado (muda com as recompensas de pintura!)
    const paintedParts = []
    const lip = new THREE.TorusGeometry(0.24, 0.032, 8, 20)
    addGeo(paintedParts, lip, [0.5, 0.5], { tz: -0.175 })
    const cap = new THREE.CylinderGeometry(0.08, 0.08, 0.04, 12)
    addGeo(paintedParts, cap, [0.5, 0.5], { rx: Math.PI * 0.5, tz: -0.18 })
    wheelCylinder.addChild(doc.createNode('wheelPainted').setMesh(doc.createMesh('wheelPainted').addPrimitive(partsToPrimitive(doc, matRed, paintedParts))))

    // Para-lama e suspensao
    const guardParts = []
    addGeo(guardParts, new THREE.BoxGeometry(0.56, 0.10, 0.32), UV.charcoal, { tx: 0, ty: 0.44, tz: 0 })
    wheelContainer.addChild(doc.createNode('wheelGuard').setMesh(doc.createMesh('wheelGuard').addPrimitive(partsToPrimitive(doc, matPalette, guardParts))))

    const suspParts = []
    addGeo(suspParts, new THREE.CylinderGeometry(0.055, 0.055, 0.85, 8), UV.gold, { tx: 0, ty: 0.44, tz: 0 })
    wheelContainer.addChild(doc.createNode('wheelSuspension').setTranslation([ 0, 0.48, 0 ]).setMesh(doc.createMesh('wheelSuspension').addPrimitive(partsToPrimitive(doc, matPalette, suspParts))))
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE)
await io.write(vehiclePath, doc)
console.log(`Novo veiculo salvo em ${vehiclePath} (${(statSync(vehiclePath).size / 1024).toFixed(1)} KB)`)
