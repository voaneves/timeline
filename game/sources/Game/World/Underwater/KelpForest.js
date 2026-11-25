import * as THREE from 'three/webgpu'
import { attribute, color, cos, float, Fn, max, mix, positionLocal, sin, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl'
import { Game } from '../../Game.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'

/**
 * Floresta de algas marinhas altas (kelp) com hash travado no mundo (sem jitter),
 * ondulacao em S por correnteza oceanica e abertura fisica ao redor do submarino.
 */
export class KelpForest
{
    constructor(parentGroup)
    {
        this.game = Game.getInstance()
        this.parentGroup = parentGroup

        this.isHighQuality = (this.game.quality?.level ?? 0) === 0
        this.gridSide = this.isHighQuality ? 72 : 44
        this.spacing = this.isHighQuality ? 0.95 : 1.45
        this.halfRadius = this.gridSide * this.spacing * 0.5

        this.centerCell = uniform(vec2(0, 0))
        this.centerOffset = uniform(vec2(0, 0))
        this.vehiclePos = uniform(vec3(0, 0, 0))

        this.setGeometry()
        this.setMaterial()
        this.setMesh()
    }

    setGeometry()
    {
        const positions = []
        const normals = []
        const uvs = []
        const indices = []

        const bladeSpecs = [
            { rot: 0.2, lean: 0.25, ox: -0.05, oz: 0.03, h: 1.0, w: 0.15 },
            { rot: 2.1, lean: 0.22, ox: 0.05, oz: -0.04, h: 0.82, w: 0.13 },
        ]
        const segments = 4
        const height = 3.2

        let vertOffset = 0
        for(const spec of bladeSpecs)
        {
            const ca = Math.cos(spec.rot)
            const sa = Math.sin(spec.rot)
            const hBlade = height * spec.h

            for(let s = 0; s <= segments; s++)
            {
                const t = s / segments
                const taper = Math.max(0.08, Math.sin(t * Math.PI * 0.85 + 0.2))
                const w = spec.w * taper
                const y = t * hBlade
                const bend = Math.sin(t * Math.PI) * spec.lean

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

        const rootColor = color('#0e5e4d')
        const midColor = color('#1eb38e')
        const tipColor = color('#7bf2cf')

        const colorNode = Fn(() =>
        {
            const h = uv().y
            const baseToMid = mix(rootColor, midColor, smoothstep(float(0.0), float(0.55), h))
            return mix(baseToMid, tipColor, smoothstep(float(0.5), float(1.0), h))
        })()

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

            const rx = sin(worldCell.x.mul(12.9898).add(worldCell.y.mul(78.233))).mul(43758.5453).fract()
            const rz = sin(worldCell.x.mul(39.346).add(worldCell.y.mul(11.135))).mul(24634.6345).fract()
            const ra = sin(worldCell.x.mul(73.156).add(worldCell.y.mul(52.235))).mul(65432.1234).fract()

            const jitter = vec2(rx.sub(0.5), rz.sub(0.5)).mul(this.spacing * 0.9)
            const localAnchorXZ = aGridOffset.mul(this.spacing).add(jitter)
            const worldXZ = this.centerOffset.add(localAnchorXZ)

            // Manchas de kelp (agrupamentos naturais, deixando clareiras e a praca central livres)
            const patchNoise = texture(this.game.noises.perlin, worldXZ.mul(0.032)).r
            const patchMask = smoothstep(float(0.46), float(0.68), patchNoise)

            // Clareira ao redor do spawn/farol (0, 18) e limite da bacia (r < 72)
            const spawnDist = worldXZ.sub(vec2(0, 18)).length()
            const spawnClear = smoothstep(float(12), float(20), spawnDist)
            const basinDist = worldXZ.length()
            const basinMask = smoothstep(float(76), float(64), basinDist)

            const radialDist = localAnchorXZ.length()
            const edgeFade = smoothstep(float(this.halfRadius * 0.98), float(this.halfRadius * 0.72), radialDist)

            const heightRand = float(0.65).add(ra.mul(0.65))
            const bladeScale = patchMask.mul(spawnClear).mul(basinMask).mul(edgeFade).mul(heightRand)

            // Altura do solo submarino (sincronizada com sampleSeabedHeight em UnderwaterWorld)
            const plazaClear = smoothstep(float(12), float(26), worldXZ.length())
            const dunes = sin(worldXZ.x.mul(0.075)).mul(cos(worldXZ.y.mul(0.08))).mul(1.1)
                .add(sin(worldXZ.x.mul(0.035).add(worldXZ.y.mul(0.045))).mul(0.7))
            const groundY = dunes.mul(plazaClear)

            const angle = ra.mul(Math.PI * 2)
            const ca = cos(angle)
            const sa = sin(angle)

            const localPos = positionLocal.toVar()
            const rxPos = localPos.x.mul(ca).sub(localPos.z.mul(sa))
            const rzPos = localPos.x.mul(sa).add(localPos.z.mul(ca))

            // Correnteza submarina em onda S
            const h = uv().y
            const t = this.game.ticker.elapsedScaledUniform
            const waveX = sin(t.mul(1.25).add(worldXZ.x.mul(0.18)).add(h.mul(3.4))).mul(0.48)
            const waveZ = cos(t.mul(1.05).add(worldXZ.y.mul(0.16)).add(h.mul(3.0))).mul(0.42)
            const tipFactor = h.mul(h)

            // Desvio suave ao redor do submarino
            const toBlade = worldXZ.sub(this.vehiclePos.xz)
            const distToSub = max(toBlade.length(), float(0.001))
            const pushDir = toBlade.div(distToSub)
            const pushAmount = smoothstep(float(3.2), float(0.8), distToSub).mul(tipFactor).mul(bladeScale)

            const finalX = rxPos.mul(bladeScale).add(localAnchorXZ.x).add(waveX.mul(tipFactor).mul(bladeScale)).add(pushDir.x.mul(pushAmount).mul(0.95))
            const finalY = localPos.y.mul(bladeScale).add(groundY)
            const finalZ = rzPos.mul(bladeScale).add(localAnchorXZ.y).add(waveZ.mul(tipFactor).mul(bladeScale)).add(pushDir.y.mul(pushAmount).mul(0.95))

            return vec3(finalX, finalY, finalZ)
        })()
    }

    setMesh()
    {
        this.mesh = new THREE.Mesh(this.geometry, this.material)
        this.mesh.frustumCulled = false
        this.mesh.receiveShadow = true
        this.mesh.castShadow = false
        this.parentGroup.add(this.mesh)
    }

    update()
    {
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
