import * as THREE from 'three/webgpu'
import { color, cos, float, Fn, instancedArray, mix, positionLocal, sin, smoothstep, uniform, uv, varying, vec3, vec4 } from 'three/tsl'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

const smooth01 = (e0, e1, x) =>
{
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
}

/**
 * Elementos do Ceu e Santuario Celestial acima da ilha:
 * - Feixes volumetricos em 3 camadas acima do Santuario Celestial (-14, 0, -68)
 * - Coroa Celestial em 3 aneis concentricos, 12 gemas estelares e Cruz radiante com 8 raios
 * - Colunata de 4 pilares classicos em marmore branco & ouro com colisores Rapier
 * - 14 nuvens volumetricas suaves com sombreamento quente/frio sincronizado ao ciclo dia/noite
 * - 140 particulas ascendentes de luz + domo de 240 estrelas cintilantes a noite
 * - 9 pombas brancas esculpidas planando em 2 bandos serenos
 */
export class HeavenlySky
{
    constructor(sanctuaryPosition = new THREE.Vector3(-14, 0, -68))
    {
        this.game = Game.getInstance()
        this.anchor = sanctuaryPosition.clone()
        this.timeUniform = uniform(0)
        this.nightMixUniform = uniform(0)
        this.warmMixUniform = uniform(0)

        // Grupo ancorado no Santuario
        this.group = new THREE.Group()
        this.group.position.set(this.anchor.x, 0, this.anchor.z)
        this.game.scene.add(this.group)

        // Grupo global do ceu (coordenadas de mundo)
        this.skyGroup = new THREE.Group()
        this.game.scene.add(this.skyGroup)

        this.setSunbeams()
        this.setCrown()
        this.setSanctuaryPillars()
        this.setClouds()
        this.setLightMotes()
        this.setStars()
        this.setDoves()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    setSunbeams()
    {
        const layers = [
            { topR: 1.0, botR: 3.1, height: 22, opacity: 0.34, speed: 0.55, tint: '#fff6d1', raysFreq: 12 },
            { topR: 1.9, botR: 5.4, height: 26, opacity: 0.22, speed: -0.35, tint: '#ffe294', raysFreq: 18 },
            { topR: 3.1, botR: 8.2, height: 28, opacity: 0.12, speed: 0.22, tint: '#a8ecff', raysFreq: 10 },
        ]

        for(const cfg of layers)
        {
            const geometry = new THREE.CylinderGeometry(cfg.topR, cfg.botR, cfg.height, 36, 1, true)
            geometry.translate(0, cfg.height * 0.5, 0)

            const material = new THREE.MeshBasicNodeMaterial({
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
            })

            const beamCol = color(cfg.tint)
            material.outputNode = Fn(() =>
            {
                const baseUv = uv()
                const verticalFade = smoothstep(float(0.0), float(0.18), baseUv.y)
                    .mul(smoothstep(float(1.0), float(0.38), baseUv.y))

                const a1 = baseUv.x.mul(Math.PI * cfg.raysFreq).add(this.timeUniform.mul(cfg.speed))
                const a2 = baseUv.x.mul(Math.PI * (cfg.raysFreq + 8)).sub(this.timeUniform.mul(cfg.speed * 0.7))
                const shimmer = sin(a1).mul(0.5).add(0.5).mul(0.6)
                    .add(sin(a2).mul(0.5).add(0.5).mul(0.4))

                const intensity = shimmer.pow(1.45).mul(verticalFade).mul(cfg.opacity)
                const rgb = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, beamCol.mul(1.85))
                return vec4(rgb, intensity)
            })()

            const mesh = new THREE.Mesh(geometry, material)
            mesh.position.y = 0.25
            this.group.add(mesh)
        }
    }

