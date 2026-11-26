// Gera o protagonista 3D "Dodge RAM Die-Cast Off-Road" em static/vehicle/default.glb
// Picape cabine dupla estilizada estilo brinquedo die-cast com grade RAM frontal, capo power-dome,
// arcos de para-lama alargados, interior detalhado visivel, suspensão com mola helicoidal 3D,
// pneus off-road cravudos e caçamba traseira aberta para os troféus das paixões.
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
    charcoal: [ 21.5 / 128, 0.5 ], // #4a413c para-choque / acabamento preto fosco
    gunmetal: [ 25.5 / 128, 0.5 ], // #575a5e metal / grade / aço escuro
    chrome:   [ 17.5 / 128, 0.5 ], // #c8c2c1 cromado / prata
    glass:    [ 13.5 / 128, 0.5 ], // #3dbbe7 detalhe ciano / lente
    ivory:    [ 93.5 / 128, 0.5 ], // #fff2e8 letras RAM / contraste claro
    gold:     [ 33.5 / 128, 0.5 ], // #e4a90c detalhe dourado
}

const makeExtrudedShape = (shape, depth, bevel = 0.025, centerZ = true) =>
{
    const geom = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.01, depth - bevel * 2),
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 14,
    })
    if(centerZ)
        geom.translate(0, 0, -(depth - bevel * 2) * 0.5)
    return geom
}

const makeExtrudedProfile = (points, halfWidth, bevel = 0.03) =>
{
    const shape = new THREE.Shape()
    shape.moveTo(points[0][0], points[0][1])
    for(let i = 1; i < points.length; i++)
        shape.lineTo(points[i][0], points[i][1])
    shape.closePath()
    return makeExtrudedShape(shape, halfWidth * 2, bevel, true)
}

// Cria perfil lateral com recortes semicirculares reais para as caixas de roda
const makeSideFlankGeo = (zCenter, thickness, bevel = 0.022) =>
{
    const s = new THREE.Shape()
    const frontAxle = 0.90
    const rearAxle = -0.90
    const archY = -0.34
    const archR = 0.49

    s.moveTo(-1.45, -0.14)
    s.lineTo(rearAxle - archR, -0.14)
    s.absarc(rearAxle, archY, archR, Math.PI * 0.87, Math.PI * 0.13, true)
    s.lineTo(frontAxle - archR, -0.14)
    s.absarc(frontAxle, archY, archR, Math.PI * 0.87, Math.PI * 0.13, true)
    s.lineTo(1.42, -0.14)
    s.lineTo(1.45,  0.14) // frente chanfrada do nariz
    s.lineTo(1.36,  0.22) // ponta do capo
    s.lineTo(0.48,  0.28) // base do para-brisa
    s.lineTo(-1.46, 0.28) // linha de cintura reta da picape ate a cacamba
    s.lineTo(-1.48, -0.08)
    s.closePath()

    const geom = makeExtrudedShape(s, thickness, bevel, true)
    geom.translate(0, 0, zCenter)
    return geom
}

// Arco semicircular off-road (fender flare) em torno da roda
const makeFenderFlareGeo = (centerX, centerY, zCenter, width, innerR = 0.48, outerR = 0.59, bevel = 0.018) =>
{
    const s = new THREE.Shape()
    const aStart = -0.12
    const aEnd = Math.PI + 0.12
    s.absarc(centerX, centerY, outerR, aStart, aEnd, false)
    s.absarc(centerX, centerY, innerR, aEnd, aStart, true)
    s.closePath()
    const geom = makeExtrudedShape(s, width, bevel, true)
    geom.translate(0, 0, zCenter)
    return geom
}

// Mola helicoidal 3D real para a suspensao visivel acima de cada pneu
class HelixCurve extends THREE.Curve
{
    constructor(radius = 0.11, height = 0.56, turns = 5.5)
    {
        super()
        this.radius = radius
        this.height = height
        this.turns = turns
    }

    getPoint(t, optionalTarget = new THREE.Vector3())
    {
        const ang = t * this.turns * Math.PI * 2
        return optionalTarget.set(
            Math.cos(ang) * this.radius,
            t * this.height,
            Math.sin(ang) * this.radius
        )
    }
}

