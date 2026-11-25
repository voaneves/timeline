import * as THREE from 'three/webgpu'
import { color, cos, float, Fn, mix, positionLocal, sin, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

/**
 * Elementos do Ceu acima do Santuario Celestial:
 * - Raios de luz dourados (sunbeams) descendo do ceu
 * - Halo duplo dourado + Cruz/Estrela radiante
 * - Nuvens fofas estilizadas flutuando ao redor da ilha
 * - Pombas brancas planando em circulos serenos
 */
export class HeavenlySky
{
    constructor(sanctuaryPosition = new THREE.Vector3(0, 0, -68))
    {
        this.game = Game.getInstance()
        this.anchor = sanctuaryPosition.clone()
        this.timeUniform = uniform(0)

        this.group = new THREE.Group()
        this.group.position.set(this.anchor.x, 0, this.anchor.z)
        this.game.scene.add(this.group)

        this.setSunbeams()
        this.setCrown()
        this.setClouds()
        this.setDoves()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    setSunbeams()
    {
        const height = 18
        const geometry = new THREE.CylinderGeometry(1.6, 5.2, height, 32, 1, true)
        geometry.translate(0, height * 0.5, 0)

        const beamColor = uniform(color('#ffe599'))
        const material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
        })

        material.outputNode = Fn(() =>
        {
            const baseUv = uv()
            const verticalFade = smoothstep(float(0.0), float(0.22), baseUv.y)
                .mul(smoothstep(float(1.0), float(0.45), baseUv.y))

            const angleA = baseUv.x.mul(Math.PI * 12).add(this.timeUniform.mul(0.5))
            const angleB = baseUv.x.mul(Math.PI * 20).sub(this.timeUniform.mul(0.35))
            const rays = sin(angleA).mul(0.5).add(0.5).mul(0.65)
                .add(sin(angleB).mul(0.5).add(0.5).mul(0.35))

            const intensity = rays.pow(1.6).mul(verticalFade).mul(0.38)
            const rgb = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, beamColor.mul(1.8))
            return vec4(rgb, intensity)
        })()

        this.sunbeams = new THREE.Mesh(geometry, material)
        this.sunbeams.position.y = 0.5
        this.group.add(this.sunbeams)
    }

    setCrown()
    {
        this.crown = new THREE.Group()
        this.crown.position.y = 14.5
        this.group.add(this.crown)

        const goldMat = new THREE.MeshBasicNodeMaterial()
        goldMat.outputNode = Fn(() =>
        {
            const c = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#ffe699').mul(2.4))
            return vec4(c, 1)
        })()

        const cyanMat = new THREE.MeshBasicNodeMaterial()
        cyanMat.outputNode = Fn(() =>
        {
            const c = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#9beeff').mul(2.1))
            return vec4(c, 1)
        })()

        this.outerRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.08, 8, 48), goldMat)
        this.outerRing.rotation.x = Math.PI * 0.5
        this.crown.add(this.outerRing)

        this.innerRing = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.06, 8, 36), cyanMat)
        this.innerRing.rotation.x = Math.PI * 0.42
        this.crown.add(this.innerRing)

        // Cruz luminosa serena no centro do halo
        const vBar = new THREE.BoxGeometry(0.18, 2.2, 0.18)
        const hBar = new THREE.BoxGeometry(1.4, 0.18, 0.18)
        hBar.translate(0, 0.32, 0)
        const crossGeo = mergeGeometries([ vBar, hBar ])
        this.crossMesh = new THREE.Mesh(crossGeo, goldMat)
        this.crossMesh.position.y = 0.6
        this.crown.add(this.crossMesh)
    }

    setClouds()
    {
        const puffSpecs = [
            [ 0, 0, 0, 1.8 ],
            [ -1.6, -0.25, 0.25, 1.3 ],
            [ 1.65, -0.2, -0.2, 1.35 ],
            [ -0.7, 0.35, -0.6, 1.15 ],
            [ 0.75, 0.3, 0.55, 1.2 ],
        ]
        const parts = puffSpecs.map(([ x, y, z, r ]) =>
        {
            const g = new THREE.IcosahedronGeometry(r, 1)
            g.scale(1.15, 0.72, 1.0)
            g.translate(x, y, z)
            return g
        })
        const cloudGeometry = mergeGeometries(parts)
        for(const p of parts) p.dispose()

        const cloudMaterial = new MeshDefaultMaterial({
            colorNode: color('#f6fbff'),
            hasCoreShadows: true,
            hasDropShadows: false,
            hasLightBounce: false,
            hasWater: false,
            hasFog: true,
            hasReveal: true,
        })

        const placements = [
            { x: -55, y: 19, z: -48, s: 1.5, speed: 0.35 },
            { x: -18, y: 21, z: -64, s: 1.8, speed: 0.28 },
            { x: 24, y: 20, z: -56, s: 1.4, speed: 0.32 },
            { x: 56, y: 22, z: -20, s: 1.6, speed: 0.25 },
            { x: -66, y: 20, z: 12, s: 1.45, speed: 0.30 },
            { x: 42, y: 23, z: 46, s: 1.7, speed: 0.26 },
            { x: -24, y: 22, z: 58, s: 1.35, speed: 0.34 },
            { x: 6, y: 24, z: 6, s: 1.5, speed: 0.22 },
        ]

        this.clouds = []
        for(let i = 0; i < placements.length; i++)
        {
            const cfg = placements[i]
            const mesh = new THREE.Mesh(cloudGeometry, cloudMaterial)
            mesh.position.set(cfg.x, cfg.y, cfg.z)
            mesh.scale.setScalar(cfg.s)
            mesh.rotation.y = i * 0.9
            mesh.castShadow = false
            mesh.receiveShadow = false
            this.game.scene.add(mesh)
            this.clouds.push({ mesh, baseX: cfg.x, baseY: cfg.y, baseZ: cfg.z, speed: cfg.speed, phase: i * 1.3 })
        }
    }

    setDoves()
    {
        // Asa estilizada (dois triangulos em V) com batida suave via positionLocal.x
        const positions = new Float32Array([
            0, 0, 0.22,
            0, 0, -0.22,
            0.55, 0.08, -0.05,

            0, 0, -0.22,
            0, 0, 0.22,
            -0.55, 0.08, -0.05,
        ])
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.computeVertexNormals()

        const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
        material.positionNode = Fn(() =>
        {
            const p = positionLocal.toVar()
            const wing = p.x.abs()
            const flap = sin(this.timeUniform.mul(7.0)).mul(wing).mul(0.55)
            p.y.addAssign(flap)
            return p
        })()
        material.outputNode = Fn(() =>
        {
            const c = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#ffffff').mul(1.35))
            return vec4(c, 1)
        })()

        this.doves = []
        const count = 5
        for(let i = 0; i < count; i++)
        {
            const mesh = new THREE.Mesh(geometry, material)
            mesh.scale.setScalar(0.85)
            this.group.add(mesh)
            this.doves.push({
                mesh,
                radius: 4.5 + (i % 3) * 1.8,
                height: 8.5 + (i % 3) * 1.6,
                speed: 0.42 + i * 0.05,
                phase: (i / count) * Math.PI * 2,
            })
        }
    }

    update()
    {
        if(this.game.worldManager?.isUnderwater)
            return

        const t = this.game.ticker.elapsedScaled
        this.timeUniform.value = t

        // Mantem ancorado no Santuario caso a posicao mude
        if(this.game.world?.areas?.altar)
        {
            const ap = this.game.world.areas.altar.position
            this.group.position.set(ap.x, 0, ap.z)
        }

        if(this.crown)
        {
            this.outerRing.rotation.z = t * 0.25
            this.innerRing.rotation.z = -t * 0.38
            this.innerRing.rotation.y = Math.sin(t * 0.5) * 0.3
            this.crossMesh.rotation.y = t * 0.35
            this.crown.position.y = 14.5 + Math.sin(t * 0.9) * 0.35
        }

        for(const c of this.clouds)
        {
            c.mesh.position.x = c.baseX + Math.sin(t * 0.06 * c.speed + c.phase) * 5.0
            c.mesh.position.y = c.baseY + Math.sin(t * 0.3 + c.phase) * 0.45
        }

        for(const d of this.doves)
        {
            const ang = t * d.speed + d.phase
            const nx = Math.cos(ang) * d.radius
            const nz = Math.sin(ang) * d.radius
            d.mesh.position.set(nx, d.height + Math.sin(t * 1.4 + d.phase) * 0.4, nz)
            d.mesh.rotation.y = -ang
        }
    }
}