    setCrown()
    {
        this.crown = new THREE.Group()
        this.crown.position.y = 14.8
        this.group.add(this.crown)

        const goldMat = new THREE.MeshBasicNodeMaterial()
        goldMat.outputNode = Fn(() =>
        {
            const pulse = sin(this.timeUniform.mul(2.1)).mul(0.25).add(2.35)
            const c = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#ffe699').mul(pulse))
            return vec4(c, 1)
        })()

        const pearlMat = new THREE.MeshBasicNodeMaterial()
        pearlMat.outputNode = Fn(() =>
        {
            const c = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#fffaf0').mul(1.9))
            return vec4(c, 1)
        })()

        const cyanMat = new THREE.MeshBasicNodeMaterial()
        cyanMat.outputNode = Fn(() =>
        {
            const pulse = sin(this.timeUniform.mul(2.6).add(1.2)).mul(0.2).add(2.0)
            const c = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#9beeff').mul(pulse))
            return vec4(c, 1)
        })()

        // 3 Aneis concentricos
        this.outerRing = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.085, 10, 56), goldMat)
        this.outerRing.rotation.x = Math.PI * 0.5
        this.crown.add(this.outerRing)

        // 12 gemas estelares no anel externo
        const gemGeo = new THREE.OctahedronGeometry(0.18, 0)
        for(let i = 0; i < 12; i++)
        {
            const a = (i / 12) * Math.PI * 2
            const gem = new THREE.Mesh(gemGeo, i % 2 === 0 ? pearlMat : goldMat)
            gem.position.set(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 0)
            this.outerRing.add(gem)
        }

        this.midRing = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.065, 8, 48), pearlMat)
        this.midRing.rotation.x = Math.PI * 0.44
        this.crown.add(this.midRing)

        this.innerRing = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.055, 8, 40), cyanMat)
        this.innerRing.rotation.x = Math.PI * 0.56
        this.crown.add(this.innerRing)

        // Cruz radiante esculpida + 8 raios solares ao redor
        this.crossGroup = new THREE.Group()
        this.crossGroup.position.y = 0.75
        this.crown.add(this.crossGroup)

        const vCore = new THREE.BoxGeometry(0.22, 2.5, 0.22)
        const hCore = new THREE.BoxGeometry(1.65, 0.22, 0.22)
        hCore.translate(0, 0.36, 0)
        const vTrim = new THREE.BoxGeometry(0.32, 2.35, 0.14)
        const hTrim = new THREE.BoxGeometry(1.52, 0.32, 0.14)
        hTrim.translate(0, 0.36, 0)

        const crossMainGeo = mergeGeometries([ vCore, hCore ])
        const crossHaloGeo = mergeGeometries([ vTrim, hTrim ])
        vCore.dispose(); hCore.dispose(); vTrim.dispose(); hTrim.dispose()

        this.crossGroup.add(new THREE.Mesh(crossMainGeo, goldMat))
        this.crossGroup.add(new THREE.Mesh(crossHaloGeo, pearlMat))

        // Raios radiantes ao redor da cruz
        this.sunburstGroup = new THREE.Group()
        this.sunburstGroup.position.y = 0.36
        const rayMat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        rayMat.outputNode = Fn(() =>
        {
            const vFade = smoothstep(float(1.0), float(0.1), uv().y)
            const c = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#ffe599').mul(2.0))
            return vec4(c, vFade.mul(0.55))
        })()
        const rayGeo = new THREE.ConeGeometry(0.09, 1.8, 6)
        rayGeo.translate(0, 1.35, 0)
        for(let i = 0; i < 8; i++)
        {
            const r = new THREE.Mesh(rayGeo, rayMat)
            r.rotation.z = (i / 8) * Math.PI * 2 + Math.PI * 0.125
            this.sunburstGroup.add(r)
        }
        this.crossGroup.add(this.sunburstGroup)
    }

    setSanctuaryPillars()
    {
        const marbleMat = new MeshDefaultMaterial({
            colorNode: color('#f3f7fc'),
            hasWater: false,
            hasLightBounce: false
        })
        const goldMat = new MeshDefaultMaterial({
            colorNode: color('#e9c46a'),
            hasWater: false,
            hasLightBounce: false
        })
        const flameMat = new THREE.MeshBasicNodeMaterial()
        flameMat.outputNode = Fn(() =>
        {
            const pulse = sin(this.timeUniform.mul(3.4)).mul(0.25).add(2.0)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#ffe599').mul(pulse)), 1)
        })()

        // 4 colunas em marmore nos diagonais do Santuario (entrada Sul 100% livre)
        const radius = 6.2
        const angles = [ 45, 135, 225, 315 ].map(d => (d * Math.PI) / 180)
        for(const a of angles)
        {
            const wx = this.anchor.x + Math.cos(a) * radius
            const wz = this.anchor.z + Math.sin(a) * radius

            const colGroup = new THREE.Group()
            const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.28, 0.95), goldMat)
            plinth.position.y = 0.14
            colGroup.add(plinth)

            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 3.8, 12), marbleMat)
            shaft.position.y = 2.18
            colGroup.add(shaft)

            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.24, 0.86), goldMat)
            cap.position.y = 4.2
            colGroup.add(cap)

            const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), flameMat)
            finial.position.y = 4.58
            colGroup.add(finial)

            colGroup.position.set(wx, 0, wz)
            this.game.objects.add(
                { model: colGroup, parent: this.skyGroup, updateMaterials: false },
                {
                    type: 'fixed',
                    position: new THREE.Vector3(wx, 0, wz),
                    enabled: true,
                    friction: 0.3,
                    colliders: [
                        { shape: 'cuboid', parameters: [ 0.52, 2.2, 0.52 ], position: { x: 0, y: 2.2, z: 0 } }
                    ]
                }
            )
        }
    }

    setClouds()
    {
        // Silhueta cumulus organica e suave (7 esferas suavizadas)
        const puffSpecs = [
            [  0.0,  0.15,  0.0, 1.75, 1.25, 0.85, 1.05 ],
            [ -1.55, -0.15, 0.2, 1.32, 1.12, 0.82, 0.98 ],
            [  1.65, -0.10,-0.2, 1.38, 1.15, 0.84, 1.00 ],
            [ -0.75,  0.55,-0.5, 1.15, 1.05, 0.88, 0.96 ],
            [  0.80,  0.48, 0.5, 1.22, 1.08, 0.86, 0.96 ],
            [ -2.45, -0.38,-0.1, 0.92, 1.10, 0.72, 0.90 ],
            [  2.55, -0.35, 0.15, 0.95, 1.10, 0.74, 0.90 ],
        ]
        const parts = puffSpecs.map(([ x, y, z, r, sx, sy, sz ]) =>
        {
            const g = new THREE.SphereGeometry(r, 12, 10)
            g.scale(sx, sy, sz)
            g.translate(x, y, z)
            return g
        })
        const cloudGeometry = mergeGeometries(parts)
        for(const p of parts) p.dispose()

        const cloudMaterial = new MeshDefaultMaterial({
            colorNode: Fn(() =>
            {
                const topFactor = smoothstep(float(-0.8), float(1.4), positionLocal.y)
                const dayColor = mix(color('#c6e5ff'), color('#fffdf5'), topFactor)
                const warmColor = mix(color('#f29c79'), color('#ffe7bd'), topFactor)
                const nightColor = mix(color('#1f3b6e'), color('#5887c7'), topFactor)
                const dayWarm = mix(dayColor, warmColor, this.warmMixUniform)
                return mix(dayWarm, nightColor, this.nightMixUniform)
            })(),
            hasCoreShadows: false,
            hasDropShadows: false,
            hasLightBounce: false,
            hasWater: false,
            hasFog: true,
            hasReveal: true,
        })

        // Estrato inferior emoldurando o Santuario + estrato panoramico pela ilha
        const placements = [
            // Moldura do Santuario Celestial
            { x: -34, y: 17.5, z: -76, s: 1.45, speed: 0.28 },
            { x:   6, y: 18.2, z: -79, s: 1.50, speed: 0.25 },
            { x: -16, y: 19.5, z: -50, s: 1.25, speed: 0.22 },
            // Ceu panoramico
            { x: -64, y: 22.0, z: -48, s: 1.75, speed: 0.34 },
            { x: -58, y: 24.0, z:  16, s: 1.65, speed: 0.30 },
            { x: -32, y: 25.0, z:  58, s: 1.85, speed: 0.26 },
            { x:  18, y: 23.0, z:  52, s: 1.70, speed: 0.32 },
            { x:  62, y: 24.5, z:  28, s: 1.90, speed: 0.24 },
            { x:  58, y: 23.5, z: -26, s: 1.75, speed: 0.29 },
            { x:  34, y: 21.5, z: -64, s: 1.55, speed: 0.31 },
            { x:  -4, y: 26.5, z:  -6, s: 1.80, speed: 0.20 },
            { x: -46, y: 27.5, z: -12, s: 1.60, speed: 0.27 },
            { x:  38, y: 28.0, z:  -8, s: 1.70, speed: 0.23 },
            { x: -74, y: 25.5, z:  54, s: 1.50, speed: 0.33 },
        ]

        this.clouds = []
        for(let i = 0; i < placements.length; i++)
        {
            const cfg = placements[i]
            const mesh = new THREE.Mesh(cloudGeometry, cloudMaterial)
            mesh.position.set(cfg.x, cfg.y, cfg.z)
            mesh.scale.setScalar(cfg.s)
            mesh.rotation.y = i * 0.78
            mesh.castShadow = false
            mesh.receiveShadow = false
            this.skyGroup.add(mesh)
            this.clouds.push({ mesh, baseX: cfg.x, baseY: cfg.y, baseZ: cfg.z, speed: cfg.speed, phase: i * 1.15 })
        }
    }

    setLightMotes()
    {
        const count = 140
        const positions = new Float32Array(count * 3)
        const seeds = new Float32Array(count)

        for(let i = 0; i < count; i++)
        {
            const ang = Math.random() * Math.PI * 2
            const r = 0.6 + Math.random() * 6.8
            positions[i * 3 + 0] = Math.cos(ang) * r
            positions[i * 3 + 1] = 0
            positions[i * 3 + 2] = Math.sin(ang) * r
            seeds[i] = Math.random()
        }

        const posAttr = instancedArray(positions, 'vec3').toAttribute()
        const seedAttr = instancedArray(seeds, 'float').toAttribute()
        const vSeed = varying(seedAttr, 'vSkyMoteSeed')

        const mat = new THREE.SpriteNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
        mat.positionNode = Fn(() =>
        {
            const p = posAttr.toVar()
            const prog = this.timeUniform.mul(0.065).add(seedAttr).fract()
            p.y.assign(prog.mul(24.0).add(0.5))
            p.x.addAssign(sin(this.timeUniform.mul(1.1).add(seedAttr.mul(16.0))).mul(0.55))
            p.z.addAssign(cos(this.timeUniform.mul(0.9).add(seedAttr.mul(12.0))).mul(0.55))
            return p
        })()
        mat.scaleNode = Fn(() =>
        {
            const prog = this.timeUniform.mul(0.065).add(seedAttr).fract()
            return smoothstep(float(0), float(0.15), prog).mul(smoothstep(float(1), float(0.65), prog)).mul(0.24)
        })()
        mat.outputNode = Fn(() =>
        {
            const d = uv().sub(0.5).length()
            d.greaterThan(0.5).discard()
            const soft = smoothstep(float(0.5), float(0.0), d)
            const col = mix(color('#ffe599'), color('#ffffff'), vSeed).mul(1.8)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, col), soft.mul(0.85))
        })()

        const motes = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
        motes.count = count
        motes.frustumCulled = false
        this.group.add(motes)
    }

    setStars()
    {
        const count = 240
        const positions = new Float32Array(count * 3)
        const seeds = new Float32Array(count)

        for(let i = 0; i < count; i++)
        {
            const theta = Math.random() * Math.PI * 2
            const r = 46 + Math.random() * 72
            positions[i * 3 + 0] = Math.cos(theta) * r
            positions[i * 3 + 1] = 30 + Math.random() * 24
            positions[i * 3 + 2] = Math.sin(theta) * r
            seeds[i] = Math.random()
        }

        const posAttr = instancedArray(positions, 'vec3').toAttribute()
        const seedAttr = instancedArray(seeds, 'float').toAttribute()
        const vSeed = varying(seedAttr, 'vStarSeed')

        const mat = new THREE.SpriteNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
        mat.positionNode = Fn(() => posAttr)()
        mat.scaleNode = Fn(() =>
        {
            const twinkle = sin(this.timeUniform.mul(2.4).add(seedAttr.mul(25.0))).mul(0.5).add(0.5)
            return float(0.22).add(twinkle.mul(0.26)).mul(mix(float(0.35), float(1.1), this.nightMixUniform))
        })()
        mat.outputNode = Fn(() =>
        {
            const d = uv().sub(0.5).length()
            d.greaterThan(0.5).discard()
            const glow = smoothstep(float(0.5), float(0.05), d)
            const c = mix(color('#a8ecff'), color('#fff1b8'), vSeed).mul(2.0)
            const alpha = glow.mul(mix(float(0.06), float(0.95), this.nightMixUniform))
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, c), alpha)
        })()

        const stars = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
        stars.count = count
        stars.frustumCulled = false
        this.skyGroup.add(stars)
    }

    setDoves()
    {
        // Pomba esculpida: corpo fusiforme + cauda em leque + 2 asas curvas com flexao na ponta
        const bodyGeo = new THREE.ConeGeometry(0.11, 0.62, 6)
        bodyGeo.rotateX(Math.PI * 0.5)

        const tailGeo = new THREE.ConeGeometry(0.14, 0.24, 4)
        tailGeo.rotateX(-Math.PI * 0.5)
        tailGeo.scale(1.2, 0.28, 1.0)
        tailGeo.translate(0, 0.02, -0.34)

        const wingPositions = new Float32Array([
            // Asa direita (+X)
            0.04, 0.02,  0.14,
            0.04, 0.02, -0.14,
            0.72, 0.14, -0.04,
            // Borda posterior direita
            0.04, 0.02, -0.14,
            0.44, 0.09, -0.22,
            0.72, 0.14, -0.04,
            // Asa esquerda (-X)
           -0.04, 0.02, -0.14,
           -0.04, 0.02,  0.14,
           -0.72, 0.14, -0.04,
            // Borda posterior esquerda
           -0.44, 0.09, -0.22,
           -0.04, 0.02, -0.14,
           -0.72, 0.14, -0.04,
        ])
        const wingsGeo = new THREE.BufferGeometry()
        wingsGeo.setAttribute('position', new THREE.Float32BufferAttribute(wingPositions, 3))
        wingsGeo.computeVertexNormals()

        const birdGeo = mergeGeometries([ bodyGeo, tailGeo, wingsGeo ])
        bodyGeo.dispose(); tailGeo.dispose(); wingsGeo.dispose()

        const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
        material.positionNode = Fn(() =>
        {
            const p = positionLocal.toVar()
            const wingFactor = smoothstep(float(0.06), float(0.72), p.x.abs())
            const flap = sin(this.timeUniform.mul(6.4)).mul(wingFactor).mul(0.42)
            p.y.addAssign(flap)
            return p
        })()
        material.outputNode = Fn(() =>
        {
            const c = MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#ffffff').mul(1.4))
            return vec4(c, 1)
        })()

        this.doves = []
        const count = 9
        for(let i = 0; i < count; i++)
        {
            const mesh = new THREE.Mesh(birdGeo, material)
            mesh.scale.setScalar(0.8 + (i % 3) * 0.1)
            this.group.add(mesh)
            this.doves.push({
                mesh,
                radius: i < 5 ? (4.4 + (i % 3) * 1.4) : (8.5 + (i % 4) * 1.6),
                height: i < 5 ? (8.2 + (i % 3) * 1.3) : (12.0 + (i % 3) * 1.8),
                speed: (i < 5 ? 0.42 : -0.31) + (i % 3) * 0.04,
                phase: (i / count) * Math.PI * 2,
                bank: i < 5 ? -0.18 : 0.16,
            })
        }
    }

    update()
    {
        if(this.game.worldManager?.isUnderwater)
            return

        const t = this.game.ticker.elapsedScaled
        this.timeUniform.value = t

        // Sincronizar ciclo de dia/noite com nuvens e estrelas
        const p = this.game.dayCycles?.progress ?? 0
        const nightVal = smooth01(0.25, 0.36, p) * (1 - smooth01(0.60, 0.78, p))
        const warmVal = Math.max(
            smooth01(0.16, 0.25, p) * (1 - smooth01(0.25, 0.35, p)),
            smooth01(0.68, 0.80, p) * (1 - smooth01(0.80, 0.90, p))
        )
        this.nightMixUniform.value = nightVal
        this.warmMixUniform.value = warmVal

        if(this.game.world?.areas?.altar)
        {
            const ap = this.game.world.areas.altar.position
            this.group.position.set(ap.x, 0, ap.z)
        }

        if(this.crown)
        {
            this.outerRing.rotation.z = t * 0.22
            this.midRing.rotation.z = -t * 0.31
            this.midRing.rotation.y = Math.sin(t * 0.4) * 0.25
            this.innerRing.rotation.z = t * 0.42
            this.crossGroup.rotation.y = t * 0.35
            this.sunburstGroup.rotation.z = -t * 0.5
            this.crown.position.y = 14.8 + Math.sin(t * 0.9) * 0.35
        }

        for(const c of this.clouds)
        {
            c.mesh.position.x = c.baseX + Math.sin(t * 0.06 * c.speed + c.phase) * 5.5
            c.mesh.position.y = c.baseY + Math.sin(t * 0.3 + c.phase) * 0.45
        }

        for(const d of this.doves)
        {
            const ang = t * d.speed + d.phase
            const nx = Math.cos(ang) * d.radius
            const nz = Math.sin(ang) * d.radius
            d.mesh.position.set(nx, d.height + Math.sin(t * 1.4 + d.phase) * 0.45, nz)
            d.mesh.rotation.set(0, d.speed > 0 ? -ang : -ang + Math.PI, d.bank)
        }
    }
}