const partsToPrimitive = (doc, material, parts, { twoUV = false, bodyHeightRange = [-0.36, 0.76], bodyXRange = [-1.48, 1.48] } = {}) =>
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
const matWhiteEmissive = doc.createMaterial('emissiveWhiteRadialGradient').setBaseColorFactor([1, 1, 1, 1])
const matOrangeEmissive = doc.createMaterial('emissiveOrangeRadialGradient').setBaseColorFactor([1, 0.6, 0.2, 1])
const matBlueEmissive = doc.createMaterial('emissiveBlueRadialGradient').setBaseColorFactor([0.2, 0.85, 1, 1])
const matDarkGray = doc.createMaterial('darkGray').setBaseColorFactor([0.18, 0.2, 0.24, 1])

const scene = doc.createScene('Scene')
const chassisNode = doc.createNode('chassis').setTranslation([ 0, 0.9071759, 0 ])
scene.addChild(chassisNode)

// 1. Carroceria Pintada (`bodyPainted`) — Picape Crew-Cab estilo Dodge RAM
{
    const bodyParts = []

    // Flancos laterais esquerdo e direito com recortes reais para as caixas de roda
    for(const sz of [ -0.61, 0.61 ])
        addGeo(bodyParts, makeSideFlankGeo(sz, 0.16, 0.024), 'heightGradient')

    // Capo musculoso levemente inclinado + "power dome" central TRX
    const hoodDeckProfile = [
        [ 0.44, 0.14 ],
        [ 1.38, 0.10 ],
        [ 1.43, 0.20 ],
        [ 0.46, 0.28 ],
    ]
    addGeo(bodyParts, makeExtrudedProfile(hoodDeckProfile, 0.58, 0.024), 'heightGradient')

    const powerDomeProfile = [
        [ 0.56, 0.24 ],
        [ 1.28, 0.20 ],
        [ 1.22, 0.31 ],
        [ 0.60, 0.33 ],
    ]
    addGeo(bodyParts, makeExtrudedProfile(powerDomeProfile, 0.34, 0.022), 'heightGradient')

    // Parede corta-fogo dianteira e anteparo traseiro da cabine
    addGeo(bodyParts, new THREE.BoxGeometry(0.14, 0.38, 1.18), 'heightGradient', { tx: 0.45, ty: 0.06, tz: 0 })
    addGeo(bodyParts, new THREE.BoxGeometry(0.10, 0.42, 1.24), 'heightGradient', { tx: -0.40, ty: 0.08, tz: 0 })

    // Piso da cabine (oculto sob o interior)
    addGeo(bodyParts, new THREE.BoxGeometry(0.84, 0.08, 1.18), 'heightGradient', { tx: 0.04, ty: -0.10, tz: 0 })

    // Estufa oca da cabine dupla: pilares A inclinados, pilares B, pilares C e moldura de teto solar
    for(const sz of [ -0.60, 0.60 ])
    {
        const zTilt = sz > 0 ? -0.05 : 0.05
        // Pilar A (inclinado)
        addGeo(bodyParts, new THREE.BoxGeometry(0.085, 0.51, 0.085), 'heightGradient', { tx: 0.36, ty: 0.48, tz: sz + zTilt * 0.5, rz: 0.50 })
        // Pilar B (divisoria das portas dianteira/traseira)
        addGeo(bodyParts, new THREE.BoxGeometry(0.075, 0.46, 0.065), 'heightGradient', { tx: 0.00, ty: 0.48, tz: sz + zTilt * 0.5, rz: 0.04 })
        // Pilar C traseiro robusto
        addGeo(bodyParts, new THREE.BoxGeometry(0.12, 0.46, 0.085), 'heightGradient', { tx: -0.37, ty: 0.48, tz: sz + zTilt * 0.5, rz: -0.16 })
        // Longarina superior do teto
        addGeo(bodyParts, new THREE.BoxGeometry(0.68, 0.065, 0.14), 'heightGradient', { tx: -0.05, ty: 0.71, tz: sz * 0.88 })
        // Retrovisores externos com capa pintada
        addGeo(bodyParts, new THREE.BoxGeometry(0.11, 0.10, 0.15), 'heightGradient', { tx: 0.40, ty: 0.38, tz: sz + (sz > 0 ? 0.14 : -0.14) })
    }

    // Travessa dianteira e traseira do teto deixando janela panoramica central
    addGeo(bodyParts, new THREE.BoxGeometry(0.16, 0.065, 1.12), 'heightGradient', { tx: 0.21, ty: 0.71, tz: 0 })
    addGeo(bodyParts, new THREE.BoxGeometry(0.18, 0.065, 1.12), 'heightGradient', { tx: -0.30, ty: 0.71, tz: 0 })

    // Tampa traseira (tailgate) da cacamba aberta
    addGeo(bodyParts, new THREE.BoxGeometry(0.11, 0.40, 1.18), 'heightGradient', { tx: -1.44, ty: 0.07, tz: 0 })

    // Frente inferior em torno da grade RAM (borda superior pintada + bochechas dos farois)
    addGeo(bodyParts, new THREE.BoxGeometry(0.10, 0.08, 1.24), 'heightGradient', { tx: 1.41, ty: 0.19, tz: 0 })
    for(const sz of [ -0.58, 0.58 ])
        addGeo(bodyParts, new THREE.BoxGeometry(0.10, 0.24, 0.14), 'heightGradient', { tx: 1.41, ty: 0.05, tz: sz })

    const prim = partsToPrimitive(doc, matRed, bodyParts, { twoUV: true })
    chassisNode.addChild(doc.createNode('bodyPainted').setMesh(doc.createMesh('bodyPainted').addPrimitive(prim)))
}

