import * as THREE from 'three/webgpu'
import { color, cos, float, Fn, min, mix, positionWorld, sin, smoothstep, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { Game } from '../../Game.js'
import { InteractivePoints } from '../../InteractivePoints.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'
import { KelpForest } from './KelpForest.js'
import { MarineLife } from './MarineLife.js'

const UW_CIRCUIT_BEST_KEY = 'vn_uw_circuit_v1'

/**
 * Mundo Subaquatico (Fase 7):
 * - Bacia 192x192m com solo arenoso, causticas TSL animadas e heightfield Rapier dedicado
 * - Raios de sol submersos, corais estilizados, arcos naturais, floresta de kelp e cardumes
 * - 4 Capsulas tecnicas interativas, Circuito de 8 Argolas 3D e Farol de Retorno
 */
export class UnderwaterWorld
{
    constructor()
    {
        this.game = Game.getInstance()
        this.active = false
        this.bodies = []
        this.timeUniform = uniform(0)

        this.group = new THREE.Group()
        this.group.visible = false
        this.game.scene.add(this.group)

        this.sounds = {
            checkpoint: this.game.audio.register({
                path: 'sounds/circuit/checkpoint/Win Score 1.mp3',
                autoplay: false,
                loop: false,
                volume: 0.45,
                antiSpam: 0.08,
                onPlay: (item, step) =>
                {
                    item.rate = 1 + step * 0.06
                }
            }),
            finish: this.game.audio.register({
                path: 'sounds/circuit/finish/Big Win Fanfare 2.mp3',
                autoplay: false,
                loop: false,
                volume: 0.45
            }),
            capsule: this.game.audio.register({
                path: 'sounds/achievements/Money Reward 2.mp3',
                autoplay: false,
                loop: false,
                volume: 0.35
            })
        }

        this.setSeabed()
        this.setGodRays()
        this.setCoralsAndArches()
        this.setReturnBeacon()
        this.setCapsules()
        this.setRingCourse()

        this.kelpForest = new KelpForest(this.group)
        this.marineLife = new MarineLife(this.group)

        this.hud = {
            statusEl: document.querySelector('.js-uw-status'),
            metaEl: document.querySelector('.js-uw-meta'),
            lastStatus: '',
            lastMeta: '',
        }
        this.game.i18n.events.on('change', () =>
        {
            this.hud.lastStatus = ''
            this.hud.lastMeta = ''
            if(this.active)
                this.updateHud()
        })

        this.game.ticker.events.on('tick', () =>
        {
            if(this.active)
                this.update()
        }, 10)
    }

    static sampleSeabedHeight(wx, wz)
    {
        const r = Math.hypot(wx, wz)
        const tPlaza = Math.min(1, Math.max(0, (r - 12) / 14))
        const plazaClear = tPlaza * tPlaza * (3 - 2 * tPlaza)

        const dunes = Math.sin(wx * 0.075) * Math.cos(wz * 0.08) * 1.1
            + Math.sin(wx * 0.035 + wz * 0.045) * 0.7

        // Borda suave formando parede do recife a partir de r > 76m
        const tWall = Math.min(1, Math.max(0, (r - 74) / 18))
        const wall = tWall * tWall * 12.0

        return dunes * plazaClear + wall
    }

    setSeabed()
    {
        const size = 192
        const subdivs = 96
        const geo = new THREE.PlaneGeometry(size, size, subdivs, subdivs)
        geo.rotateX(-Math.PI * 0.5)

        const pos = geo.attributes.position
        const rowsCount = subdivs + 1
        const heights = new Float32Array(rowsCount * rowsCount)

        for(let i = 0; i < pos.count; i++)
        {
            const wx = pos.getX(i)
            const wz = pos.getZ(i)
            const y = UnderwaterWorld.sampleSeabedHeight(wx, wz)
            pos.setY(i, y)

            const indexX = Math.round(((wx / size) + 0.5) * subdivs)
            const indexZ = Math.round(((wz / size) + 0.5) * subdivs)
            heights[indexZ + indexX * rowsCount] = y
        }
        geo.computeVertexNormals()

        // Solo arenoso com causticas animadas em TSL
        const sandLight = color('#98d8d6')
        const sandDeep = color('#206b82')
        const causticColor = color('#aef6ff')

        const colorNode = Fn(() =>
        {
            const t = this.timeUniform.mul(0.035)
            const uvA = positionWorld.xz.mul(0.085).add(vec2(t, t.mul(0.7)))
            const uvB = positionWorld.xz.mul(0.095).sub(vec2(t.mul(0.8), t.mul(1.1)))
            const vA = texture(this.game.noises.voronoi, uvA).r
            const vB = texture(this.game.noises.voronoi, uvB).r
            const caustics = min(vA, vB).pow(2.4).mul(1.9)

            const depthMix = smoothstep(float(-0.5), float(3.0), positionWorld.y)
            const baseSand = mix(sandDeep, sandLight, depthMix)
            return baseSand.add(causticColor.mul(caustics))
        })()

        const mat = new MeshDefaultMaterial({
            colorNode,
            hasWater: false,
            hasLightBounce: false,
            hasDropShadows: true,
        })

        const mesh = new THREE.Mesh(geo, mat)
        mesh.receiveShadow = true
        this.group.add(mesh)

        const physical = this.game.physics.getPhysical({
            type: 'fixed',
            enabled: false,
            friction: 0.25,
            restitution: 0.1,
            colliders: [
                { shape: 'heightfield', parameters: [ subdivs, subdivs, heights, { x: size, y: 1, z: size } ], category: 'floor' }
            ]
        })
        this.bodies.push(physical.body)
    }

    setGodRays()
    {
        const rayMat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        rayMat.outputNode = Fn(() =>
        {
            const baseUv = uv()
            const vFade = smoothstep(float(0.0), float(0.25), baseUv.y)
                .mul(smoothstep(float(1.0), float(0.55), baseUv.y))
            const stripes = sin(baseUv.x.mul(Math.PI * 10).add(this.timeUniform.mul(0.6))).mul(0.5).add(0.5)
            const intensity = stripes.pow(1.4).mul(vFade).mul(0.20)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#8beeff').mul(1.6)), intensity)
        })()

        const raySpots = [
            [ 0, 20 ], [ -22, -6 ], [ 24, -8 ], [ -16, -34 ], [ 18, -36 ],
            [ -38, 12 ], [ 36, 14 ], [ 0, -52 ], [ -44, -26 ], [ 42, -26 ],
        ]

        const rayGeo = new THREE.CylinderGeometry(1.1, 4.2, 22, 16, 1, true)
        rayGeo.translate(0, 11, 0)

        for(const [ x, z ] of raySpots)
        {
            const m = new THREE.Mesh(rayGeo, rayMat)
            m.position.set(x, -0.5, z)
            m.rotation.z = 0.14
            m.rotation.x = 0.08
            this.group.add(m)
        }
    }

    setCoralsAndArches()
    {
        const coralColors = [ '#ff6f91', '#ff9f43', '#34cfc4', '#ffd166', '#9b72ff' ]
        const coralMats = coralColors.map(hex => new MeshDefaultMaterial({
            colorNode: color(hex),
            hasWater: false,
            hasLightBounce: false
        }))
        const rockMat = new MeshDefaultMaterial({
            colorNode: color('#476b82'),
            hasWater: false,
            hasLightBounce: false
        })

        // Clusters de corais ao redor do recife (fora dos pontos interativos)
        const clusters = [
            [ -16, 6 ], [ 16, 4 ], [ -24, 24 ], [ 22, 22 ], [ -44, -22 ], [ 44, -22 ],
            [ -12, -24 ], [ 14, -26 ], [ -46, 20 ], [ 46, 16 ], [ 0, -64 ], [ -54, -44 ], [ 54, -44 ]
        ]

        const stalkGeo = new THREE.CylinderGeometry(0.28, 0.42, 1.8, 7)
        const capGeo = new THREE.DodecahedronGeometry(0.7, 0)

        for(let i = 0; i < clusters.length; i++)
        {
            const [ cx, cz ] = clusters[i]
            const yBase = UnderwaterWorld.sampleSeabedHeight(cx, cz)
            const mat = coralMats[i % coralMats.length]

            const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), rockMat)
            rock.scale.set(1.2, 0.75, 1.1)
            rock.position.set(cx, yBase + 0.4, cz)
            rock.castShadow = true
            rock.receiveShadow = true
            this.group.add(rock)

            const phys = this.game.physics.getPhysical({
                type: 'fixed',
                enabled: false,
                position: new THREE.Vector3(cx, yBase + 0.4, cz),
                colliders: [ { shape: 'ball', parameters: [ 1.6 ], category: 'object' } ]
            })
            this.bodies.push(phys.body)

            for(let k = 0; k < 3; k++)
            {
                const ang = (k / 3) * Math.PI * 2 + i
                const sx = cx + Math.cos(ang) * 1.1
                const sz = cz + Math.sin(ang) * 1.1
                const sy = UnderwaterWorld.sampleSeabedHeight(sx, sz)
                const stalk = new THREE.Mesh(stalkGeo, mat)
                stalk.position.set(sx, sy + 0.9, sz)
                stalk.rotation.z = Math.cos(ang) * 0.25
                this.group.add(stalk)

                const cap = new THREE.Mesh(capGeo, mat)
                cap.position.set(sx, sy + 1.9, sz)
                this.group.add(cap)
            }
        }

        // 2 Arcos de pedra naturais para atravessar de submarino
        const archSpecs = [
            { x: 0, z: -28, rotY: 0 },
            { x: -38, z: -32, rotY: 0.7 },
        ]
        for(const spec of archSpecs)
        {
            const y = UnderwaterWorld.sampleSeabedHeight(spec.x, spec.z)
            const arch = new THREE.Mesh(new THREE.TorusGeometry(6.2, 1.15, 8, 22, Math.PI), rockMat)
            arch.position.set(spec.x, y, spec.z)
            arch.rotation.y = spec.rotY
            arch.castShadow = true
            arch.receiveShadow = true
            this.group.add(arch)
        }
    }

    setReturnBeacon()
    {
        this.beaconPos = new THREE.Vector3(0, 0, 24)
        const baseY = UnderwaterWorld.sampleSeabedHeight(this.beaconPos.x, this.beaconPos.z)

        const baseMat = new MeshDefaultMaterial({ colorNode: color('#e9f4ff'), hasWater: false, hasLightBounce: false })
        const goldMat = new MeshDefaultMaterial({ colorNode: color('#ffd166'), hasWater: false, hasLightBounce: false })

        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.8, 0.2, 16), baseMat)
        plinth.position.set(this.beaconPos.x, baseY + 0.1, this.beaconPos.z)
        this.group.add(plinth)

        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.12, 8, 32), goldMat)
        ring.rotation.x = Math.PI * 0.5
        ring.position.set(this.beaconPos.x, baseY + 0.22, this.beaconPos.z)
        this.group.add(ring)

        const colMat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        colMat.outputNode = Fn(() =>
        {
            const vFade = smoothstep(float(0.0), float(0.15), uv().y)
            const pulse = sin(uv().y.mul(16.0).sub(this.timeUniform.mul(4.0))).mul(0.5).add(0.5)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#9beeff').mul(2.0)), vFade.mul(0.32).add(pulse.mul(0.12)))
        })()
        const column = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.2, 24, 24, 1, true), colMat)
        column.position.set(this.beaconPos.x, baseY + 12, this.beaconPos.z)
        this.group.add(column)

        const haloMat = new THREE.MeshBasicNodeMaterial()
        haloMat.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#ffe066').mul(2.1)), 1))()
        this.returnHalo = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.11, 8, 32), haloMat)
        this.returnHalo.rotation.x = Math.PI * 0.5
        this.returnHalo.position.set(this.beaconPos.x, baseY + 6.5, this.beaconPos.z)
        this.group.add(this.returnHalo)

        this.game.interactivePoints.create(
            new THREE.Vector3(this.beaconPos.x, baseY + 1.8, this.beaconPos.z),
            () => this.game.i18n.t('prompt.underwater.surface'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.game.worldManager?.exitUnderwater()
            },
            () => this.game.inputs.interactiveButtons.addItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            'underwater'
        )
    }

    setCapsules()
    {
        const specs = [
            { id: 'gitops', x: -32, z: -10, key: 'underwater.capsule.gitops', color: '#34cfc4' },
            { id: 'data',   x:  32, z: -12, key: 'underwater.capsule.data',   color: '#ffd166' },
            { id: 'webgpu', x: -28, z: -48, key: 'underwater.capsule.webgpu', color: '#7ce8ff' },
            { id: 'oss',    x:  28, z: -48, key: 'underwater.capsule.oss',    color: '#ff9f68' },
        ]

        const shellMat = new MeshDefaultMaterial({ colorNode: color('#e9f4ff'), transparent: true, hasWater: false, hasLightBounce: false })
        this.capsules = []

        for(const spec of specs)
        {
            const y = UnderwaterWorld.sampleSeabedHeight(spec.x, spec.z)
            const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 0.5, 12), shellMat)
            pedestal.position.set(spec.x, y + 0.25, spec.z)
            this.group.add(pedestal)

            const coreMat = new THREE.MeshBasicNodeMaterial()
            coreMat.outputNode = Fn(() =>
            {
                return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color(spec.color).mul(1.8)), 1)
            })()
            const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 1), coreMat)
            orb.position.set(spec.x, y + 2.0, spec.z)
            this.group.add(orb)
            this.capsules.push({ orb, baseY: y + 2.0, phase: spec.x * 0.2 })

            this.game.interactivePoints.create(
                new THREE.Vector3(spec.x, y + 2.2, spec.z),
                () => this.game.i18n.t(`${spec.key}.title`),
                InteractivePoints.ALIGN_RIGHT,
                InteractivePoints.STATE_CONCEALED,
                () =>
                {
                    this.sounds.capsule.play()
                    this.game.achievements.setProgress('underwaterCapsules', spec.id)
                    const title = this.game.i18n.t(`${spec.key}.title`)
                    const desc = this.game.i18n.t(`${spec.key}.desc`)
                    this.game.notifications.show(
                        /* html */`<div class="discovery"><strong>${title}</strong> — ${desc}</div>`,
                        'discovery',
                        5,
                        null,
                        `uw-${spec.id}`
                    )
                },
                () => this.game.inputs.interactiveButtons.addItems([ 'interact' ]),
                () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
                () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
                'underwater'
            )
        }
    }

    setRingCourse()
    {
        const ringCoords = [
            [ -14, 3.2,   2 ],
            [ -28, 5.2, -20 ],
            [ -16, 6.8, -42 ],
            [   0, 5.5, -56 ],
            [  18, 6.8, -42 ],
            [  30, 5.0, -20 ],
            [  22, 3.6,   4 ],
            [   8, 3.2,  10 ],
        ]

        const activeMat = new THREE.MeshBasicNodeMaterial()
        activeMat.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#ffe066').mul(2.4)), 1))()

        const idleMat = new THREE.MeshBasicNodeMaterial()
        idleMat.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#34cfc4').mul(1.4)), 1))()

        const doneMat = new THREE.MeshBasicNodeMaterial()
        doneMat.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#76e883').mul(1.8)), 1))()

        const ringGeo = new THREE.TorusGeometry(3.2, 0.24, 10, 32)
        this.course = {
            activeMat,
            idleMat,
            doneMat,
            rings: [],
            nextIndex: 0,
            running: false,
            startTime: 0,
        }

        for(let i = 0; i < ringCoords.length; i++)
        {
            const [ x, yOffset, z ] = ringCoords[i]
            const groundY = UnderwaterWorld.sampleSeabedHeight(x, z)
            const pos = new THREE.Vector3(x, groundY + yOffset, z)

            const next = ringCoords[(i + 1) % ringCoords.length]
            const mesh = new THREE.Mesh(ringGeo, i === 0 ? activeMat : idleMat)
            mesh.position.copy(pos)
            mesh.lookAt(next[0], UnderwaterWorld.sampleSeabedHeight(next[0], next[2]) + next[1], next[2])
            this.group.add(mesh)

            this.course.rings.push({ index: i, position: pos, mesh })
        }
    }

    setActive(active)
    {
        this.active = !!active
        this.group.visible = this.active
        for(const body of this.bodies)
            body.setEnabled(this.active)

        if(this.active)
        {
            // Resetar progresso parcial da corrida ao mergulhar
            this.course.running = false
            this.course.nextIndex = 0
            for(let i = 0; i < this.course.rings.length; i++)
            {
                this.course.rings[i].mesh.material = i === 0 ? this.course.activeMat : this.course.idleMat
                this.course.rings[i].mesh.scale.setScalar(1)
            }
            this.updateHud()
        }
    }

    updateHud()
    {
        if(!this.hud?.statusEl || !this.hud?.metaEl)
            return

        let statusText = ''
        let metaText = ''

        if(this.course.running)
        {
            const elapsed = Math.max(0, this.game.ticker.elapsed - this.course.startTime).toFixed(1)
            statusText = this.game.i18n.t('hud.underwater.ring', {
                current: this.course.nextIndex + 1,
                total: this.course.rings.length,
                time: elapsed
            })
        }
        else
        {
            statusText = this.game.i18n.t('hud.underwater.title')
        }

        const capGroup = this.game.achievements.groups.get('underwaterCapsules')
        const capCount = capGroup && capGroup.progress instanceof Set ? capGroup.progress.size : 0
        let bestMs = Infinity
        try { bestMs = parseInt(localStorage.getItem(UW_CIRCUIT_BEST_KEY), 10) || Infinity } catch(e) {}
        const bestPart = Number.isFinite(bestMs)
            ? this.game.i18n.t('hud.underwater.best', { time: `${(bestMs / 1000).toFixed(2)}s` })
            : this.game.i18n.t('hud.underwater.noBest')
        const depthVal = Math.max(0, Math.round((22 - (this.game.player?.position?.y ?? 2)) * 2) / 2).toFixed(1)
        const depthPart = this.game.i18n.t('hud.underwater.depth', { depth: depthVal })
        metaText = `${this.game.i18n.t('hud.underwater.capsules', { count: capCount, total: 4 })} · ${depthPart} · ${bestPart}`

        if(statusText !== this.hud.lastStatus)
        {
            this.hud.statusEl.textContent = statusText
            this.hud.lastStatus = statusText
        }
        if(metaText !== this.hud.lastMeta)
        {
            this.hud.metaEl.textContent = metaText
            this.hud.lastMeta = metaText
        }
    }

    update()
    {
        const t = this.game.ticker.elapsedScaled
        this.timeUniform.value = t

        this.kelpForest.update()
        this.marineLife.update()

        if(this.returnHalo)
        {
            this.returnHalo.position.y = UnderwaterWorld.sampleSeabedHeight(this.beaconPos.x, this.beaconPos.z) + 6.5 + Math.sin(t * 2.0) * 0.35
            this.returnHalo.rotation.z = t * 0.65
        }

        for(const c of this.capsules)
        {
            c.orb.position.y = c.baseY + Math.sin(t * 1.6 + c.phase) * 0.28
            c.orb.rotation.y = t * 0.8 + c.phase
        }

        // Pulso visual no proximo anel ativo do slalom
        for(let i = 0; i < this.course.rings.length; i++)
        {
            const s = i === this.course.nextIndex ? 1 + Math.sin(t * 4.2) * 0.065 : 1
            this.course.rings[i].mesh.scale.setScalar(s)
        }

        // Checar progresso nas argolas 3D
        const playerPos = this.game.player.position
        const target = this.course.rings[this.course.nextIndex]
        if(target && playerPos.distanceTo(target.position) < 3.8)
        {
            if(target.index === 0)
            {
                this.course.running = true
                this.course.startTime = this.game.ticker.elapsed
            }

            target.mesh.material = this.course.doneMat
            target.mesh.scale.setScalar(1)
            this.sounds.checkpoint.play(target.index)
            if(this.game.world.confetti)
                this.game.world.confetti.pop(target.position.clone())

            this.course.nextIndex++
            if(this.course.nextIndex >= this.course.rings.length)
            {
                const elapsedMs = Math.round((this.game.ticker.elapsed - this.course.startTime) * 1000)
                let bestMs = Infinity
                try { bestMs = parseInt(localStorage.getItem(UW_CIRCUIT_BEST_KEY), 10) || Infinity } catch(e) {}
                const isNewBest = elapsedMs < bestMs
                if(isNewBest)
                {
                    try { localStorage.setItem(UW_CIRCUIT_BEST_KEY, String(elapsedMs)) } catch(e) {}
                }

                this.sounds.finish.play()
                this.game.achievements.setProgress('underwaterCourse', 1)

                const timeStr = `${(elapsedMs / 1000).toFixed(2)}s`
                this.game.notifications.show(
                    /* html */`<div class="discovery">${this.game.i18n.t(isNewBest ? 'underwater.course.best' : 'underwater.course.done', { time: timeStr })}</div>`,
                    'discovery',
                    4,
                    null,
                    'uw-course'
                )

                this.course.running = false
                this.course.nextIndex = 0
                for(let i = 0; i < this.course.rings.length; i++)
                    this.course.rings[i].mesh.material = i === 0 ? this.course.activeMat : this.course.idleMat
            }
            else
            {
                this.course.rings[this.course.nextIndex].mesh.material = this.course.activeMat
            }
        }

        this.updateHud()
    }
}
