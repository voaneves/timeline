import * as THREE from 'three/webgpu'
import { color, float, Fn, instancedArray, instanceIndex, mix, sin, smoothstep, step, uniform, uv, vec3, vec4 } from 'three/tsl'
import { Game } from '../Game.js'
import { InteractivePoints } from '../InteractivePoints.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

/**
 * Passagem oceanica localizada na Baia Sudoeste (-74.5, 0, 58.5) na ponta do Píer de madeira.
 * Portal luminoso de mergulho com boias, disco de agua turquesa e bolhas ascendentes.
 */
export class OceanPassage
{
    constructor()
    {
        this.game = Game.getInstance()
        this.position = new THREE.Vector3(-74.5, 0.05, 58.5)
        this.timeUniform = uniform(0)

        this.group = new THREE.Group()
        this.group.position.copy(this.position)
        this.game.scene.add(this.group)

        this.setVisual()
        this.setBubbles()
        this.setInteraction()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    setVisual()
    {
        // Anel boia principal turquesa/dourado
        const ringMat = new THREE.MeshBasicNodeMaterial()
        ringMat.outputNode = Fn(() =>
        {
            const pulse = sin(this.timeUniform.mul(2.5)).mul(0.5).add(0.5)
            const c = mix(color('#34cfc4'), color('#ffe599'), pulse).mul(2.0)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, c), 1)
        })()

        this.ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.16, 10, 48), ringMat)
        this.ring.rotation.x = Math.PI * 0.5
        this.group.add(this.ring)

        // Disco interno brilhante de agua
        const discMat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        discMat.outputNode = Fn(() =>
        {
            const d = uv().sub(0.5).length().mul(2.0)
            const wave = sin(d.mul(18.0).sub(this.timeUniform.mul(3.5))).mul(0.5).add(0.5)
            const fade = smoothstep(float(1.0), float(0.25), d)
            const c = mix(color('#34cfc4'), color('#8beeff'), wave).mul(1.8)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, c), fade.mul(0.65))
        })()

        const disc = new THREE.Mesh(new THREE.CircleGeometry(3.1, 36), discMat)
        disc.rotation.x = -Math.PI * 0.5
        disc.position.y = 0.02
        this.group.add(disc)

        // Coluna luminosa suave e halo flutuante para orientar o jogador a distancia
        const beamMat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        beamMat.outputNode = Fn(() =>
        {
            const vFade = smoothstep(float(0.0), float(0.18), uv().y)
                .mul(smoothstep(float(1.0), float(0.25), uv().y))
            const pulse = sin(uv().y.mul(14.0).sub(this.timeUniform.mul(3.2))).mul(0.5).add(0.5)
            const c = mix(color('#34cfc4'), color('#ffe599'), pulse).mul(1.7)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, c), vFade.mul(0.26))
        })()
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 2.2, 11, 20, 1, true), beamMat)
        beam.position.y = 5.5
        this.group.add(beam)

        this.skyRing = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.09, 8, 32), ringMat)
        this.skyRing.position.y = 2.6
        this.group.add(this.skyRing)

        // 4 boias guias ao redor do anel
        const buoyGeo = new THREE.SphereGeometry(0.32, 12, 10)
        const buoyMat = new MeshDefaultMaterial({
            colorNode: color('#ff9a3c'),
            hasWater: false,
            hasLightBounce: false
        })
        this.buoys = []
        for(let i = 0; i < 4; i++)
        {
            const ang = (i / 4) * Math.PI * 2 + Math.PI * 0.25
            const b = new THREE.Mesh(buoyGeo, buoyMat)
            b.position.set(Math.cos(ang) * 3.6, 0.15, Math.sin(ang) * 3.6)
            this.group.add(b)
            this.buoys.push(b)
        }
    }

    setBubbles()
    {
        const count = 36
        const positions = new Float32Array(count * 3)
        const seeds = new Float32Array(count)
        for(let i = 0; i < count; i++)
        {
            const ang = Math.random() * Math.PI * 2
            const r = 0.6 + Math.random() * 2.3
            positions[i * 3 + 0] = Math.cos(ang) * r
            positions[i * 3 + 1] = Math.random() * 4.5
            positions[i * 3 + 2] = Math.sin(ang) * r
            seeds[i] = Math.random()
        }
        const posAttr = instancedArray(positions, 'vec3').toAttribute()
        const seedAttr = instancedArray(seeds, 'float').toAttribute()

        const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false })
        mat.positionNode = Fn(() =>
        {
            const p = posAttr.toVar()
            const prog = this.timeUniform.mul(0.28).add(seedAttr).fract()
            p.y.assign(prog.mul(5.0))
            return p
        })()
        mat.scaleNode = Fn(() =>
        {
            const prog = this.timeUniform.mul(0.28).add(seedAttr).fract()
            return smoothstep(float(0), float(0.2), prog).mul(smoothstep(float(1), float(0.6), prog)).mul(0.26)
        })()
        mat.outputNode = Fn(() =>
        {
            const d = uv().sub(0.5).length()
            d.greaterThan(0.45).discard()
            const rim = step(float(0.26), d)
            const c = mix(color('#a8f4ff'), color('#ffffff'), rim).mul(1.5)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, c), 0.75)
        })()

        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
        mesh.count = count
        this.group.add(mesh)
    }

    setInteraction()
    {
        this.interactivePoint = this.game.interactivePoints.create(
            new THREE.Vector3(this.position.x, 1.4, this.position.z),
            () => this.game.i18n.t('prompt.underwater.dive'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.game.worldManager?.enterUnderwater()
            },
            () =>
            {
                this.game.inputs.interactiveButtons.addItems([ 'interact' ])
            },
            () =>
            {
                this.game.inputs.interactiveButtons.removeItems([ 'interact' ])
            },
            () =>
            {
                this.game.inputs.interactiveButtons.removeItems([ 'interact' ])
            },
            'surface'
        )

        const zone = this.game.zones.create('sphere', this.position.clone(), 2.8, 'surface')
        zone.events.on('enter', () =>
        {
            this.game.worldManager?.enterUnderwater()
        })
    }

    update()
    {
        if(this.game.worldManager?.isUnderwater)
            return

        const t = this.game.ticker.elapsedScaled
        this.timeUniform.value = t

        this.ring.position.y = 0.08 + Math.sin(t * 2.0) * 0.05
        if(this.skyRing)
        {
            this.skyRing.position.y = 2.6 + Math.sin(t * 1.8) * 0.25
            this.skyRing.rotation.y = t * 0.9
            this.skyRing.rotation.x = Math.sin(t * 1.1) * 0.22
        }
        for(let i = 0; i < this.buoys.length; i++)
            this.buoys[i].position.y = 0.12 + Math.sin(t * 2.4 + i * 1.5) * 0.08
    }
}