// 2. Pecas estruturais comuns (`common` — palette)
{
    const commonParts = []

    // Sub-chassi longo central em aco escuro + travessas dos eixos
    addGeo(commonParts, new THREE.BoxGeometry(2.74, 0.12, 0.84), UV.dark, { tx: -0.02, ty: -0.24, tz: 0 })
    for(const sx of [ -0.90, 0.90 ])
        addGeo(commonParts, new THREE.CylinderGeometry(0.065, 0.065, 1.48, 10), UV.charcoal, { tx: sx, ty: -0.38, tz: 0, rx: Math.PI * 0.5 })

    // 4 Alargadores de para-lama (fender flares) pretos foscos estilo off-road
    for(const sx of [ -0.90, 0.90 ])
    {
        for(const sz of [ -0.70, 0.70 ])
        {
            addGeo(commonParts, makeFenderFlareGeo(sx, -0.34, sz, 0.16, 0.475, 0.585, 0.016), UV.charcoal)
        }
    }

    // Estribos laterais off-road (rock sliders / running boards)
    for(const sz of [ -0.71, 0.71 ])
    {
        addGeo(commonParts, new THREE.BoxGeometry(0.92, 0.055, 0.14), UV.charcoal, { tx: 0.02, ty: -0.22, tz: sz })
        addGeo(commonParts, new THREE.BoxGeometry(0.86, 0.025, 0.05), UV.chrome, { tx: 0.02, ty: -0.19, tz: sz + (sz > 0 ? 0.05 : -0.05) })
    }

    // === GRADE DIANTEIRA RAM + PARA-CHOQUE OFF-ROAD + PEITO DE ACO ===
    // Moldura & miolo preto fosco da grade
    addGeo(commonParts, new THREE.BoxGeometry(0.09, 0.27, 0.98), UV.dark, { tx: 1.43, ty: 0.06, tz: 0 })
    for(const gy of [ -0.01, 0.06, 0.13 ])
        addGeo(commonParts, new THREE.BoxGeometry(0.03, 0.022, 0.88), UV.gunmetal, { tx: 1.47, ty: gy, tz: 0 })
    // Entrada de ar do power-dome no capo
    addGeo(commonParts, new THREE.BoxGeometry(0.08, 0.05, 0.46), UV.dark, { tx: 1.24, ty: 0.28, tz: 0 })

    // Letras tridimensionais "R A M" em contraste claro no centro da grade
    // Olhando a frente (+X) por fora: +Z fica na ESQUERDA do observador e -Z na DIREITA -> R (+0.20), A (0), M (-0.20)
    const gx = 1.495
    // R (esquerda da grade, +Z)
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.10, 0.022), UV.ivory, { tx: gx, ty: 0.06, tz:  0.24 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.022, 0.075), UV.ivory, { tx: gx, ty: 0.10, tz:  0.21 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.022, 0.075), UV.ivory, { tx: gx, ty: 0.06, tz:  0.21 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.048, 0.022), UV.ivory, { tx: gx, ty: 0.08, tz:  0.175 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.058, 0.022), UV.ivory, { tx: gx, ty: 0.034, tz: 0.18, rx: 0.35 })
    // A (centro da grade, z = 0)
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.10, 0.022), UV.ivory, { tx: gx, ty: 0.06, tz: -0.036, rx: -0.16 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.10, 0.022), UV.ivory, { tx: gx, ty: 0.06, tz:  0.036, rx:  0.16 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.022, 0.072), UV.ivory, { tx: gx, ty: 0.10, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.022, 0.068), UV.ivory, { tx: gx, ty: 0.055, tz: 0 })
    // M (direita da grade, -Z)
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.10, 0.022), UV.ivory, { tx: gx, ty: 0.06, tz: -0.155 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.10, 0.022), UV.ivory, { tx: gx, ty: 0.06, tz: -0.255 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.075, 0.022), UV.ivory, { tx: gx, ty: 0.075, tz: -0.185, rx: -0.45 })
    addGeo(commonParts, new THREE.BoxGeometry(0.028, 0.075, 0.022), UV.ivory, { tx: gx, ty: 0.075, tz: -0.225, rx:  0.45 })

    // Para-choque dianteiro off-road robusto + peito de aco inferior + ganchos
    addGeo(commonParts, new THREE.BoxGeometry(0.22, 0.14, 1.44), UV.charcoal, { tx: 1.44, ty: -0.16, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.26, 0.06, 0.88), UV.gunmetal, { tx: 1.38, ty: -0.25, tz: 0, rz: 0.34 })
    for(const sz of [ -0.34, 0.34 ])
        addGeo(commonParts, new THREE.BoxGeometry(0.10, 0.07, 0.06), UV.chrome, { tx: 1.54, ty: -0.17, tz: sz })

    // Retrovisores: hastes pretas + espelho prateado
    for(const sz of [ -0.71, 0.71 ])
        addGeo(commonParts, new THREE.BoxGeometry(0.05, 0.04, 0.12), UV.dark, { tx: 0.40, ty: 0.34, tz: sz })

    // Moldura escura do teto solar panoramico
    addGeo(commonParts, new THREE.BoxGeometry(0.46, 0.03, 0.84), UV.dark, { tx: -0.04, ty: 0.735, tz: 0 })

    // === INTERIOR VISIVEL DA CABINE ===
    // Painel + console central
    addGeo(commonParts, new THREE.BoxGeometry(0.20, 0.18, 1.06), UV.charcoal, { tx: 0.34, ty: 0.24, tz: 0 })
    // Volante inclinado no lado esquerdo (-Z no eixo do carro? Esquerda olhando para +X e -Z!)
    addGeo(commonParts, new THREE.TorusGeometry(0.105, 0.020, 8, 18), UV.ivory, { tx: 0.22, ty: 0.37, tz: -0.26, ry: Math.PI * 0.5 })
    addGeo(commonParts, new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), UV.dark, { tx: 0.28, ty: 0.34, tz: -0.26, rz: Math.PI * 0.35 })

    // Bancos dianteiros esportivos + encostos de cabeca
    for(const sz of [ -0.26, 0.26 ])
    {
        addGeo(commonParts, new THREE.BoxGeometry(0.24, 0.09, 0.28), UV.charcoal, { tx: 0.06, ty: 0.06, tz: sz })
        addGeo(commonParts, new THREE.BoxGeometry(0.09, 0.30, 0.26), UV.charcoal, { tx: -0.04, ty: 0.24, tz: sz, rz: 0.18 })
        addGeo(commonParts, new THREE.BoxGeometry(0.07, 0.11, 0.16), UV.ivory, { tx: -0.07, ty: 0.43, tz: sz, rz: 0.12 })
    }
    // Banco traseiro crew-cab + 2 apoios
    addGeo(commonParts, new THREE.BoxGeometry(0.22, 0.09, 0.92), UV.charcoal, { tx: -0.24, ty: 0.06, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.08, 0.28, 0.92), UV.charcoal, { tx: -0.33, ty: 0.24, tz: 0, rz: 0.12 })
    for(const sz of [ -0.26, 0.26 ])
        addGeo(commonParts, new THREE.BoxGeometry(0.07, 0.10, 0.16), UV.ivory, { tx: -0.35, ty: 0.42, tz: sz })

    // === CACAMBA TRASEIRA (BEDLINER + BORDAS + SANTO-ANTONIO + PARA-CHOQUE TRASEIRO) ===
    // Piso protetor escuro da cacamba (em y = 0.08, livre para os trofeus)
    addGeo(commonParts, new THREE.BoxGeometry(0.96, 0.06, 1.06), UV.dark, { tx: -0.92, ty: 0.05, tz: 0 })
    for(const gz of [ -0.38, -0.19, 0, 0.19, 0.38 ])
        addGeo(commonParts, new THREE.BoxGeometry(0.92, 0.015, 0.04), UV.charcoal, { tx: -0.92, ty: 0.085, tz: gz })

    // Protetores pretos das bordas da cacamba e tampa
    for(const sz of [ -0.61, 0.61 ])
        addGeo(commonParts, new THREE.BoxGeometry(1.04, 0.035, 0.14), UV.dark, { tx: -0.94, ty: 0.295, tz: sz })
    addGeo(commonParts, new THREE.BoxGeometry(0.11, 0.035, 1.24), UV.dark, { tx: -1.44, ty: 0.295, tz: 0 })
    // Macaneta + aplique escuro na tampa traseira
    addGeo(commonParts, new THREE.BoxGeometry(0.03, 0.12, 0.90), UV.charcoal, { tx: -1.50, ty: 0.12, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.04, 0.045, 0.22), UV.ivory, { tx: -1.515, ty: 0.12, tz: 0 })

    // Santo-antonio esportivo compacto logo atras dos pilares C (deixa a cacamba livre)
    for(const sz of [ -0.56, 0.56 ])
    {
        addGeo(commonParts, new THREE.BoxGeometry(0.12, 0.36, 0.07), UV.charcoal, { tx: -0.45, ty: 0.45, tz: sz, rz: 0.32 })
        addGeo(commonParts, new THREE.BoxGeometry(0.42, 0.06, 0.06), UV.charcoal, { tx: -0.64, ty: 0.38, tz: sz, rz: -0.42 })
    }
    addGeo(commonParts, new THREE.BoxGeometry(0.10, 0.06, 1.18), UV.charcoal, { tx: -0.42, ty: 0.60, tz: 0 })

    // Para-choque traseiro steel + 2 ponteiras de escapamento cromadas + engate dourado
    addGeo(commonParts, new THREE.BoxGeometry(0.20, 0.15, 1.40), UV.charcoal, { tx: -1.46, ty: -0.17, tz: 0 })
    addGeo(commonParts, new THREE.BoxGeometry(0.14, 0.08, 0.22), UV.gold, { tx: -1.50, ty: -0.22, tz: 0 })
    for(const sz of [ -0.46, 0.46 ])
        addGeo(commonParts, new THREE.CylinderGeometry(0.052, 0.052, 0.20, 12), UV.chrome, { tx: -1.48, ty: -0.24, tz: sz, rz: Math.PI * 0.5 })

    const prim = partsToPrimitive(doc, matPalette, commonParts)
    chassisNode.addChild(doc.createNode('common').setMesh(doc.createMesh('common').addPrimitive(prim)))
}

