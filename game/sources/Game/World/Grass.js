import * as THREE from 'three/webgpu'
import { attribute, color, cos, float, Fn, hash, instanceIndex, mix, positionLocal, positionWorld, sin, smoothstep, step, texture, uniform, uv, vec2, vec3 } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

export class Grass
{
    constructor()
    {
        this.game = Game.getInstance()

        this.isHighQuality = (this.game.quality?.level ?? 0) === 0
        this.gridSide = this.isHighQuality ? 72 : 38
        this.spacing = this.isHighQuality ? 0.55 : 0.95
        this.centerOffset = uniform(vec2(0, 0))

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

        const bladeSpecs = this.isHighQuality
            ? [
                { rot: 0.0, lean: 0.14, ox: 0.0, oz: 0.0, h: 1.0 },
                { rot: 2.1, lean: 0.16, ox: 0.04, oz: -0.03, h: 0.85 },
                { rot: 4.2, lean: 0.15, ox: -0.04, oz: 0.04, h: 0.78 },
            ]
            : [
                { rot: 0.0, lean: 0.14, ox: 0.0, oz: 0.0, h: 1.0 },
                { rot: 2.4, lean: 0.15, ox: 0.03, oz: 0.03, h: 0.85 },
            ]

        const segments = this.isHighQuality ? 3 : 2
        const baseHalfWidth = 0.055
        const height = 0.45

        let vertOffset = 0
        for(const spec of bladeSpecs)
        {
            const ca = Math.cos(spec.rot)
            const sa = Math.sin(spec.rot)
            const hBlade = height * spec.h

            for(let s = 0; s <= segments; s++)
            {
                const t = s / segments
                const w = baseHalfWidth * (1 - t * 0.92)
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
        const offsets = new Float32Array(count * 2)
        const randoms = new Float32Array(count * 2)
        const halfSpan = (this.gridSide - 1) * this.spacing * 0.5

        let idx = 0
        for(let gx = 0; gx < this.gridSide; gx++)
        {
            for(let gz = 0; gz < this.gridSide; gz++)
            {
                const rx = ((Math.sin(idx * 12.9898) * 43758.5453) % 1 + 1) % 1
                const rz = ((Math.sin(idx * 78.233) * 24634.6345) % 1 + 1) % 1

                offsets[idx * 2 + 0] = gx * this.spacing - halfSpan + (rx - 0.5) * this.spacing * 0.85
                offsets[idx * 2 + 1] = gz * this.spacing - halfSpan + (rz - 0.5) * this.spacing * 0.85

                randoms[idx * 2 + 0] = rx * Math.PI * 2
                randoms[idx * 2 + 1] = 0.75 + rz * 0.55

                idx++
            }
        }

        this.geometry = new THREE.InstancedBufferGeometry()
        this.geometry.index = baseGeometry.index
        this.geometry.attributes.position = baseGeometry.attributes.position
        this.geometry.attributes.normal = baseGeometry.attributes.normal
        this.geometry.attributes.uv = baseGeometry.attributes.uv
        this.geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2))
        this.geometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randoms, 2))
        this.geometry.instanceCount = count
    }

    setMaterial()
    {
        const aOffset = attribute('aOffset', 'vec2')
        const aRandom = attribute('aRandom', 'vec2')

        const baseColor = color('#468c2e')
        const midColor = color('#76c442')
        const tipColor = color('#b7eb5d')
        const gradientY = uv().y
        const grassColor = mix(
            mix(baseColor, midColor, smoothstep(float(0.0), float(0.55), gradientY)),
            tipColor,
            smoothstep(float(0.5), float(1.0), gradientY)
        )

        this.material = new MeshDefaultMaterial({
            colorNode: grassColor,
            normalNode: vec3(0, 1, 0),
            side: THREE.DoubleSide,
            hasCoreShadows: true,
            hasDropShadows: true,
            hasLightBounce: false,
            hasWater: false,
            hasFog: true,
            hasReveal: true
        })

        this.material.positionNode = Fn(() =>
        {
            const worldXZ = this.centerOffset.add(aOffset)
            const terrainData = this.game.terrain.terrainNode(worldXZ)

            const dryMask = step(terrainData.b, float(0.08))
            const bladeScale = terrainData.g.mul(dryMask).mul(aRandom.y)

            const angle = aRandom.x
            const ca = cos(angle)
            const sa = sin(angle)

            const localPos = positionLocal.toVar()
            const rx = localPos.x.mul(ca).sub(localPos.z.mul(sa))
            const rz = localPos.x.mul(sa).add(localPos.z.mul(ca))

            const tipFactor = uv().y.mul(uv().y)
            const windUv = worldXZ.mul(0.05).add(this.game.wind.direction.mul(this.game.wind.localTime.mul(0.08)))
            const windNoise = texture(this.game.noises.perlin, windUv).r.sub(0.5).mul(2.0)
            const sway = windNoise.mul(this.game.wind.strength).mul(tipFactor).mul(0.35)

            const finalX = rx.mul(bladeScale).add(aOffset.x).add(this.game.wind.direction.x.mul(sway))
            const finalY = localPos.y.mul(bladeScale)
            const finalZ = rz.mul(bladeScale).add(aOffset.y).add(this.game.wind.direction.y.mul(sway))

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
        const snap = this.spacing
        const cx = Math.round(this.game.view.optimalArea.position.x / snap) * snap
        const cz = Math.round(this.game.view.optimalArea.position.z / snap) * snap

        this.mesh.position.x = cx
        this.mesh.position.z = cz
        this.centerOffset.value.set(cx, cz)
    }
}
