import * as THREE from 'three/webgpu'
import { attribute, color, float, Fn, instancedArray, mix, positionLocal, sin, smoothstep, step, uniform, uv, vec3, vec4 } from 'three/tsl'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Game } from '../../Game.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'

/**
 * Cardumes de peixes estilizados e bolhas subaquaticas ascendentes.
 */
export class MarineLife
{
    constructor(parentGroup)
    {
        this.game = Game.getInstance()
        this.parentGroup = parentGroup
        this.timeUniform = uniform(0)

        this.setSchools()
        this.setBubbles()
    }

    setSchools()
    {
        // Geometria estilizada de peixe (+X frente, cauda em -X)
        const body = new THREE.ConeGeometry(0.16, 0.56, 6)
        body.rotateZ(-Math.PI * 0.5)
        body.scale(1.0, 0.85, 0.55)

        const tail = new THREE.ConeGeometry(0.14, 0.24, 4)
        tail.rotateZ(Math.PI * 0.5)
        tail.scale(1.0, 1.1, 0.35)
        tail.translate(-0.34, 0, 0)

        const geo = mergeGeometries([ body, tail ])
        body.dispose()
        tail.dispose()

        const palette = [
            new THREE.Color('#ff7b54'),
            new THREE.Color('#ffd166'),
            new THREE.Color('#34cfc4'),
            new THREE.Color('#7ce8ff'),
        ]

        const count = 64
        const colors = new Float32Array(count * 3)
        for(let i = 0; i < count; i++)
        {
            const c = palette[i % palette.length]
            colors[i * 3 + 0] = c.r
            colors[i * 3 + 1] = c.g
            colors[i * 3 + 2] = c.b
        }

        geo.setAttribute('aFishColor', new THREE.InstancedBufferAttribute(colors, 3))

        const aFishColor = attribute('aFishColor', 'vec3')
        const mat = new MeshDefaultMaterial({
            colorNode: aFishColor,
            hasWater: false,
            hasLightBounce: false,
            hasDropShadows: false
        })

        mat.positionNode = Fn(() =>
        {
            const p = positionLocal.toVar()
            const tailMask = smoothstep(float(0.05), float(-0.42), p.x)
            p.z.addAssign(sin(this.timeUniform.mul(9.0)).mul(tailMask).mul(0.08))
            return p
        })()

        this.fishMesh = new THREE.InstancedMesh(geo, mat, count)
        this.fishMesh.frustumCulled = false
        this.parentGroup.add(this.fishMesh)

        const centers = [
            new THREE.Vector3(-22, 3.8, -12),
            new THREE.Vector3(24, 4.4, -18),
            new THREE.Vector3(-18, 4.0, -44),
            new THREE.Vector3(20, 3.6, 8),
        ]

        this.fishData = []
        for(let i = 0; i < count; i++)
        {
            const school = centers[i % centers.length]
            this.fishData.push({
                center: school,
                radius: 5.5 + (i % 5) * 1.4,
                speed: 0.45 + (i % 4) * 0.12,
                phase: (i / count) * Math.PI * 2 + (i % 3) * 0.5,
                yOffset: ((i % 7) - 3) * 0.35,
                scale: 0.75 + (i % 4) * 0.18
            })
        }
        this.dummy = new THREE.Object3D()
    }

    setBubbles()
    {
        const count = 160
        const positions = new Float32Array(count * 3)
        const seeds = new Float32Array(count)

        for(let i = 0; i < count; i++)
        {
            const ang = Math.random() * Math.PI * 2
            const r = 4 + Math.random() * 58
            positions[i * 3 + 0] = Math.cos(ang) * r
            positions[i * 3 + 1] = 0
            positions[i * 3 + 2] = Math.sin(ang) * r
            seeds[i] = Math.random()
        }

        const posAttr = instancedArray(positions, 'vec3').toAttribute()
        const seedAttr = instancedArray(seeds, 'float').toAttribute()

        const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
        mat.positionNode = Fn(() =>
        {
            const p = posAttr.toVar()
            const prog = this.timeUniform.mul(0.08).add(seedAttr).fract()
            p.y.assign(prog.mul(16.0))
            p.x.addAssign(sin(this.timeUniform.mul(1.8).add(seedAttr.mul(12.0))).mul(0.45))
            return p
        })()
        mat.scaleNode = Fn(() =>
        {
            const prog = this.timeUniform.mul(0.08).add(seedAttr).fract()
            return smoothstep(float(0), float(0.15), prog).mul(smoothstep(float(1), float(0.75), prog)).mul(0.24)
        })()
        mat.outputNode = Fn(() =>
        {
            const d = uv().sub(0.5).length()
            d.greaterThan(0.45).discard()
            const rim = step(float(0.26), d)
            const c = mix(color('#8beeff'), color('#ffffff'), rim).mul(1.35)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, c), 0.65)
        })()

        const bubbles = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
        bubbles.count = count
        bubbles.frustumCulled = false
        this.parentGroup.add(bubbles)
    }

    update()
    {
        const t = this.game.ticker.elapsedScaled
        this.timeUniform.value = t

        for(let i = 0; i < this.fishData.length; i++)
        {
            const f = this.fishData[i]
            const ang = t * f.speed + f.phase
            const x = f.center.x + Math.cos(ang) * f.radius
            const z = f.center.z + Math.sin(ang) * f.radius
            const y = f.center.y + f.yOffset + Math.sin(t * 1.4 + f.phase) * 0.35

            this.dummy.position.set(x, y, z)
            // Tangente ao circulo (+X e a frente do peixe)
            this.dummy.rotation.set(0, -ang - Math.PI * 0.5, 0)
            this.dummy.scale.setScalar(f.scale)
            this.dummy.updateMatrix()
            this.fishMesh.setMatrixAt(i, this.dummy.matrix)
        }
        this.fishMesh.instanceMatrix.needsUpdate = true
    }
}