// 3. Farois C-Clamp LED dianteiros + neblina + marcador TRX no capo (`headlights`)
{
    const parts = []
    for(const sz of [ -0.56, 0.56 ])
    {
        const s = Math.sign(sz)
        // Barra LED C-clamp vertical externa + segmentos horizontais
        addGeo(parts, new THREE.BoxGeometry(0.05, 0.22, 0.045), [0.5, 0.5], { tx: 1.46, ty: 0.06, tz: sz + s * 0.07 })
        addGeo(parts, new THREE.BoxGeometry(0.05, 0.04, 0.16), [0.5, 0.5], { tx: 1.46, ty: 0.15, tz: sz })
        addGeo(parts, new THREE.BoxGeometry(0.05, 0.04, 0.16), [0.5, 0.5], { tx: 1.46, ty: -0.03, tz: sz })
        // Projetor duplo interno
        addGeo(parts, new THREE.BoxGeometry(0.05, 0.10, 0.10), [0.5, 0.5], { tx: 1.45, ty: 0.06, tz: sz - s * 0.01 })
        // Farol de neblina no para-choque
        addGeo(parts, new THREE.BoxGeometry(0.05, 0.065, 0.14), [0.5, 0.5], { tx: 1.54, ty: -0.16, tz: sz - s * 0.04 })
    }
    // 3 luzes de gabarito na entrada do capo TRX
    for(const tz of [ -0.10, 0, 0.10 ])
        addGeo(parts, new THREE.BoxGeometry(0.04, 0.03, 0.055), [0.5, 0.5], { tx: 1.27, ty: 0.295, tz })

    const prim = partsToPrimitive(doc, matWhiteEmissive, parts)
    chassisNode.addChild(doc.createNode('headlights').setMesh(doc.createMesh('headlights').addPrimitive(prim)))
}

