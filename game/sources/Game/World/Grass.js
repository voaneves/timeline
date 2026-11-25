import * as THREE from 'three/webgpu'
import { attribute, color, cos, float, Fn, max, mix, positionLocal, positionWorld, sin, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

/**
 * Grama estilizada em alta densidade com hash travado no mundo (sem cintilacao ao mover),
 * curvatura organica em leque, ondas de vento e abertura fisica ao redor do veiculo.
 */
export class Grass
{
    constructor()
    {
        this.game = Game.getInstance()

        this.isHighQuality = (this.game.quality?.level ?? 0) === 0
        this.gridSide = this.isHighQuality ? 148 : 84
        this.spacing = this.isHighQuality ? 0.28 : 0.44
        this.halfRadius = this.gridSide * this.spacing * 0.5

        this.centerCell = uniform(vec2(0, 0))
        this.centerOffset = uniform(vec2(0, 0))
        this.vehiclePos = uniform(vec3(0, 0, 0))

        this.setGeometry()
        this.setMaterial()
        this.setMesh()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    setGeometry()
    {
        const positions = []
        const normals = []
        const uvs = []
        const indices = []

        // Tufo em leque cruzado: 2 laminas curvadas em angulo para volume visto de cima e de lado
        const bladeSpecs = this.isHighQuality
            ? [
                { rot: 0.15, lean: 0.18, ox: -0.02, oz: 0.01, h: 1.0, w: 0.082 },
                { rot: 1.35, lean: 0.16, ox: 0.03, oz: -0.02, h: 0.86, w: 0.072 },
            ]
            : [
                { rot: 0.2, lean: 0.17, ox: 0.0, oz: 0.0, h: 1.0, w: 0.09 },
                { rot: 1.5, lean: 0.15, ox: 0.02, oz: -0.02, h: 0.84, w: 0.078 },
            ]

        const segments = this.isHighQuality ? 3 : 2
        const height = 0.50

        let vertOffset = 0
        for(const spec of bladeSpecs)
        {
            const ca = Math.cos(spec.rot)
            const sa = Math.sin(spec.rot)
            const hBlade = height * spec.h

            for(let s = 0; s <= segments; s++)
            {
                const t = s / segments
                // Afilamento suave ate ponta nitida (estilo infinite-terrain)
                const taper = Math.max(0.03, 1 - Math.pow(t, 1.35))
                const w = spec.w * taper
                const y = t * hBlade
                const bend = t * t * spec.lean

                positions.push(
                    (-w) * ca - bend * sa + spec.ox, y, (-w) * sa + bend * ca + spec.oz,
                    w * ca - bend * sa + spec.ox, y, w * sa + bend * ca + spec.oz
                )
                normals.push(0, 1, 0, 0, 1, 0)
                uvs.push(0, t, 1, t)
            }

            for(let s = 0; s < segments; s++)
            {
                const a = vertOffset + s * 2
                const b = a + 1
                const c = a + 2
                const d = a + 3
                indices.push(a, b, c, b, d, c)
            }

            vertOffset += (segments + 1) * 2
        }

        const baseGeometry = new THREE.BufferGeometry()
        baseGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        baseGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
        baseGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
        baseGeometry.setIndex(indices)

        const count = this.gridSide * this.gridSide
        const gridOffsets = new Float32Array(count * 2)
        const halfGrid = Math.floor(this.gridSide * 0.5)

        let idx = 0
        for(let gx = 0; gx < this.gridSide; gx++)
        {
            for(let gz = 0; gz < this.gridSide; gz++)
            {
                gridOffsets[idx * 2 + 0] = gx - halfGrid
                gridOffsets[idx * 2 + 1] = gz - halfGrid
                idx++
            }
        }

        this.geometry = new THREE.InstancedBufferGeometry()
        this.geometry.index = baseGeometry.index
        this.geometry.attributes.position = baseGeometry.attributes.position
        this.geometry.attributes.normal = baseGeometry.attributes.normal
        this.geometry.attributes.uv = baseGeometry.attributes.uv
        this.geometry.setAttribute('aGridOffset', new THREE.InstancedBufferAttribute(gridOffsets, 2))
        this.geometry.instanceCount = count
    }

    setMaterial()
    {
        const aGridOffset = attribute('aGridOffset', 'vec2')

        // Paleta da grama integrada ao solo do Terrain.js (#76c442) + gradiente rico com AO na base e brilho solar na ponta
        const rootColor = color('#418529')
        const midGreenA = color('#68b83c')
        const midGreenB = color('#84d147')
        const tipColor = color('#ccf56c')

        const colorNode = Fn(() =>
        {
            const h = uv().y

            // Variacao de manchas naturais no gramado via Perlin
            const patchNoise = texture(this.game.noises.perlin, positionWorld.xz.mul(0.045)).r
            const midColor = mix(midGreenA, midGreenB, smoothstep(float(0.3), float(0.7), patchNoise))

            // Onda suave de vento iluminando cristas das laminas
            const windWaveUv = positionWorld.xz.mul(0.065).add(this.game.wind.direction.mul(this.game.wind.localTime.mul(1.0)))
            const windCrest = texture(this.game.noises.perlin, windWaveUv).r.smoothstep(0.45, 0.85)

            const baseToMid = mix(rootColor, midColor, smoothstep(float(0.0), float(0.48), h))
            const sunTip = mix(baseToMid, tipColor, smoothstep(float(0.45), float(1.0), h))
            return mix(sunTip, color('#e4ff8a'), windCrest.mul(h).mul(this.game.wind.strength).mul(0.55))
        })()

        // hasCoreShadows: false evita escurecimento de faces traseiras em DoubleSide; drop shadows mantidas!
        this.material = new MeshDefaultMaterial({
            colorNode,
            normalNode: vec3(0, 1, 0),
            side: THREE.DoubleSide,
            hasCoreShadows: false,
            hasDropShadows: true,
            hasLightBounce: false,
            hasWater: false,
            hasFog: true,
            hasReveal: true,
        })

        this.material.positionNode = Fn(() =>
        {
            const worldCell = this.centerCell.add(aGridOffset)

            // Hash deterministico travado na celula do mundo (0 cintilacao ao mover a camera)
            const rx = sin(worldCell.x.mul(12.9898).add(worldCell.y.mul(78.233))).mul(43758.5453).fract()
            const rz = sin(worldCell.x.mul(39.346).add(worldCell.y.mul(11.135))).mul(24634.6345).fract()
            const ra = sin(worldCell.x.mul(73.156).add(worldCell.y.mul(52.235))).mul(65432.1234).fract()

            const jitter = vec2(rx.sub(0.5), rz.sub(0.5)).mul(this.spacing * 0.92)
            const localAnchorXZ = aGridOffset.mul(this.spacing).add(jitter)
            const worldXZ = this.centerOffset.add(localAnchorXZ)

            // Amostragem direta do terreno + trilhas de pneu
            const terrainData = this.game.terrain.terrainNode(worldXZ)
            const grassMask = smoothstep(float(0.14), float(0.55), terrainData.g)
            const dryMask = smoothstep(float(0.08), float(0.01), terrainData.b)
            const roadMask = smoothstep(float(0.55), float(0.18), terrainData.r)

            // Fade suave nas bordas do anel da camera
            const radialDist = localAnchorXZ.length()
            const edgeFade = smoothstep(float(this.halfRadius * 0.98), float(this.halfRadius * 0.70), radialDist)

            const heightRandom = float(0.72).add(ra.mul(0.62))
            const bladeScale = grassMask.mul(dryMask).mul(roadMask).mul(edgeFade).mul(heightRandom)

            // Rotacao aleatoria por tufo
            const angle = ra.mul(Math.PI * 2)
            const ca = cos(angle)
            const sa = sin(angle)

            const localPos = positionLocal.toVar()
            const rxPos = localPos.x.mul(ca).sub(localPos.z.mul(sa))
            const rzPos = localPos.x.mul(sa).add(localPos.z.mul(ca))

            // Vento em duas camadas (sincronizado com Wind.localTime)
            const tipFactor = uv().y.mul(uv().y)
            const windUv1 = worldXZ.mul(0.055).add(this.game.wind.direction.mul(this.game.wind.localTime.mul(1.0)))
            const windUv2 = worldXZ.mul(0.14).sub(this.game.wind.direction.mul(this.game.wind.localTime.mul(1.65)))
            const n1 = texture(this.game.noises.perlin, windUv1).r.sub(0.45)
            const n2 = texture(this.game.noises.perlin, windUv2).r.sub(0.5).mul(0.45)
            const sway = n1.add(n2).mul(this.game.wind.strength).mul(tipFactor).mul(0.42).mul(bladeScale)

            // Abertura fisica ao redor do carro
            const toBlade = worldXZ.sub(this.vehiclePos.xz)
            const distToCar = max(toBlade.length(), float(0.001))
            const pushDir = toBlade.div(distToCar)
            const pushAmount = smoothstep(float(2.3), float(0.65), distToCar).mul(tipFactor).mul(bladeScale)
            const flattenY = float(1).sub(pushAmount.mul(0.55))

            const groundY = terrainData.b.mul(-1.5)
            const finalX = rxPos.mul(bladeScale).add(localAnchorXZ.x).add(this.game.wind.direction.x.mul(sway)).add(pushDir.x.mul(pushAmount).mul(0.55))
            const finalY = localPos.y.mul(bladeScale).mul(flattenY).add(groundY)
            const finalZ = rzPos.mul(bladeScale).add(localAnchorXZ.y).add(this.game.wind.direction.y.mul(sway)).add(pushDir.y.mul(pushAmount).mul(0.55))

            return vec3(finalX, finalY, finalZ)
        })()
    }

    setMesh()
    {
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.frustumCulled = false
        this.mesh.receiveShadow = true
        this.mesh.castShadow = false
        this.game.scene.add(this.mesh)
    }

    update()
    {
        if(this.game.worldManager?.isUnderwater)
            return

        const cellX = Math.round(this.game.view.optimalArea.position.x / this.spacing)
        const cellZ = Math.round(this.game.view.optimalArea.position.z / this.spacing)
        const offsetX = cellX * this.spacing
        const offsetZ = cellZ * this.spacing

        this.mesh.position.set(offsetX, 0, offsetZ)
        this.centerCell.value.set(cellX, cellZ)
        this.centerOffset.value.set(offsetX, offsetZ)

        if(this.game.physicalVehicle)
            this.vehiclePos.value.copy(this.game.physicalVehicle.position)
    }
}
