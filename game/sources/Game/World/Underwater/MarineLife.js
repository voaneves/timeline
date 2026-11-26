import * as THREE from 'three/webgpu'
import { attribute, color, float, Fn, instancedArray, mix, positionLocal, sin, smoothstep, step, uniform, uv, varying, vec3, vec4 } from 'three/tsl'
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
        this.setMantaRays()
        this.setJellyfish()
        this.setBubbles()
        this.setPlankton()
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

    setPlankton()
    {
        const count = 120
        const positions = new Float32Array(count * 3)
        const seeds = new Float32Array(count)

        for(let i = 0; i < count; i++)
        {
            const ang = Math.random() * Math.PI * 2
            const r = 4 + Math.random() * 64
            positions[i * 3 + 0] = Math.cos(ang) * r
            positions[i * 3 + 1] = 0.8 + Math.random() * 13.5
            positions[i * 3 + 2] = Math.sin(ang) * r
            seeds[i] = Math.random()
        }

        const posAttr = instancedArray(positions, 'vec3').toAttribute()
        const seedAttr = instancedArray(seeds, 'float').toAttribute()
        const vSeed = varying(seedAttr, 'vPlanktonSeed')

        const mat = new THREE.SpriteNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
        mat.positionNode = Fn(() =>
        {
            const p = posAttr.toVar()
            p.x.addAssign(sin(this.timeUniform.mul(0.55).add(seedAttr.mul(14.0))).mul(1.2))
            p.y.addAssign(sin(this.timeUniform.mul(0.75).add(seedAttr.mul(19.0))).mul(0.6))
            return p
        })()
        mat.scaleNode = Fn(() =>
        {
            const glow = sin(this.timeUniform.mul(2.2).add(seedAttr.mul(17.0))).mul(0.5).add(0.5)
            return float(0.08).add(glow.mul(0.09))
        })()
        mat.outputNode = Fn(() =>
        {
            const d = uv().sub(0.5).length()
            d.greaterThan(0.5).discard()
            const soft = smoothstep(float(0.5), float(0.0), d)
            const c = mix(color('#34cfc4'), color('#ffe599'), vSeed).mul(1.7)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, c), soft.mul(0.75))
        })()

        const motes = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
        motes.count = count
        motes.frustumCulled = false
        this.parentGroup.add(motes)
    }

    setMantaRays()
    {
        const body = new THREE.ConeGeometry(0.95, 2.2, 4).rotateZ(-Math.PI * 0.5)
        body.scale(1.0, 0.16, 2.6)
        const tail = new THREE.CylinderGeometry(0.02, 0.08, 2.1, 5).rotateZ(Math.PI * 0.5)
        tail.translate(-1.95, 0, 0)
        const head = new THREE.SphereGeometry(0.45, 8, 6)
        head.scale(1.1, 0.35, 0.9)
        head.translate(0.75, 0.02, 0)

        const toSafe = (g) =>
        {
            const ng = g.index ? g.toNonIndexed() : g
            ng.deleteAttribute('uv')
            return ng
        }
        const geo = mergeGeometries([ toSafe(body), toSafe(tail), toSafe(head) ])
        body.dispose(); tail.dispose(); head.dispose()

        const mat = new MeshDefaultMaterial({
            colorNode: color('#1d4f73'),
            hasWater: false,
            hasLightBounce: false,
            hasDropShadows: false
        })
        mat.positionNode = Fn(() =>
        {
            const p = positionLocal.toVar()
            const wing = p.z.abs()
            p.y.addAssign(sin(this.timeUniform.mul(2.1).sub(wing.mul(0.8))).mul(wing).mul(0.18))
            return p
        })()

        const mantaSpecs = [
            { cx: -12, cz: -14, rx: 24, rz: 16, y: 7.4, speed: 0.22, phase: 0.0 },
            { cx:  16, cz: -26, rx: 20, rz: 18, y: 8.2, speed: 0.18, phase: 1.7 },
            { cx: -28, cz: -36, rx: 16, rz: 14, y: 6.8, speed: 0.25, phase: 3.1 },
            { cx:  24, cz:  12, rx: 18, rz: 14, y: 7.0, speed: 0.20, phase: 4.6 },
        ]
        this.mantas = mantaSpecs.map((spec) =>
        {
            const mesh = new THREE.Mesh(geo, mat)
            mesh.scale.setScalar(1.05)
            this.parentGroup.add(mesh)
            return { mesh, ...spec }
        })
    }

    setJellyfish()
    {
        const jellyColors = [ '#7ce8ff', '#ff77b7', '#b589ff', '#34cfc4' ]
        const domeGeo = new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58)
        const tentGeo = new THREE.CylinderGeometry(0.025, 0.015, 0.95, 5)
        tentGeo.translate(0, -0.45, 0)

        const jellySpots = [
            [ -24, 5.2, -40 ], [ -32, 6.4, -48 ], [ -14, 5.8, -50 ], [ 4, 6.2, -46 ],
            [  22, 5.5, -48 ], [  32, 6.6, -42 ], [  34, 4.8, -14 ], [ 30, 5.9,   4 ],
            [ -36, 4.9,  -8 ], [ -20, 6.0,   6 ], [ -42, 5.6, -24 ], [ 14, 5.3,  16 ],
            [  -8, 6.8, -32 ], [   8, 5.1, -24 ],
        ]

        const jellyMats = jellyColors.map((hex) =>
        {
            const m = new THREE.MeshBasicNodeMaterial({
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide
            })
            m.outputNode = Fn(() =>
            {
                return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color(hex).mul(1.75)), 0.72)
            })()
            return m
        })

        this.jellies = jellySpots.map(([ x, y, z ], i) =>
        {
            const m = jellyMats[i % jellyMats.length]
            const g = new THREE.Group()
            g.add(new THREE.Mesh(domeGeo, m))
            for(let k = 0; k < 4; k++)
            {
                const a = (k / 4) * Math.PI * 2
                const tent = new THREE.Mesh(tentGeo, m)
                tent.position.set(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18)
                g.add(tent)
            }
            g.position.set(x, y, z)
            this.parentGroup.add(g)
            return { group: g, baseY: y, phase: i * 0.85 }
        })
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

        if(this.mantas)
        {
            for(const m of this.mantas)
            {
                const a = t * m.speed + m.phase
                const x = m.cx + Math.cos(a) * m.rx
                const z = m.cz + Math.sin(a) * m.rz
                const dx = -Math.sin(a) * m.rx
                const dz = Math.cos(a) * m.rz
                const y = m.y + Math.sin(t * 0.9 + m.phase) * 0.65
                m.mesh.position.set(x, y, z)
                m.mesh.rotation.set(0.18, Math.atan2(-dz, dx), 0)
            }
        }

        if(this.jellies)
        {
            for(const j of this.jellies)
            {
                const pulse = Math.sin(t * 2.6 + j.phase)
                j.group.position.y = j.baseY + Math.sin(t * 0.95 + j.phase) * 0.55
                j.group.scale.set(1 + pulse * 0.12, 1 - pulse * 0.10, 1 + pulse * 0.12)
            }
        }
    }
}