// 4. Lanternas traseiras verticais de picape, 3a luz de freio e setas
{
    const backParts = []
    for(const sz of [ -0.60, 0.60 ])
        addGeo(backParts, new THREE.BoxGeometry(0.06, 0.28, 0.13), [0.5, 0.5], { tx: -1.49, ty: 0.06, tz: sz })
    chassisNode.addChild(doc.createNode('backLights').setMesh(doc.createMesh('backLights').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, backParts))))

    const stopParts = []
    addGeo(stopParts, new THREE.BoxGeometry(0.05, 0.05, 0.42), [0.5, 0.5], { tx: -0.40, ty: 0.69, tz: 0 })
    chassisNode.addChild(doc.createNode('stopLights').setMesh(doc.createMesh('stopLights').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, stopParts))))

    const leftParts = []
    addGeo(leftParts, new THREE.BoxGeometry(0.06, 0.05, 0.11), [0.5, 0.5], { tx: 1.46, ty: -0.02, tz: -0.62 })
    addGeo(leftParts, new THREE.BoxGeometry(0.06, 0.10, 0.11), [0.5, 0.5], { tx: -1.50, ty: 0.14, tz: -0.61 })
    chassisNode.addChild(doc.createNode('blinkerLeft').setMesh(doc.createMesh('blinkerLeft').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, leftParts))))

    const rightParts = []
    addGeo(rightParts, new THREE.BoxGeometry(0.06, 0.05, 0.11), [0.5, 0.5], { tx: 1.46, ty: -0.02, tz: 0.62 })
    addGeo(rightParts, new THREE.BoxGeometry(0.06, 0.10, 0.11), [0.5, 0.5], { tx: -1.50, ty: 0.14, tz: 0.61 })
    chassisNode.addChild(doc.createNode('blinkerRight').setMesh(doc.createMesh('blinkerRight').addPrimitive(partsToPrimitive(doc, matOrangeEmissive, rightParts))))
}

