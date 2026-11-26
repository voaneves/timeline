import * as THREE from 'three/webgpu'
import { color, Fn, sin, uv, vec4 } from 'three/tsl'
import { Howler } from 'howler'
import { InteractivePoints } from '../../InteractivePoints.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'
import { Area } from './Area.js'

/**
 * Parque das Paixoes (Leste da Ilha) — substitui o antigo Circuito de corrida por 5 mini-games:
 * 1. Agronegocio (24, 0, -14): Empurrar fardos de feno para a area do Silo
 * 2. Tecnologia  (52, 0, -10): Ligar todos os 4 nos do Cluster de servidores
 * 3. Negocios    (54, 0,  22): Coletar 5 marcos dourados e erguer o grafico de crescimento
 * 4. Musica      (28, 0,  34): Piano Gigante no chao + Piano de Cauda & Violao Acustico
 * 5. Musculacao  (20, 0,  10): Treinar PR na barra olimpica ate 220 kg
 */
export class PassionParkArea extends Area
{
    constructor(model)
    {
        super(model)

        this.parkGroup = new THREE.Group()
        this.game.scene.add(this.parkGroup)

        // Mantem compatibilidade defensiva se algum modulo ler area.state
        this.state = 0

        this.sounds = {
            step: this.game.audio.register({
                path: 'sounds/circuit/checkpoint/Win Score 1.mp3',
                autoplay: false,
                loop: false,
                volume: 0.42,
                antiSpam: 0.08,
                onPlay: (item, step = 0) =>
                {
                    item.rate = 1 + step * 0.08
                }
            }),
            win: this.game.audio.register({
                path: 'sounds/circuit/finish/Big Win Fanfare 2.mp3',
                autoplay: false,
                loop: false,
                volume: 0.45
            }),
            coin: this.game.audio.register({
                path: 'sounds/achievements/Money Reward 2.mp3',
                autoplay: false,
                loop: false,
                volume: 0.35,
                antiSpam: 0.08
            })
        }

        this.completed = new Set()
        this.setMaterials()
        this.setAgroArena()
        this.setTechArena()
        this.setBusinessArena()
        this.setMusicArena()
        this.setGymArena()
        this.setAchievement()
    }

    mat(hex)
    {
        return new MeshDefaultMaterial({
            colorNode: color(hex),
            hasWater: false,
            hasLightBounce: false
        })
    }

