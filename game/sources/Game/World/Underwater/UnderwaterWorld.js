import * as THREE from 'three/webgpu'
import { color, float, Fn, min, mix, positionWorld, sin, smoothstep, texture, uniform, uv, vec2, vec4 } from 'three/tsl'
import { Howler } from 'howler'
import { Game } from '../../Game.js'
import { InteractivePoints } from '../../InteractivePoints.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'
import { KelpForest } from './KelpForest.js'
import { MarineLife } from './MarineLife.js'

const UW_CIRCUIT_BEST_KEY = 'vn_uw_circuit_v1'

/**
 * Mundo Subaquatico (Expedicao Abissal):
 * - Bacia 192x192m com solo arenoso, causticas TSL e parede contenida (r <= 72m)
 * - 4 biomas/marcos solidos: Habitat Submarino, Naufragio do Galeao, Fendas Hidrotermais (correntes ascendentes) e Ruinas de Cristal
 * - Deflexao hidrodinamica 3D solida contra todas as barreiras (arcos, corais, cascos, pilares, pedras)
 * - 5 Amêijoas Gigantes com Perolas, Sonar Ativo [F], Arraias & Aguas-Vivas e Slalom Turbo com Seta Guia
 */
export class UnderwaterWorld
{
    constructor()
    {
        this.game = Game.getInstance()
        this.active = false
        this.bodies = []
        this.obstacles = []
        this.updrafts = []
        this.pearls = []
        this.pearlsFound = 0
        this.turboTimer = 0
        this.bumpCooldown = 0
        this.sonarPingTimer = 0
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
                onPlay: (item, step) => { item.rate = 1 + step * 0.06 }
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
        this.setShipwreck()
        this.setThermalVents()
        this.setCrystalRuins()
        this.setReturnBeacon()
        this.setCapsules()
        this.setPearlClams()
        this.setRingCourse()
        this.setSonarAndArrow()

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
            if(this.active) this.updateHud()
        })

        window.addEventListener('keydown', (e) =>
        {
            if(this.active && e.code === 'KeyF')
                this.triggerSonar()
        })

        this.game.ticker.events.on('tick', () =>
        {
            if(this.active) this.update()
        }, 10)
    }

    static sampleSeabedHeight(wx, wz)
    {
        const r = Math.hypot(wx, wz)
        const tPlaza = Math.min(1, Math.max(0, (r - 12) / 14))
        const plazaClear = tPlaza * tPlaza * (3 - 2 * tPlaza)

        const dunes = Math.sin(wx * 0.075) * Math.cos(wz * 0.08) * 1.1
            + Math.sin(wx * 0.035 + wz * 0.045) * 0.7

        const tWall = Math.min(1, Math.max(0, (r - 74) / 18))
        const wall = tWall * tWall * 12.0

        return dunes * plazaClear + wall
    }

    sampleSeabedHeightAt(wx, wz)
    {
        return UnderwaterWorld.sampleSeabedHeight(wx, wz)
    }

    // Helpers fisicos & colisao hidrodinamica solida
    addSolidCylinder(x, z, radius, yMin = -2, yMax = 12)
    {
        const halfH = Math.max(0.5, (yMax - yMin) * 0.5)
        const midY = (yMin + yMax) * 0.5
        const phys = this.game.physics.getPhysical({
            type: 'fixed',
            enabled: false,
            position: new THREE.Vector3(x, midY, z),
            colliders: [ { shape: 'cylinder', parameters: [ halfH, radius ], category: 'object' } ]
        })
        this.bodies.push(phys.body)
        this.obstacles.push({ type: 'cyl', x, z, r: radius, yMin, yMax })
    }

    addSolidSphere(x, y, z, radius)
    {
        const phys = this.game.physics.getPhysical({
            type: 'fixed',
            enabled: false,
            position: new THREE.Vector3(x, y, z),
            colliders: [ { shape: 'ball', parameters: [ radius ], category: 'object' } ]
        })
        this.bodies.push(phys.body)
        this.obstacles.push({ type: 'sphere', x, y, z, r: radius })
    }

    resolveObstacleCollisions(pos, vel, subRadius = 1.55)
    {
        let hit = false
        for(let iter = 0; iter < 2; iter++)
        {
            for(const ob of this.obstacles)
            {
                if(ob.type === 'cyl')
                {
                    if(pos.y + 1.1 < ob.yMin || pos.y - 1.1 > ob.yMax)
                        continue
                    const dx = pos.x - ob.x
                    const dz = pos.z - ob.z
                    const dist = Math.hypot(dx, dz)
                    const minDist = ob.r + subRadius
                    if(dist < minDist)
                    {
                        const nx = dist > 1e-4 ? dx / dist : 1
                        const nz = dist > 1e-4 ? dz / dist : 0
                        pos.x = ob.x + nx * minDist
                        pos.z = ob.z + nz * minDist
                        const vn = vel.x * nx + vel.z * nz
                        if(vn < 0)
                        {
                            vel.x -= nx * vn * 1.25
                            vel.z -= nz * vn * 1.25
                        }
                        hit = true
                    }
                }
                else
                {
                    const dx = pos.x - ob.x
                    const dy = pos.y - ob.y
                    const dz = pos.z - ob.z
                    const dist = Math.hypot(dx, dy, dz)
                    const minDist = ob.r + subRadius
                    if(dist < minDist)
                    {
                        const inv = dist > 1e-4 ? 1 / dist : 1
                        const nx = dist > 1e-4 ? dx * inv : 0
                        const ny = dist > 1e-4 ? dy * inv : 1
                        const nz = dist > 1e-4 ? dz * inv : 0
                        pos.x = ob.x + nx * minDist
                        pos.y = ob.y + ny * minDist
                        pos.z = ob.z + nz * minDist
                        const vn = vel.x * nx + vel.y * ny + vel.z * nz
                        if(vn < 0)
                        {
                            vel.x -= nx * vn * 1.25
                            vel.z -= nz * vn * 1.25
                        }
                        hit = true
                    }
                }
            }
        }
        return hit
    }

    onHullBump(pos)
    {
        if(this.bumpCooldown > 0) return
        this.bumpCooldown = 0.35
        this.playUwTone(115, 0.16, 'triangle', 0.11, 52)
        if(this.game.world?.confetti && pos)
            this.game.world.confetti.pop(pos.clone().setY(pos.y + 0.5))
    }

    sampleUpdraftAt(wx, wy, wz)
    {
        let lift = 0
        for(const v of this.updrafts)
        {
            const d = Math.hypot(wx - v.x, wz - v.z)
            if(d < v.radius && wy > v.baseY + 2.2 && wy < v.baseY + 10.5)
                lift = Math.max(lift, 4.4 * (1 - d / v.radius))
        }
        return lift
    }

    playUwTone(freq, duration = 0.25, wave = 'sine', peak = 0.11, endFreq = null)
    {
        if(this.game.audio?.mute?.active) return
        try
        {
            const ctx = Howler.ctx || new (window.AudioContext || window.webkitAudioContext)()
            if(!ctx) return
            if(ctx.state === 'suspended') ctx.resume()
            const dest = Howler.masterGain || ctx.destination
            const t0 = ctx.currentTime
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = wave
            osc.frequency.setValueAtTime(freq, t0)
            if(endFreq)
                osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration)
            gain.gain.setValueAtTime(0.0001, t0)
            gain.gain.linearRampToValueAtTime(peak, t0 + 0.015)
            gain.gain.exponentialRampToValueAtTime(0.0006, t0 + duration)
            osc.connect(gain)
            gain.connect(dest)
            osc.start(t0)
            osc.stop(t0 + duration + 0.03)
        }
        catch(e) {}
    }

    mat(hex)
    {
        return new MeshDefaultMaterial({ colorNode: color(hex), hasWater: false, hasLightBounce: false })
    }

    glowMat(hex, mult = 1.8)
    {
        const m = new THREE.MeshBasicNodeMaterial()
        m.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color(hex).mul(mult)), 1))()
        return m
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
        const coralMats = [ '#ff6f91', '#ff9f43', '#34cfc4', '#ffd166', '#9b72ff' ].map(h => this.mat(h))
        const rockMat = this.mat('#476b82')

        // Clusters variados: Cerebro, Prato em camadas e Galhos — todos com colisao solida
        const clusters = [
            [ -16, 6 ], [ 16, 4 ], [ -24, 24 ], [ 22, 22 ], [ -48, -22 ], [ 48, -22 ],
            [ -12, -24 ], [ 14, -26 ], [ -46, 20 ], [ 46, 16 ], [ 0, -64 ], [ -54, -44 ], [ 54, -44 ]
        ]

        const stalkGeo = new THREE.CylinderGeometry(0.28, 0.42, 1.8, 7)
        const capGeo = new THREE.DodecahedronGeometry(0.7, 0)
        const discGeo = new THREE.CylinderGeometry(1.35, 0.65, 0.28, 10)

        for(let i = 0; i < clusters.length; i++)
        {
            const [ cx, cz ] = clusters[i]
            const yBase = UnderwaterWorld.sampleSeabedHeight(cx, cz)
            const mat = coralMats[i % coralMats.length]

            const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.85, 0), rockMat)
            rock.scale.set(1.2, 0.82, 1.1)
            rock.position.set(cx, yBase + 0.5, cz)
            rock.castShadow = true
            rock.receiveShadow = true
            this.group.add(rock)

            // Colisor solido de cilindro cobrindo toda a altura do recife de coral
            this.addSolidCylinder(cx, cz, 2.0, yBase - 1, yBase + 3.4)

            if(i % 3 === 0)
            {
                // Coral-cerebro + galhos
                const brain = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), mat)
                brain.scale.set(1.1, 0.78, 1.0)
                brain.position.set(cx, yBase + 1.55, cz)
                this.group.add(brain)
            }
            else if(i % 3 === 1)
            {
                // Coral-prato em 3 degraus
                for(let l = 0; l < 3; l++)
                {
                    const d = new THREE.Mesh(discGeo, mat)
                    d.scale.setScalar(1 - l * 0.24)
                    d.position.set(cx + (l - 1) * 0.35, yBase + 1.15 + l * 0.55, cz + (l % 2) * 0.25)
                    this.group.add(d)
                }
            }
            else
            {
                // Corais tubulares
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
        }

        // 3 Arcos de pedra naturais com pilares + lintel superiores solidos!
        const archSpecs = [
            { x:   0, z: -28, rotY: 0 },
            { x: -38, z: -32, rotY: 0.7 },
            { x:  36, z:  18, rotY: -0.55 },
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

            const ca = Math.cos(spec.rotY)
            const sa = Math.sin(spec.rotY)
            for(const side of [ -1, 1 ])
            {
                const px = spec.x + side * 6.0 * ca
                const pz = spec.z - side * 6.0 * sa
                this.addSolidCylinder(px, pz, 1.35, y - 1, y + 4.4)
            }
            // Arco superior em esferas solidas
            for(let k = -2; k <= 2; k++)
            {
                const a = Math.PI * 0.5 + k * 0.34
                const ax = spec.x + Math.cos(a) * 6.2 * ca
                const az = spec.z - Math.cos(a) * 6.2 * sa
                const ay = y + Math.sin(a) * 6.2
                this.addSolidSphere(ax, ay, az, 1.2)
            }
        }
    }

    setShipwreck()
    {
        const cx = -36
        const cz = -4
        const yBase = UnderwaterWorld.sampleSeabedHeight(cx, cz)
        const wood = this.mat('#6b4423')
        const darkWood = this.mat('#3d2514')
        const iron = this.mat('#475569')
        const glowChest = this.glowMat('#34cfc4', 1.8)

        const wreck = new THREE.Group()
        wreck.position.set(cx, yBase + 0.5, cz)
        wreck.rotation.y = 0.42
        wreck.rotation.z = 0.22 // Adornado inclinado na areia

        // Quilha & casco
        const hull = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.5, 9.6), darkWood)
        hull.position.y = 0.65
        wreck.add(hull)
        const bow = new THREE.Mesh(new THREE.ConeGeometry(2.1, 3.8, 5), darkWood)
        bow.rotation.x = Math.PI * 0.5
        bow.position.set(0, 1.0, 6.2)
        wreck.add(bow)
        const stern = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.3, 2.6), wood)
        stern.position.set(0, 1.45, -3.9)
        wreck.add(stern)

        // 5 cavernas (costelas) arqueadas
        for(let r = -2; r <= 2; r++)
        {
            const rib = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.16, 6, 12, Math.PI), wood)
            rib.rotation.x = Math.PI
            rib.position.set(0, 2.4, r * 1.75)
            wreck.add(rib)
        }

        // Mastro partido + cesto da gavea
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 6.8, 8), wood)
        mast.position.set(0, 4.1, 0.4)
        mast.rotation.z = -0.14
        wreck.add(mast)
        const yard = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 0.16), darkWood)
        yard.position.set(0, 5.4, 0.4)
        yard.rotation.z = 0.2
        wreck.add(yard)

        // Ancora de ferro + 2 baus cintilantes
        const anchor = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.1, 6, 12), iron)
        anchor.position.set(2.1, 0.4, 4.5)
        wreck.add(anchor)
        for(const bz of [ -1.4, 1.8 ])
        {
            const chest = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.65, 0.65), glowChest)
            chest.position.set(2.4, 0.1, bz)
            wreck.add(chest)
        }

        this.group.add(wreck)

        // Colisores solidos ao longo de toda a extensao do galeao
        const ca = Math.cos(0.42)
        const sa = Math.sin(0.42)
        for(const localZ of [ -3.6, 0, 3.8 ])
        {
            const wx = cx + localZ * sa
            const wz = cz + localZ * ca
            this.addSolidCylinder(wx, wz, 2.35, yBase - 1, yBase + 4.8)
        }
    }

    setThermalVents()
    {
        const basalt = this.mat('#1e293b')
        const lavaGlow = this.glowMat('#ff6b2b', 2.2)

        const spots = [
            [ 34, -4 ], [ 28, 12 ], [ 38, -22 ], [ 18, -28 ], [ -18, 18 ]
        ]
        this.vents = []

        for(const [ vx, vz ] of spots)
        {
            const yBase = UnderwaterWorld.sampleSeabedHeight(vx, vz)
            const g = new THREE.Group()
            g.position.set(vx, yBase, vz)

            const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 2.1, 2.9, 9), basalt)
            cone.position.y = 1.45
            g.add(cone)

            const crater = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.52, 0.25, 9), lavaGlow)
            crater.position.y = 2.86
            g.add(crater)

            const plumeMat = new THREE.MeshBasicNodeMaterial({
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            })
            plumeMat.outputNode = Fn(() =>
            {
                const fade = smoothstep(float(0), float(0.18), uv().y).mul(smoothstep(float(1), float(0.25), uv().y))
                return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#68e1fd').mul(1.6)), fade.mul(0.24))
            })()
            const plume = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.75, 7.6, 12, 1, true), plumeMat)
            plume.position.y = 6.6
            g.add(plume)

            this.group.add(g)
            this.addSolidCylinder(vx, vz, 1.85, yBase - 1, yBase + 3.0)
            this.updrafts.push({ x: vx, z: vz, baseY: yBase, radius: 3.8 })
            this.vents.push({ plume, crater })
        }
    }

    setCrystalRuins()
    {
        const marble = this.mat('#cbd5e1')
        const cryColors = [ '#38bdf8', '#a855f7', '#34cfc4' ].map(h => this.glowMat(h, 1.85))
        this.crystals = []

        // Aglomerados de cristais bioluminescentes no Canion Norte
        const clusters = [
            [ -16, -42 ], [ 14, -42 ], [ -42, -50 ], [ 40, -48 ], [ -4, -60 ]
        ]
        for(let i = 0; i < clusters.length; i++)
        {
            const [ cx, cz ] = clusters[i]
            const yBase = UnderwaterWorld.sampleSeabedHeight(cx, cz)
            const mat = cryColors[i % cryColors.length]

            for(let s = 0; s < 3; s++)
            {
                const a = (s / 3) * Math.PI * 2 + i * 0.5
                const h = 3.2 + (s % 2) * 1.6
                const shard = new THREE.Mesh(new THREE.ConeGeometry(0.65, h, 5), mat)
                shard.position.set(cx + Math.cos(a) * 0.85, yBase + h * 0.45, cz + Math.sin(a) * 0.85)
                shard.rotation.z = (s - 1) * 0.22
                shard.rotation.x = (s % 2 === 0 ? 0.16 : -0.16)
                this.group.add(shard)
                this.crystals.push(shard)
            }
            this.addSolidCylinder(cx, cz, 1.55, yBase - 1, yBase + 5.2)
        }

        // Colunas classicas submersas perto das ruinas
        const colCoords = [
            [ -22, -52, 4.4 ], [ -12, -56, 2.2 ], [ 12, -56, 4.4 ], [ 22, -52, 2.6 ]
        ]
        for(const [ px, pz, h ] of colCoords)
        {
            const yBase = UnderwaterWorld.sampleSeabedHeight(px, pz)
            const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, h, 10), marble)
            col.position.set(px, yBase + h * 0.5, pz)
            this.group.add(col)
            this.addSolidCylinder(px, pz, 0.9, yBase - 1, yBase + h + 0.3)
        }
    }

    setReturnBeacon()
    {
        // Base Submarina com Domo de Vidro Ciano & Anel de Atracacao (0, 24)
        this.beaconPos = new THREE.Vector3(0, 0, 24)
        const baseY = UnderwaterWorld.sampleSeabedHeight(this.beaconPos.x, this.beaconPos.z)

        const steel = this.mat('#334155')
        const ivory = this.mat('#e9f4ff')
        const gold = this.mat('#ffd166')
        const glassMat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        })
        glassMat.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#67e8f9').mul(1.35)), 0.36))()

        // Plataforma de atracacao em z = 21..24 e Domo Habitat atras em z = 27.2
        const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.0, 0.24, 16), ivory)
        plinth.position.set(0, baseY + 0.12, 23.8)
        this.group.add(plinth)

        const dockRing = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.14, 8, 32), gold)
        dockRing.rotation.x = Math.PI * 0.5
        dockRing.position.set(0, baseY + 0.25, 22.8)
        this.group.add(dockRing)

        // Domo Habitat em (0, baseY, 27.6)
        const domeX = 0
        const domeZ = 27.8
        const domeBase = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.3, 0.6, 12), steel)
        domeBase.position.set(domeX, baseY + 0.3, domeZ)
        this.group.add(domeBase)

        const glassDome = new THREE.Mesh(new THREE.SphereGeometry(2.7, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), glassMat)
        glassDome.position.set(domeX, baseY + 0.55, domeZ)
        this.group.add(glassDome)

        const coreGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.5, 10), this.glowMat('#ffe066', 1.6))
        coreGlow.position.set(domeX, baseY + 1.3, domeZ)
        this.group.add(coreGlow)

        this.addSolidCylinder(domeX, domeZ, 2.85, baseY - 1, baseY + 3.6)

        // Feixe guia vertical para voltar a superficie
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
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#9beeff').mul(1.15)), vFade.mul(0.18).add(pulse.mul(0.07)))
        })()
        const column = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.2, 22, 24, 1, true), colMat)
        column.position.set(0, baseY + 11, 22.8)
        this.group.add(column)

        const haloMat = this.glowMat('#ffe066', 2.1)
        this.returnHalo = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.11, 8, 32), haloMat)
        this.returnHalo.rotation.x = Math.PI * 0.5
        this.returnHalo.position.set(0, baseY + 6.5, 22.8)
        this.group.add(this.returnHalo)

        this.game.interactivePoints.create(
            new THREE.Vector3(0, baseY + 1.8, 22.8),
            () => this.game.i18n.t('prompt.underwater.surface'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () => { this.game.worldManager?.exitUnderwater() },
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
            const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 0.7, 12), shellMat)
            pedestal.position.set(spec.x, y + 0.35, spec.z)
            this.group.add(pedestal)

            // Pedestal solido (submarino nao atravessa o cilindro central)
            this.addSolidCylinder(spec.x, spec.z, 1.45, y - 1, y + 1.55)

            const coreMat = this.glowMat(spec.color, 1.8)
            const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 1), coreMat)
            orb.position.set(spec.x, y + 2.2, spec.z)
            this.group.add(orb)
            this.capsules.push({ orb, baseY: y + 2.2, phase: spec.x * 0.2, pos: new THREE.Vector3(spec.x, y + 2.2, spec.z) })

            this.game.interactivePoints.create(
                new THREE.Vector3(spec.x, y + 2.4, spec.z),
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

    setPearlClams()
    {
        const shellMat = this.mat('#cbd5e1')
        const lipMat = this.mat('#a78bfa')
        const pearlMat = this.glowMat('#fff3b0', 2.2)

        const clamCoords = [
            [ -34,   4 ], // Perto do Naufragio
            [ -42, -38 ], // Arco Oeste
            [   0, -52 ], // Ruinas Norte
            [  36, -10 ], // Fendas Hidrotermais
            [  28,  20 ], // Recife SE
        ]

        this.pearls = []
        for(let i = 0; i < clamCoords.length; i++)
        {
            const [ x, z ] = clamCoords[i]
            const y = UnderwaterWorld.sampleSeabedHeight(x, z)
            const g = new THREE.Group()
            g.position.set(x, y + 0.15, z)

            const bottomShell = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.85, 0.35, 8), shellMat)
            g.add(bottomShell)

            const upperPivot = new THREE.Group()
            upperPivot.position.set(0, 0.18, -0.75)
            const topShell = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.1, 0.32, 8), lipMat)
            topShell.position.set(0, 0.16, 0.75)
            upperPivot.add(topShell)
            g.add(upperPivot)

            const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), pearlMat)
            pearl.position.set(0, 0.48, 0)
            g.add(pearl)

            this.group.add(g)
            this.pearls.push({
                group: g,
                upperPivot,
                pearl,
                pos: new THREE.Vector3(x, y + 0.8, z),
                collected: false,
                openRatio: 0
            })
        }
    }

    setRingCourse()
    {
        const ringCoords = [
            [ -14, 3.2,   2 ],
            [ -28, 5.0, -20 ],
            [ -16, 6.4, -42 ],
            [   0, 5.4, -56 ],
            [  18, 6.4, -42 ],
            [  30, 4.8, -20 ],
            [  22, 3.6,   4 ],
            [   8, 3.2,  10 ],
        ]

        const activeMat = this.glowMat('#ffe066', 2.4)
        const idleMat = this.glowMat('#34cfc4', 1.4)
        const doneMat = this.glowMat('#76e883', 1.8)

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

    setSonarAndArrow()
    {
        // Onda de Sonar 3D expansiva (tecla F)
        const sonarMat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        })
        sonarMat.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#68e1fd').mul(2.1)), 0.72))()
        this.sonarMesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.25, 42), sonarMat)
        this.sonarMesh.rotation.x = -Math.PI * 0.5
        this.sonarMesh.visible = false
        this.group.add(this.sonarMesh)

        // Seta 3D flutuante apontando para a proxima argola do Slalom
        const arrowGroup = new THREE.Group()
        const mat = this.glowMat('#fde047', 2.1)
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.65), mat)
        shaft.position.z = -0.18
        arrowGroup.add(shaft)
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.56, 4), mat)
        tip.rotation.x = Math.PI * 0.5
        tip.position.z = 0.36
        arrowGroup.add(tip)
        arrowGroup.visible = false
        this.group.add(arrowGroup)
        this.guideArrow = arrowGroup
    }

    triggerSonar()
    {
        if(!this.active) return
        const p = this.game.player?.position
        if(!p) return
        this.sonarPingTimer = 1.8
        this.sonarMesh.visible = true
        this.sonarMesh.position.set(p.x, Math.max(0.4, p.y - 0.3), p.z)
        this.sonarMesh.scale.setScalar(1)
        this.playUwTone(1320, 0.55, 'sine', 0.14, 1180)
        setTimeout(() => { if(this.active) this.playUwTone(1320, 0.45, 'sine', 0.055, 1180) }, 220)
    }

    setActive(active)
    {
        this.active = !!active
        this.group.visible = this.active
        for(const body of this.bodies)
            body.setEnabled(this.active)

        if(this.active)
        {
            this.turboTimer = 0
            this.sonarPingTimer = 0
            if(this.sonarMesh) this.sonarMesh.visible = false
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
        if(!this.hud?.statusEl || !this.hud?.metaEl) return

        const statusText = this.course.running
            ? this.game.i18n.t('hud.underwater.ring', {
                current: this.course.nextIndex + 1,
                total: this.course.rings.length,
                time: Math.max(0, this.game.ticker.elapsed - this.course.startTime).toFixed(1)
            })
            : this.game.i18n.t('hud.underwater.title')

        const capGroup = this.game.achievements.groups.get('underwaterCapsules')
        const capCount = capGroup && capGroup.progress instanceof Set ? capGroup.progress.size : 0
        let bestMs = Infinity
        try { bestMs = parseInt(localStorage.getItem(UW_CIRCUIT_BEST_KEY), 10) || Infinity } catch(e) {}
        const bestPart = Number.isFinite(bestMs)
            ? this.game.i18n.t('hud.underwater.best', { time: `${(bestMs / 1000).toFixed(2)}s` })
            : this.game.i18n.t('hud.underwater.noBest')
        const depthVal = Math.max(0.5, Math.round((13 - (this.game.player?.position?.y ?? 3)) * 2) / 2).toFixed(1)
        const depthPart = this.game.i18n.t('hud.underwater.depth', { depth: depthVal })
        metaTextFix: {
            const metaText = `${this.game.i18n.t('hud.underwater.capsules', { count: capCount, total: 4, pearls: this.pearlsFound })} · ${depthPart} · ${bestPart}`
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
    }

    update()
    {
        const t = this.game.ticker.elapsedScaled
        const dt = Math.min(0.05, this.game.ticker.delta || 0.016)
        this.timeUniform.value = t

        if(this.bumpCooldown > 0) this.bumpCooldown = Math.max(0, this.bumpCooldown - dt)
        if(this.turboTimer > 0) this.turboTimer = Math.max(0, this.turboTimer - dt)

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

        // Sonar ativo expansivo + destaque nos alvos
        if(this.sonarPingTimer > 0)
        {
            this.sonarPingTimer = Math.max(0, this.sonarPingTimer - dt)
            const p = 1 - this.sonarPingTimer / 1.8
            this.sonarMesh.scale.setScalar(1 + p * 54)
            this.sonarMesh.visible = this.sonarPingTimer > 0.04
        }

        // 5 Amêijoas Gigantes com Pérolas
        const playerPos = this.game.player.position
        for(const cl of this.pearls)
        {
            if(!cl.collected && playerPos.distanceTo(cl.pos) < 4.6)
            {
                cl.collected = true
                this.pearlsFound++
                this.sounds.capsule.play()
                if(this.game.world?.confetti)
                    this.game.world.confetti.pop(cl.pos.clone().setY(cl.pos.y + 1.2))
                this.game.notifications?.show(
                    /* html */`<div class="discovery">${this.game.i18n.t('underwater.pearl.found', { count: this.pearlsFound })}</div>`,
                    'discovery',
                    3.6,
                    null,
                    `uw-pearl-${this.pearlsFound}`
                )
            }
            const targetOpen = cl.collected ? 0.95 : (playerPos.distanceTo(cl.pos) < 8.5 ? 0.45 : 0.12)
            cl.openRatio += (targetOpen - cl.openRatio) * Math.min(1, dt * 6)
            cl.upperPivot.rotation.x = -cl.openRatio
            cl.pearl.visible = !cl.collected
            if(!cl.collected)
                cl.pearl.scale.setScalar(this.sonarPingTimer > 0 ? 1.35 + Math.sin(t * 8) * 0.18 : 1.0)
        }

        // Pulso visual no proximo anel + Seta Guia 3D do Slalom
        const target = this.course.rings[this.course.nextIndex]
        for(let i = 0; i < this.course.rings.length; i++)
        {
            const pulse = i === this.course.nextIndex
                ? (this.sonarPingTimer > 0 ? 1.18 : 1 + Math.sin(t * 4.2) * 0.065)
                : 1
            this.course.rings[i].mesh.scale.setScalar(pulse)
        }

        if(this.guideArrow && target && (this.course.running || playerPos.distanceTo(target.position) < 26))
        {
            this.guideArrow.visible = true
            this.guideArrow.position.set(playerPos.x, playerPos.y + 2.3 + Math.sin(t * 4) * 0.08, playerPos.z)
            this.guideArrow.lookAt(target.position)
        }
        else if(this.guideArrow)
        {
            this.guideArrow.visible = false
        }

        // Checar progresso nas argolas 3D (+ turbo surge 2.2s)
        if(target && playerPos.distanceTo(target.position) < 3.8)
        {
            if(target.index === 0)
            {
                this.course.running = true
                this.course.startTime = this.game.ticker.elapsed
            }

            this.turboTimer = 2.2
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