// 5. Faixa de energia lateral + 3 celulas integradas ao santo-antonio
{
    const energyParts = []
    for(const sz of [ -0.68, 0.68 ])
        addGeo(energyParts, new THREE.BoxGeometry(0.76, 0.04, 0.04), [0.5, 0.5], { tx: 0.00, ty: -0.06, tz: sz })
    const prim = partsToPrimitive(doc, matDarkGray, energyParts, { twoUV: true })
    chassisNode.addChild(doc.createNode('energy').setMesh(doc.createMesh('energy').addPrimitive(prim)))

    const cellPositionsZ = [ -0.18, 0.0, 0.18 ]
    for(let i = 0; i < 3; i++)
    {
        const cellNode = doc.createNode(`cell${i + 1}`).setTranslation([ 0, 0.2, 0 ])
        const cagePrim = partsToPrimitive(doc, matPalette, [
            { geometry: (() => { const g = new THREE.BoxGeometry(0.09, 0.08, 0.09); g.translate(-0.42, 0.63, cellPositionsZ[i]); return g })(), uv: UV.chrome }
        ])
        const corePrim = partsToPrimitive(doc, matBlueEmissive, [
            { geometry: (() => { const g = new THREE.BoxGeometry(0.06, 0.10, 0.06); g.translate(-0.42, 0.65, cellPositionsZ[i]); return g })(), uv: [0.5, 0.5] }
        ])
        cellNode.addChild(doc.createNode(`cellsCage.${i + 1}`).setMesh(doc.createMesh(`cellsCage.${i + 1}`).addPrimitive(cagePrim)))
        cellNode.addChild(doc.createNode(`cellsEnergy.${i + 1}`).setMesh(doc.createMesh(`cellsEnergy.${i + 1}`).addPrimitive(corePrim)))
        chassisNode.addChild(cellNode)
    }
}