    glowMat(hex, mult = 1.6)
    {
        const m = new THREE.MeshBasicNodeMaterial()
        m.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color(hex).mul(mult)), 1))()
        return m
    }

    setMaterials()
    {
        this.palette = {
            silver:   this.mat('#cbd5e1'),
            steel:    this.mat('#475569'),
            dark:     this.mat('#1e293b'),
            pianoBlk: this.mat('#151820'),
            agroGrn:  this.mat('#2d8a4e'),
            agroGold: this.mat('#eab308'),
            hay:      this.mat('#f5c542'),
            wood:     this.mat('#8b5a2b'),
            cedar:    this.mat('#c67c3b'),
            leather:  this.mat('#6b3f24'),
            navy:     this.mat('#1d4ed8'),
            teal:     this.mat('#14b8a6'),
            redPlate: this.mat('#dc2626'),
            bluPlate: this.mat('#2563eb'),
            ylwPlate: this.mat('#facc15'),
            ivory:    this.mat('#f8fafc'),
            stone:    this.mat('#94a3b8'),
            rubber:   this.mat('#262933'),
        }
    }

    addStatic(model, x, y, z, colliders, friction = 0.35)
    {
        model.position.set(x, y, z)
        return this.game.objects.add(
            { model, parent: this.parkGroup, updateMaterials: false },
            { type: 'fixed', position: new THREE.Vector3(x, y, z), rotation: model.quaternion.clone(), enabled: true, friction, colliders }
        )
    }

    addDynamic(model, x, y, z, colliders, mass = 0.25, hitSound = 'hitDefault')
    {
        model.position.set(x, y, z)
        return this.game.objects.add(
            { model, parent: this.parkGroup, updateMaterials: false },
            {
                type: 'dynamic',
                position: new THREE.Vector3(x, y, z),
                rotation: model.quaternion.clone(),
                enabled: true,
                mass,
                friction: 0.55,
                restitution: 0.2,
                canSleep: true,
                onCollision: (force, position) =>
                {
                    this.game.audio.groups.get(hitSound)?.playRandomNext(force, position)
                },
                colliders
            }
        )
    }

    unlockChallenge(id, fxPos)
    {
        this.game.achievements.setProgress('parkTrophies', id)
        this.game.world?.visualVehicle?.unlockCargoTrophy(id)

        if(!this.completed.has(id))
        {
            this.completed.add(id)
            this.sounds.win.play()
        }

        if(fxPos && this.game.world?.confetti)
            this.game.world.confetti.pop(fxPos)

        this.game.notifications?.show(
            /* html */`<div class="discovery">${this.game.i18n.t(`park.${id}.won`)}</div>`,
            'discovery',
            4.5,
            null,
            `park-won-${id}`
        )
    }

    playSynthTone(freq, duration = 0.45, wave = 'triangle', gainPeak = 0.12)
    {
        if(this.game.audio?.mute?.active)
            return
        try
        {
            const ctx = Howler.ctx || new (window.AudioContext || window.webkitAudioContext)()
            if(!ctx)
                return
            if(ctx.state === 'suspended')
                ctx.resume()
            const dest = Howler.masterGain || ctx.destination
            const now = ctx.currentTime
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = wave
            osc.frequency.setValueAtTime(freq, now)
            gain.gain.setValueAtTime(0.0001, now)
            gain.gain.linearRampToValueAtTime(gainPeak, now + 0.025)
            gain.gain.exponentialRampToValueAtTime(0.0008, now + duration)
            osc.connect(gain)
            gain.connect(dest)
            osc.start(now)
            osc.stop(now + duration + 0.04)
        }
        catch(e) {}
    }

    // ========================================================================
    // 1. ARENA AGRO (24, 0, -14) — Colheita no Silo
    // ========================================================================
    setAgroArena()
    {
        const cx = 24
        const cz = -14

        // Silo metalico em (cx - 2.4, cz - 2.2)
        const silo = new THREE.Group()
        const body = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 4.4, 18), this.palette.silver)
        body.position.y = 2.2
        silo.add(body)
        for(const ry of [ 0.9, 2.0, 3.1, 4.2 ])
        {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.05, 6, 20), this.palette.steel)
            ring.rotation.x = Math.PI * 0.5
            ring.position.y = ry
            silo.add(ring)
        }
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.63, 1.63, 0.38, 18), this.palette.agroGrn)
        stripe.position.y = 3.65
        silo.add(stripe)
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.72, 1.4, 18), this.palette.agroGold)
        roof.position.y = 5.05
        silo.add(roof)
        this.addStatic(silo, cx - 2.5, 0, cz - 2.2, [
            { shape: 'cylinder', parameters: [ 2.2, 1.66 ], position: { x: 0, y: 2.2, z: 0 } }
        ])

        // Catavento rural
        const mill = new THREE.Group()
        for(const [ px, pz ] of [ [-0.42,-0.42], [0.42,-0.42], [-0.42,0.42], [0.42,0.42] ])
        {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 4.6, 6), this.palette.steel)
            leg.position.set(px * 0.65, 2.3, pz * 0.65)
            leg.rotation.z = px > 0 ? 0.11 : -0.11
            leg.rotation.x = pz > 0 ? -0.11 : 0.11
            mill.add(leg)
        }
        const rotor = new THREE.Group()
        rotor.position.set(0, 4.65, 0.42)
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.25, 10), this.palette.agroGold)
        hub.rotation.x = Math.PI * 0.5
        rotor.add(hub)
        for(let i = 0; i < 8; i++)
        {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.03), this.palette.silver)
            const a = (i / 8) * Math.PI * 2
            blade.position.set(Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.04)
            blade.rotation.z = a - Math.PI * 0.5
            rotor.add(blade)
        }
        mill.add(rotor)
        this.addStatic(mill, cx + 2.6, 0, cz - 2.3, [
            { shape: 'cuboid', parameters: [ 0.6, 2.4, 0.6 ], position: { x: 0, y: 2.4, z: 0 } }
        ])

        // Zona alvo de entrega de feno diante do silo
        const zonePos = new THREE.Vector3(cx - 2.2, 0.06, cz + 1.2)
        const zoneMat = this.glowMat('#34d399', 1.75)
        const zoneRing = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.95, 32), zoneMat)
        zoneRing.rotation.x = -Math.PI * 0.5
        zoneRing.position.copy(zonePos)
        this.parkGroup.add(zoneRing)

        // 5 fardos de feno cilindricos empurraveis
        const baleSpecs = [
            [ cx + 1.2, 0.50, cz + 1.6 ],
            [ cx + 2.6, 0.50, cz + 2.1 ],
            [ cx + 0.6, 0.50, cz + 3.4 ],
            [ cx + 2.2, 0.50, cz + 3.8 ],
            [ cx + 3.5, 0.50, cz + 0.5 ],
        ]
        const bales = []
        for(const [ bx, by, bz ] of baleSpecs)
        {
            const bale = new THREE.Group()
            const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.78, 14), this.palette.hay)
            roll.rotation.z = Math.PI * 0.5
            bale.add(roll)
            const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.1, 14), this.palette.leather)
            strap.rotation.z = Math.PI * 0.5
            bale.add(strap)

            const obj = this.addDynamic(bale, bx, by, bz, [
                { shape: 'ball', parameters: [ 0.47 ] }
            ], 0.20, 'hitDefault')
            bales.push({ obj, start: new THREE.Vector3(bx, by, bz), delivered: false })
        }

        this.agro = { rotor, zonePos, zoneRing, bales, delivered: 0 }

        this.game.interactivePoints.create(
            new THREE.Vector3(cx - 2.5, 1.5, cz - 0.1),
            () => this.game.i18n.t('prompt.park.agroReset'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.agro.delivered = 0
                for(const b of this.agro.bales)
                {
                    b.delivered = false
                    const bodyPhys = b.obj.physical.body
                    bodyPhys.setTranslation(b.start, true)
                    bodyPhys.setLinvel({ x: 0, y: 0, z: 0 }, true)
                    bodyPhys.setAngvel({ x: 0, y: 0, z: 0 }, true)
                }
                this.sounds.step.play(0)
            },
            () => this.game.inputs.interactiveButtons.addItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            'surface'
        )
    }

    // ========================================================================
    // 2. ARENA TECNOLOGIA (52, 0, -10) — Cluster Online (0/4 -> 4/4)
    // ========================================================================
    setTechArena()
    {
        const cx = 52
        const cz = -10

        const pad = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.08, 4.0), this.palette.steel)
        pad.position.set(cx, 0.04, cz)
        pad.receiveShadow = true
        this.parkGroup.add(pad)

        // Estacao Dev central
        const desk = new THREE.Group()
        const top = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.09, 0.95), this.palette.wood)
        top.position.y = 0.88
        desk.add(top)
        for(const lx of [ -0.88, 0.88 ])
        {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 0.82), this.palette.dark)
            leg.position.set(lx, 0.44, 0)
            desk.add(leg)
        }
        const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.68, 0.06), this.palette.dark)
        monitor.position.set(0, 1.36, -0.22)
        desk.add(monitor)
        const screenMat = new THREE.MeshBasicNodeMaterial()
        screenMat.outputNode = Fn(() =>
        {
            const line = sin(uv().y.mul(36.0)).mul(0.5).add(0.5)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#38bdf8').mul(line.mul(0.75).add(0.45)).mul(1.5)), 1)
        })()
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.56), screenMat)
        screen.position.set(0, 1.36, -0.185)
        desk.add(screen)
        this.addStatic(desk, cx, 0.08, cz - 0.8, [
            { shape: 'cuboid', parameters: [ 1.0, 0.85, 0.5 ], position: { x: 0, y: 0.85, z: 0 } }
        ])

        // Antena de telemetria rotativa
        const dishGroup = new THREE.Group()
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.7, 10), this.palette.silver)
        mast.position.y = 0.85
        dishGroup.add(mast)
        const dishHead = new THREE.Group()
        dishHead.position.y = 1.75
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.15, 0.42, 16), this.palette.ivory)
        bowl.rotation.x = Math.PI * 0.32
        dishHead.add(bowl)
        dishGroup.add(dishHead)
        this.addStatic(dishGroup, cx + 1.8, 0.08, cz - 1.1, [
            { shape: 'cuboid', parameters: [ 0.55, 1.1, 0.55 ], position: { x: 0, y: 1.1, z: 0 } }
        ])

        // 4 Torres de servidor interativas para ativar por aproximacao
        const standbyMat = this.glowMat('#facc15', 1.6)
        const onlineMat = this.glowMat('#22d3ee', 2.2)
        const nodeCoords = [
            [ cx - 3.9, cz - 3.4 ],
            [ cx + 3.9, cz - 3.4 ],
            [ cx - 3.9, cz + 3.4 ],
            [ cx + 3.9, cz + 3.4 ],
        ]
        const nodes = []
        for(const [ nx, nz ] of nodeCoords)
        {
            const tower = new THREE.Group()
            const rack = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.2, 0.9), this.palette.dark)
            rack.position.y = 1.1
            tower.add(rack)
            const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.24, 0.65), standbyMat)
            beacon.position.y = 2.38
            tower.add(beacon)

            this.addStatic(tower, nx, 0, nz, [
                { shape: 'cuboid', parameters: [ 0.55, 1.15, 0.48 ], position: { x: 0, y: 1.15, z: 0 } }
            ])
            nodes.push({ pos: new THREE.Vector3(nx, 0, nz), beacon, online: false })
        }

        this.tech = { dishHead, nodes, onlineCount: 0, standbyMat, onlineMat }

        this.game.interactivePoints.create(
            new THREE.Vector3(cx, 1.5, cz + 1.3),
            () => this.game.i18n.t('prompt.park.techReboot'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.tech.onlineCount = 0
                for(const n of this.tech.nodes)
                {
                    n.online = false
                    n.beacon.material = this.tech.standbyMat
                }
                this.sounds.step.play(0)
            },
            () => this.game.inputs.interactiveButtons.addItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            'surface'
        )
    }

    // ========================================================================
    // 3. ARENA NEGOCIOS (54, 0, 22) — Escada de Crescimento (5 marcos)
    // ========================================================================
    setBusinessArena()
    {
        const cx = 54
        const cz = 22

        // Grafico 3D de barras que crescem conforme os marcos sao coletados
        const chart = new THREE.Group()
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.26, 1.7), this.palette.stone)
        plinth.position.y = 0.13
        chart.add(plinth)

        const barHeights = [ 0.9, 1.35, 1.8, 2.3, 2.85 ]
        const barMats = [ this.palette.navy, this.palette.navy, this.palette.teal, this.palette.teal, this.palette.agroGold ]
        const bars = []
        for(let i = 0; i < barHeights.length; i++)
        {
            const h = barHeights[i]
            const bar = new THREE.Mesh(new THREE.BoxGeometry(0.56, h, 0.56), barMats[i])
            bar.position.set(-1.5 + i * 0.75, 0.26, 0)
            bar.scale.y = 0.25
            chart.add(bar)
            bars.push({ mesh: bar, fullH: h, scaleY: 0.25, targetScaleY: 0.25 })
        }

        const arrowMat = this.glowMat('#ffe066', 2.0)
        const arrow = new THREE.Group()
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.18), arrowMat)
        shaft.rotation.z = -Math.PI * 0.32
        arrow.add(shaft)
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.48, 8), arrowMat)
        tip.rotation.z = -Math.PI * 0.32
        tip.position.set(0.42, 0.28, 0)
        arrow.add(tip)
        arrow.position.set(1.45, 3.2, 0)
        chart.add(arrow)
        chart.rotation.y = -0.35
        this.addStatic(chart, cx, 0, cz, [
            { shape: 'cuboid', parameters: [ 2.3, 1.4, 0.85 ], position: { x: 0, y: 1.4, z: 0 } }
        ])

        // Pedestal + Maleta Executiva
        const stand = new THREE.Group()
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.8, 12), this.palette.stone)
        base.position.y = 0.4
        stand.add(base)
        const brief = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.62, 0.28), this.palette.leather)
        brief.position.y = 1.12
        stand.add(brief)
        this.addStatic(stand, cx - 2.6, 0, cz + 1.6, [
            { shape: 'cuboid', parameters: [ 0.52, 0.72, 0.52 ], position: { x: 0, y: 0.72, z: 0 } }
        ])

        // 5 Moedas douradas de marco ao redor da praca
        const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16)
        coinGeo.rotateX(Math.PI * 0.5)
        const coinMat = this.glowMat('#ffd166', 1.9)
        const coins = []
        for(let i = 0; i < 5; i++)
        {
            const a = (i / 5) * Math.PI * 2 + 0.4
            const rx = cx + Math.cos(a) * 4.7
            const rz = cz + Math.sin(a) * 4.7
            const mesh = new THREE.Mesh(coinGeo, coinMat)
            mesh.position.set(rx, 0.85, rz)
            this.parkGroup.add(mesh)
            coins.push({ mesh, pos: new THREE.Vector3(rx, 0.85, rz), collected: false, phase: i * 1.1 })
        }

        this.biz = { bars, arrow, coins, collectedCount: 0 }

        this.game.interactivePoints.create(
            new THREE.Vector3(cx - 2.6, 1.6, cz + 2.5),
            () => this.game.i18n.t('prompt.park.bizReset'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.biz.collectedCount = 0
                for(let i = 0; i < 5; i++)
                {
                    this.biz.coins[i].collected = false
                    this.biz.coins[i].mesh.visible = true
                    this.biz.bars[i].targetScaleY = 0.25
                }
                this.sounds.step.play(0)
            },
            () => this.game.inputs.interactiveButtons.addItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            'surface'
        )
    }

    // ========================================================================
    // 4. ARENA MUSICA (28, 0, 34) — Piano de Cauda, Violao & Pads Interativos
    // ========================================================================
    setMusicArena()
    {
        const cx = 28
        const cz = 34

        const stage = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.14, 5.2), this.palette.wood)
        stage.position.set(cx, 0.07, cz)
        stage.receiveShadow = true
        this.parkGroup.add(stage)

        // Piano de Cauda Preto
        const piano = new THREE.Group()
        const rim = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.42, 1.55), this.palette.pianoBlk)
        rim.position.set(0, 0.92, 0)
        piano.add(rim)
        const curve = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 0.42, 18), this.palette.pianoBlk)
        curve.position.set(0, 0.92, -0.78)
        piano.add(curve)
        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.06, 1.52), this.palette.pianoBlk)
        lid.position.set(0.28, 1.48, -0.22)
        lid.rotation.z = -0.34
        piano.add(lid)
        const keyBed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.36), this.palette.ivory)
        keyBed.position.set(0, 0.86, 0.92)
        piano.add(keyBed)
        for(const [ lx, lz ] of [ [-0.85, 0.72], [0.85, 0.72], [0, -1.25] ])
        {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.74, 8), this.palette.pianoBlk)
            leg.position.set(lx, 0.37, lz)
            piano.add(leg)
        }
        piano.rotation.y = 0.2
        this.addStatic(piano, cx - 1.4, 0.14, cz - 0.5, [
            { shape: 'cuboid', parameters: [ 1.15, 0.9, 1.2 ], position: { x: 0, y: 0.9, z: 0 } }
        ])

        // Violao Acustico em Suporte
        const guitar = new THREE.Group()
        guitar.position.y = 1.05
        guitar.rotation.x = -0.18
        const lowerB = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.24, 18), this.palette.cedar)
        lowerB.rotation.x = Math.PI * 0.5; lowerB.position.y = -0.22
        guitar.add(lowerB)
        const upperB = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.24, 18), this.palette.cedar)
        upperB.rotation.x = Math.PI * 0.5; upperB.position.y = 0.34
        guitar.add(upperB)
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.26, 14), this.palette.dark)
        hole.rotation.x = Math.PI * 0.5; hole.position.y = 0.18
        guitar.add(hole)
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.1), this.palette.leather)
        neck.position.set(0, 1.12, -0.02)
        guitar.add(neck)
        const gWrap = new THREE.Group()
        gWrap.add(guitar)
        gWrap.rotation.y = -0.35
        this.addStatic(gWrap, cx + 1.9, 0.14, cz - 0.4, [
            { shape: 'cuboid', parameters: [ 0.6, 1.2, 0.5 ], position: { x: 0, y: 1.2, z: 0 } }
        ])

        // 4 Pads de Piano Gigantes no chao em frente ao palco (Do, Mi, Sol, Si)
        const padSpecs = [
            { x: cx - 3.0, z: cz + 4.0, freq: 261.63, col: '#3b9eff' },
            { x: cx - 1.0, z: cz + 4.0, freq: 329.63, col: '#34cfc4' },
            { x: cx + 1.0, z: cz + 4.0, freq: 392.00, col: '#ffe066' },
            { x: cx + 3.0, z: cz + 4.0, freq: 493.88, col: '#ff8a3d' },
        ]
        const pads = []
        for(let i = 0; i < padSpecs.length; i++)
        {
            const spec = padSpecs[i]
            const idleMat = this.glowMat(spec.col, 0.9)
            const hotMat = this.glowMat('#ffffff', 2.2)
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.12, 2.4), idleMat)
            mesh.position.set(spec.x, 0.06, spec.z)
            this.parkGroup.add(mesh)
            pads.push({ index: i, mesh, pos: new THREE.Vector3(spec.x, 0.06, spec.z), freq: spec.freq, idleMat, hotMat, inside: false, flashTimer: 0 })
        }

        // Notas flutuantes
        const noteMat = this.glowMat('#ffe066', 1.9)
        const notes = []
        for(let i = 0; i < 4; i++)
        {
            const n = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), noteMat)
            n.position.set(cx - 1.5 + i * 1.1, 2.4, cz - 0.4)
            this.parkGroup.add(n)
            notes.push({ mesh: n, baseY: 2.4 + i * 0.2, phase: i * 1.3 })
        }

        this.music = { pads, notes, sequenceStep: 0 }

        // InteractivePoint para demonstrar a melodia Do-Mi-Sol-Si e desafiar o jogador
        this.game.interactivePoints.create(
            new THREE.Vector3(cx, 1.5, cz + 2.2),
            () => this.game.i18n.t('prompt.park.musicChallenge'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.music.sequenceStep = 0
                this.music.pads.forEach((p, idx) =>
                {
                    setTimeout(() =>
                    {
                        this.playSynthTone(p.freq, 0.45, idx % 2 === 0 ? 'triangle' : 'sine', 0.11)
                        p.flashTimer = 0.4
                    }, idx * 170)
                })
                this.game.notifications?.show(
                    /* html */`<div class="discovery">${this.game.i18n.t('park.music.guide')}</div>`,
                    'discovery',
                    3.5,
                    null,
                    'park-music-guide'
                )
            },
            () => this.game.inputs.interactiveButtons.addItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            'surface'
        )
    }

    // ========================================================================
    // 5. ARENA MUSCULACAO (20, 0, 10) — Estacao de Forca & PR 220kg
    // ========================================================================
    setGymArena()
    {
        const cx = 20
        const cz = 10

        const mat = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.08, 4.8), this.palette.rubber)
        mat.position.set(cx, 0.04, cz)
        mat.receiveShadow = true
        this.parkGroup.add(mat)

        // Estacao de Supino fixa
        const rackBase = new THREE.Group()
        const bench = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.16, 0.52), this.palette.dark)
        bench.position.set(0, 0.52, 0)
        rackBase.add(bench)
        for(const sz of [ -0.65, 0.65 ])
        {
            const up = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), this.palette.steel)
            up.position.set(-0.65, 0.7, sz)
            rackBase.add(up)
        }
        this.addStatic(rackBase, cx - 1.0, 0.08, cz - 0.7, [
            { shape: 'cuboid', parameters: [ 0.95, 0.72, 1.3 ], position: { x: 0, y: 0.72, z: 0 } }
        ])

        // Barra olimpica animada (anilhas adicionadas a cada rep +40kg ate 220kg!)
        const barGroup = new THREE.Group()
        barGroup.position.set(cx - 1.65, 1.32, cz - 0.7)
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 2.75, 10), this.palette.silver)
        bar.rotation.x = Math.PI * 0.5
        barGroup.add(bar)

        const plateStages = []
        const plateDefs = [
            { z: 0.88, r: 0.42, mat: this.palette.redPlate },
            { z: 0.98, r: 0.39, mat: this.palette.bluPlate },
            { z: 1.08, r: 0.36, mat: this.palette.ylwPlate },
            { z: 1.18, r: 0.33, mat: this.palette.agroGrn },
        ]
        for(let s = 0; s < plateDefs.length; s++)
        {
            const def = plateDefs[s]
            const pair = []
            for(const side of [ -1, 1 ])
            {
                const p = new THREE.Mesh(new THREE.CylinderGeometry(def.r, def.r, 0.08, 16), def.mat)
                p.rotation.x = Math.PI * 0.5
                p.position.z = side * def.z
                p.visible = s === 0
                barGroup.add(p)
                pair.push(p)
            }
            plateStages.push(pair)
        }
        this.parkGroup.add(barGroup)

        // 4 Kettlebells dinamicos com som metalico
        const kbMats = [ this.palette.redPlate, this.palette.bluPlate, this.palette.ylwPlate, this.palette.teal ]
        for(let i = 0; i < 4; i++)
        {
            const kb = new THREE.Group()
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), kbMats[i])
            kb.add(ball)
            const grip = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 14, Math.PI), this.palette.dark)
            grip.position.y = 0.2
            kb.add(grip)
            this.addDynamic(kb, cx - 1.3 + i * 1.15, 0.34, cz + 1.45, [
                { shape: 'ball', parameters: [ 0.25 ] }
            ], 0.35, 'hitMetal')
        }

        this.gym = { barGroup, plateStages, level: 0, liftAnim: 0, baseY: 1.32 }

        this.game.interactivePoints.create(
            new THREE.Vector3(cx + 1.2, 1.5, cz - 0.5),
            () => this.game.i18n.t('prompt.park.gymLift'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.gym.level = (this.gym.level + 1) % 5
                for(let i = 0; i < this.gym.plateStages.length; i++)
                {
                    const vis = i <= this.gym.level
                    this.gym.plateStages[i].forEach(m => { m.visible = vis })
                }
                this.gym.liftAnim = 1.0
                this.sounds.step.play(this.gym.level)
                const kg = 60 + this.gym.level * 40
                if(kg >= 220)
                {
                    this.unlockChallenge('gym', new THREE.Vector3(cx, 2.2, cz))
                }
                else
                {
                    this.game.notifications?.show(
                        /* html */`<div class="discovery">${this.game.i18n.t('park.gym.rep', { kg })}</div>`,
                        'discovery',
                        2.8,
                        null,
                        'park-gym-rep'
                    )
                }
            },
            () => this.game.inputs.interactiveButtons.addItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            'surface'
        )
    }

    setAchievement()
    {
        this.events.on('boundingIn', () =>
        {
            this.game.achievements.setProgress('areas', 'circuit')
        })
    }

    update()
    {
        if(this.game.worldManager?.isUnderwater)
            return

        const t = this.game.ticker.elapsedScaled
        const dt = this.game.ticker.deltaScaled
        const playerPos = this.game.player.position

        // 1. Agro: girar catavento + checar fardos no Silo
        if(this.agro)
        {
            this.agro.rotor.rotation.z = t * 2.2
            const s = 1 + Math.sin(t * 3.0) * 0.04
            this.agro.zoneRing.scale.setScalar(s)

            for(const b of this.agro.bales)
            {
                if(b.delivered) continue
                const p = b.obj.physical.body.translation()
                const d = Math.hypot(p.x - this.agro.zonePos.x, p.z - this.agro.zonePos.z)
                if(d < 3.4)
                {
                    b.delivered = true
                    this.agro.delivered++
                    this.sounds.step.play(this.agro.delivered)
                    if(this.agro.delivered === 3)
                        this.unlockChallenge('agro', this.agro.zonePos.clone().setY(2.2))
                }
            }
        }

        // 2. Tech: antena + ligar nos do Cluster ao passar perto
        if(this.tech)
        {
            this.tech.dishHead.rotation.y = Math.sin(t * 0.55) * 0.85
            for(const n of this.tech.nodes)
            {
                if(!n.online && Math.hypot(playerPos.x - n.pos.x, playerPos.z - n.pos.z) < 3.2)
                {
                    n.online = true
                    n.beacon.material = this.tech.onlineMat
                    this.tech.onlineCount++
                    this.sounds.step.play(this.tech.onlineCount)
                    if(this.tech.onlineCount === 4)
                        this.unlockChallenge('tech', n.pos.clone().setY(2.8))
                }
            }
        }

        // 3. Negocios: animar moedas/barras + coletar marcos
        if(this.biz)
        {
            this.biz.arrow.position.y = 3.2 + Math.sin(t * 2.2) * 0.18
            for(const bar of this.biz.bars)
            {
                bar.scaleY += (bar.targetScaleY - bar.scaleY) * Math.min(1, dt * 6)
                bar.mesh.scale.y = bar.scaleY
                bar.mesh.position.y = 0.26 + (bar.fullH * bar.scaleY) * 0.5
            }
            for(let i = 0; i < this.biz.coins.length; i++)
            {
                const c = this.biz.coins[i]
                if(c.collected) continue
                c.mesh.rotation.y = t * 2.4 + c.phase
                c.mesh.position.y = 0.85 + Math.sin(t * 2.6 + c.phase) * 0.16
                if(Math.hypot(playerPos.x - c.pos.x, playerPos.z - c.pos.z) < 2.4)
                {
                    c.collected = true
                    c.mesh.visible = false
                    this.biz.bars[i].targetScaleY = 1.0
                    this.biz.collectedCount++
                    this.sounds.coin.play()
                    if(this.biz.collectedCount === 5)
                        this.unlockChallenge('business', c.pos.clone().setY(2.4))
                }
            }
        }

        // 4. Musica: notas flutuantes + Pads do Piano Gigante
        if(this.music)
        {
            for(const n of this.music.notes)
            {
                n.mesh.position.y = n.baseY + Math.sin(t * 1.8 + n.phase) * 0.28
            }
            for(const p of this.music.pads)
            {
                if(p.flashTimer > 0)
                    p.flashTimer = Math.max(0, p.flashTimer - dt)

                const isIn = Math.abs(playerPos.x - p.pos.x) < 0.95 && Math.abs(playerPos.z - p.pos.z) < 1.35
                if(isIn && !p.inside)
                {
                    p.inside = true
                    p.flashTimer = 0.45
                    this.playSynthTone(p.freq, 0.55, p.index % 2 === 0 ? 'triangle' : 'sine', 0.13)

                    if(p.index === this.music.sequenceStep)
                    {
                        this.music.sequenceStep++
                        if(this.music.sequenceStep >= 4)
                        {
                            this.music.sequenceStep = 0
                            this.unlockChallenge('music', p.pos.clone().setY(2.2))
                        }
                    }
                    else
                    {
                        this.music.sequenceStep = p.index === 0 ? 1 : 0
                    }
                }
                else if(!isIn)
                {
                    p.inside = false
                }

                const hot = p.inside || p.flashTimer > 0
                p.mesh.material = hot ? p.hotMat : p.idleMat
                p.mesh.position.y = hot ? 0.02 : 0.06
            }
        }

        // 5. Musculacao: animar levantamento da barra
        if(this.gym)
        {
            if(this.gym.liftAnim > 0)
            {
                this.gym.liftAnim = Math.max(0, this.gym.liftAnim - dt * 1.2)
                const liftY = Math.sin(this.gym.liftAnim * Math.PI) * 0.72
                this.gym.barGroup.position.y = this.gym.baseY + liftY
            }
            else
            {
                this.gym.barGroup.position.y = this.gym.baseY
            }
        }
    }
}