// 6. Rodas Off-Road Cravudas + Aro Deep-Dish + Mola Helicoidal 3D Vermelha (`wheelContainer`)
{
    const wheelContainer = doc.createNode('wheelContainer').setTranslation([ 0.9, -0.42, -0.75 ])
    scene.addChild(wheelContainer)

    const wheelCylinder = doc.createNode('wheelCylinder')
    wheelContainer.addChild(wheelCylinder)

    const tireParts = []
    // Carcaca principal do pneu todo-terreno
    addGeo(tireParts, new THREE.CylinderGeometry(0.415, 0.415, 0.40, 26), UV.dark, { rx: Math.PI * 0.5 })
    // Ombros arredondados para cara de pneu de brinquedo musculoso
    for(const sz of [ -0.17, 0.17 ])
        addGeo(tireParts, new THREE.TorusGeometry(0.365, 0.06, 8, 24), UV.dark, { tz: sz })

    // 18 cravos escalonados de banda off-road
    for(let t = 0; t < 18; t++)
    {
        const ang = (t / 18) * Math.PI * 2
        const lugOffsetZ = (t % 2 === 0 ? -0.075 : 0.075)
        addGeo(tireParts, new THREE.BoxGeometry(0.075, 0.048, 0.22), UV.charcoal, {
            tx: Math.cos(ang) * 0.42,
            ty: Math.sin(ang) * 0.42,
            tz: lugOffsetZ,
            rz: ang - Math.PI * 0.5,
        })
    }

    // Cubo concavo + 6 raios de liga leve off-road
    addGeo(tireParts, new THREE.CylinderGeometry(0.24, 0.24, 0.34, 18), UV.dark, { rx: Math.PI * 0.5 })
    addGeo(tireParts, new THREE.CylinderGeometry(0.11, 0.11, 0.41, 14), UV.gunmetal, { rx: Math.PI * 0.5 })
    for(let k = 0; k < 6; k++)
    {
        const ang = (k / 6) * Math.PI * 2
        addGeo(tireParts, new THREE.BoxGeometry(0.22, 0.058, 0.045), UV.chrome, {
            tx: Math.cos(ang) * 0.125,
            ty: Math.sin(ang) * 0.125,
            tz: -0.19,
            rz: ang,
        })
    }
    wheelCylinder.addChild(doc.createNode('wheel').setMesh(doc.createMesh('wheel').addPrimitive(partsToPrimitive(doc, matPalette, tireParts))))

    // Aro beadlock externo & calota central com pintura do veiculo
    const paintedParts = []
    addGeo(paintedParts, new THREE.TorusGeometry(0.245, 0.032, 8, 22), [0.5, 0.5], { tz: -0.205 })
    addGeo(paintedParts, new THREE.CylinderGeometry(0.068, 0.068, 0.045, 12), [0.5, 0.5], { rx: Math.PI * 0.5, tz: -0.21 })
    wheelCylinder.addChild(doc.createNode('wheelPainted').setMesh(doc.createMesh('wheelPainted').addPrimitive(partsToPrimitive(doc, matRed, paintedParts))))

    // Amortecedor telescopico + Mola Helicoidal 3D visivel acima do cubo!
    const suspShaftParts = []
    addGeo(suspShaftParts, new THREE.CylinderGeometry(0.048, 0.048, 0.72, 10), UV.chrome, { tx: 0, ty: 0.38, tz: 0.05 })
    addGeo(suspShaftParts, new THREE.CylinderGeometry(0.095, 0.095, 0.12, 10), UV.dark, { tx: 0, ty: 0.10, tz: 0.05 })

    const coilGeo = new THREE.TubeGeometry(new HelixCurve(0.095, 0.54, 5.5), 48, 0.024, 6, false)
    coilGeo.translate(0, 0.16, 0.05)
    const suspCoilParts = [ { geometry: coilGeo, uv: [0.5, 0.5] } ]

    const suspMesh = doc.createMesh('wheelSuspension')
        .addPrimitive(partsToPrimitive(doc, matPalette, suspShaftParts))
        .addPrimitive(partsToPrimitive(doc, matRed, suspCoilParts, { twoUV: true }))
    wheelContainer.addChild(doc.createNode('wheelSuspension').setTranslation([ 0, 0.34, 0 ]).setMesh(suspMesh))
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE)
await io.write(vehiclePath, doc)
console.log(`Dodge RAM Die-Cast salvo em ${vehiclePath} (${(statSync(vehiclePath).size / 1024).toFixed(1)} KB)`)
