import * as THREE from 'three/webgpu'
import { color, Fn, sin, uv, vec4 } from 'three/tsl'
import { Howler } from 'howler'
import { InteractivePoints } from '../../InteractivePoints.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'
import { Area } from './Area.js'

/**
 * Parque das Paixoes — Distritos Autorais (Península Leste):
 * 1. Fazenda Horizonte (Agro)      (24, 0, -16): Celeiro, Silo, Catavento, Cerca & Lavoura dourada
 * 2. Hub Tech & Engenharia         (54, 0, -10): Terraco High-Tech, Marquise Vidro/Aco, Fibras Opticas & Holo Core
 * 3. Praca Negocios & Estrategia   (56, 0,  22): Praca Travertino, Mini Skyline Vidro/Ouro & Grafico 3D
 * 4. Orla da Harmonia (Musica)     (28, 0,  38): Deck Costeiro, Concha Acustica, Varal de Luzes & Piano Gigante
 * 5. Iron Arena (Musculacao)       (16, 0,  12): Pergolado Industrial, Supino 220kg, Halteres & Anilheiro
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

    glassMat(hex, opacity = 0.35)
    {
        const m = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        })
        m.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color(hex).mul(1.25)), opacity))()
        return m
    }

    setMaterials()
    {
        this.palette = {
            silver:     this.mat('#cbd5e1'),
            steel:      this.mat('#475569'),
            dark:       this.mat('#1e293b'),
            pianoBlk:   this.mat('#151820'),
            agroGrn:    this.mat('#2d8a4e'),
            agroGold:   this.mat('#eab308'),
            hay:        this.mat('#f5c542'),
            barnRed:    this.mat('#b91c1c'),
            soil:       this.mat('#6b4423'),
            wood:       this.mat('#8b5a2b'),
            cedar:      this.mat('#c67c3b'),
            leather:    this.mat('#6b3f24'),
            navy:       this.mat('#1d4ed8'),
            teal:       this.mat('#14b8a6'),
            redPlate:   this.mat('#dc2626'),
            bluPlate:   this.mat('#2563eb'),
            ylwPlate:   this.mat('#facc15'),
            ivory:      this.mat('#f8fafc'),
            shellIvory: this.mat('#f1ebe0'),
            travertine: this.mat('#e7dec8'),
            stone:      this.mat('#94a3b8'),
            rubber:     this.mat('#262933'),
            techGlass:  this.glassMat('#38bdf8', 0.32),
            warmBulb:   this.glowMat('#ffe28a', 1.85),
            goldGlow:   this.glowMat('#ffd166', 1.9),
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
    // 1. FAZENDA HORIZONTE — AGRO (24, 0, -16)
    // ========================================================================
    setAgroArena()
    {
        const cx = 24
        const cz = -16

        // Solo de lavoura arado ao nordeste do patio + 48 hastes douradas ondulantes
        const fieldX = cx + 4.2
        const fieldZ = cz + 2.4
        const soilPlot = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.08, 7.6), this.palette.soil)
        soilPlot.position.set(fieldX, 0.04, fieldZ)
        soilPlot.receiveShadow = true
        this.parkGroup.add(soilPlot)

        const stalkGeo = new THREE.CylinderGeometry(0.045, 0.07, 1.05, 6)
        stalkGeo.translate(0, 0.52, 0)
        const earGeo = new THREE.ConeGeometry(0.11, 0.36, 6)
        earGeo.translate(0, 1.05, 0)

        const crops = []
        for(let row = 0; row < 6; row++)
        {
            for(let col = 0; col < 8; col++)
            {
                const g = new THREE.Group()
                g.add(new THREE.Mesh(stalkGeo, this.palette.agroGrn))
                g.add(new THREE.Mesh(earGeo, this.palette.agroGold))
                const px = fieldX - 2.3 + row * 0.92
                const pz = fieldZ - 3.1 + col * 0.88
                g.position.set(px, 0.08, pz)
                this.parkGroup.add(g)
                crops.push({ group: g, phase: row * 0.65 + col * 0.4 })
            }
        }

        // Celeiro Classico Vermelho e Madeira
        const barn = new THREE.Group()
        const barnBody = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.5, 4.4), this.palette.barnRed)
        barnBody.position.y = 1.25
        barn.add(barnBody)
        // Telhado em 2 aguas
        for(const side of [ -1, 1 ])
        {
            const slope = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.14, 4.7), this.palette.dark)
            slope.position.set(side * 1.02, 2.95, 0)
            slope.rotation.z = side * -0.52
            barn.add(slope)
        }
        // Portoes frontais com trava em X branca + janela superior do sotao
        const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.75, 0.12), this.palette.ivory)
        doorFrame.position.set(0, 0.9, 2.22)
        barn.add(doorFrame)
        const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.65, 0.14), this.palette.barnRed)
        doorPanel.position.set(0, 0.85, 2.23)
        barn.add(doorPanel)
        for(const r of [ 0.72, -0.72 ])
        {
            const brace = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.95, 0.16), this.palette.ivory)
            brace.position.set(0, 0.85, 2.25)
            brace.rotation.z = r
            barn.add(brace)
        }
        const loftWin = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.14), this.palette.ivory)
        loftWin.position.set(0, 2.55, 2.22)
        barn.add(loftWin)
        this.addStatic(barn, cx + 4.4, 0, cz - 3.6, [
            { shape: 'cuboid', parameters: [ 1.95, 1.4, 2.25 ], position: { x: 0, y: 1.4, z: 0 } }
        ])

        // Cerca rustica de curral emoldurando o fundo Norte
        const fenceModel = new THREE.Group()
        for(let p = 0; p < 5; p++)
        {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.14), this.palette.leather)
            post.position.set(-3.6 + p * 1.8, 0.47, 0)
            fenceModel.add(post)
        }
        for(const ry of [ 0.38, 0.72 ])
        {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.08, 0.08), this.palette.wood)
            rail.position.set(0, ry, 0)
            fenceModel.add(rail)
        }
        this.addStatic(fenceModel, cx - 0.8, 0, cz - 5.9, [
            { shape: 'cuboid', parameters: [ 3.7, 0.5, 0.15 ], position: { x: 0, y: 0.5, z: 0 } }
        ])

        // Silo metalico em (cx - 3.4, cz - 2.6)
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
        this.addStatic(silo, cx - 3.4, 0, cz - 2.6, [
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
        this.addStatic(mill, cx + 0.2, 0, cz - 3.8, [
            { shape: 'cuboid', parameters: [ 0.6, 2.4, 0.6 ], position: { x: 0, y: 2.4, z: 0 } }
        ])

        // Zona alvo de entrega de feno diante do silo
        const zonePos = new THREE.Vector3(cx - 2.6, 0.06, cz + 1.2)
        const zoneMat = this.glowMat('#34d399', 1.75)
        const zoneRing = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.95, 32), zoneMat)
        zoneRing.rotation.x = -Math.PI * 0.5
        zoneRing.position.copy(zonePos)
        this.parkGroup.add(zoneRing)

        // 5 fardos de feno cilindricos empurraveis
        const baleSpecs = [
            [ cx - 0.2, 0.50, cz + 1.8 ],
            [ cx - 1.2, 0.50, cz + 4.1 ],
            [ cx - 3.6, 0.50, cz + 4.3 ],
            [ cx + 0.6, 0.50, cz + 3.6 ],
            [ cx + 0.4, 0.50, cz - 0.6 ],
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

        this.agro = { rotor, zonePos, zoneRing, bales, crops, delivered: 0 }

        this.game.interactivePoints.create(
            new THREE.Vector3(cx - 3.4, 1.5, cz - 0.4),
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
    // 2. HUB TECH & ENGENHARIA (54, 0, -10) — Marquise, Fibras & Holo Core
    // ========================================================================
    setTechArena()
    {
        const cx = 54
        const cz = -10

        const standbyMat = this.glowMat('#facc15', 1.6)
        const onlineMat = this.glowMat('#22d3ee', 2.2)

        // Terraco High-Tech em ardósia escura com borda luminosa
        const pad = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.08, 8.2), this.palette.steel)
        pad.position.set(cx, 0.04, cz)
        pad.receiveShadow = true
        this.parkGroup.add(pad)
        const padRim = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.05, 8.4), this.palette.dark)
        padRim.position.set(cx, 0.025, cz)
        this.parkGroup.add(padRim)

        // Marquise Arquitetonica em Arco de Aco & Vidro sobre a estacao central
        const canopy = new THREE.Group()
        for(const sx of [ -2.7, 2.7 ])
        {
            const col = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.2, 0.24), this.palette.dark)
            col.position.set(sx, 1.6, -0.8)
            canopy.add(col)
        }
        const roofFrame = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.14, 3.0), this.palette.steel)
        roofFrame.position.set(0, 3.25, -0.7)
        canopy.add(roofFrame)
        const roofGlass = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.08, 2.3), this.palette.techGlass)
        roofGlass.position.set(0, 3.29, -0.7)
        canopy.add(roofGlass)
        this.addStatic(canopy, cx, 0.08, cz, [
            { shape: 'cuboid', parameters: [ 0.16, 1.6, 0.16 ], position: { x: -2.7, y: 1.6, z: -0.8 } },
            { shape: 'cuboid', parameters: [ 0.16, 1.6, 0.16 ], position: { x:  2.7, y: 1.6, z: -0.8 } },
        ])

        // Holo Data Core giratorio acima da marquise
        const holoOrb = new THREE.Mesh(new THREE.OctahedronGeometry(0.65, 1), standbyMat)
        holoOrb.position.set(cx, 4.35, cz - 0.7)
        this.parkGroup.add(holoOrb)

        // Estacao Dev central
        const desk = new THREE.Group()
        const top = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.09, 1.0), this.palette.wood)
        top.position.y = 0.88
        desk.add(top)
        for(const lx of [ -0.96, 0.96 ])
        {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.88, 0.82), this.palette.dark)
            leg.position.set(lx, 0.44, 0)
            desk.add(leg)
        }
        const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.76, 0.06), this.palette.dark)
        monitor.position.set(0, 1.40, -0.22)
        desk.add(monitor)
        const screenMat = new THREE.MeshBasicNodeMaterial()
        screenMat.outputNode = Fn(() =>
        {
            const line = sin(uv().y.mul(36.0)).mul(0.5).add(0.5)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#38bdf8').mul(line.mul(0.75).add(0.45)).mul(1.5)), 1)
        })()
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.64), screenMat)
        screen.position.set(0, 1.40, -0.185)
        desk.add(screen)
        this.addStatic(desk, cx - 0.4, 0.08, cz - 0.8, [
            { shape: 'cuboid', parameters: [ 1.1, 0.85, 0.52 ], position: { x: 0, y: 0.85, z: 0 } }
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
        this.addStatic(dishGroup, cx + 1.6, 0.08, cz - 0.9, [
            { shape: 'cuboid', parameters: [ 0.55, 1.1, 0.55 ], position: { x: 0, y: 1.1, z: 0 } }
        ])

        // 4 Torres de servidor + trilhas de fibra optica no chao que acendem em ciano
        const nodeCoords = [
            [ cx - 4.1, cz - 3.6 ],
            [ cx + 4.1, cz - 3.6 ],
            [ cx - 4.1, cz + 3.6 ],
            [ cx + 4.1, cz + 3.6 ],
        ]
        const nodes = []
        for(const [ nx, nz ] of nodeCoords)
        {
            const tower = new THREE.Group()
            const rack = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.35, 0.9), this.palette.dark)
            rack.position.y = 1.17
            tower.add(rack)
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.10, 0.92), standbyMat)
            stripe.position.y = 1.45
            tower.add(stripe)
            const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.24, 0.68), standbyMat)
            beacon.position.y = 2.48
            tower.add(beacon)

            this.addStatic(tower, nx, 0, nz, [
                { shape: 'cuboid', parameters: [ 0.55, 1.2, 0.48 ], position: { x: 0, y: 1.2, z: 0 } }
            ])

            // Conduto de fibra optica ligando torre ao centro
            const dx = nx - cx
            const dz = nz - cz
            const len = Math.hypot(dx, dz)
            const conduit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, len), standbyMat)
            conduit.position.set(cx + dx * 0.5, 0.095, cz + dz * 0.5)
            conduit.rotation.y = Math.atan2(dx, dz)
            this.parkGroup.add(conduit)

            nodes.push({ pos: new THREE.Vector3(nx, 0, nz), beacon, stripe, conduit, online: false })
        }

        this.tech = { dishHead, holoOrb, nodes, onlineCount: 0, standbyMat, onlineMat }

        this.game.interactivePoints.create(
            new THREE.Vector3(cx, 1.5, cz + 1.3),
            () => this.game.i18n.t('prompt.park.techReboot'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () =>
            {
                this.tech.onlineCount = 0
                this.tech.holoOrb.material = this.tech.standbyMat
                for(const n of this.tech.nodes)
                {
                    n.online = false
                    n.beacon.material = this.tech.standbyMat
                    n.stripe.material = this.tech.standbyMat
                    n.conduit.material = this.tech.standbyMat
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
    // 3. PRACA NEGOCIOS & ESTRATEGIA (56, 0, 22) — Travertino, Skyline & Marcos
    // ========================================================================
    setBusinessArena()
    {
        const cx = 56
        const cz = 22

        // Praca circular executiva em travertino com anel dourado
        const plazaOuter = new THREE.Mesh(new THREE.CylinderGeometry(7.0, 7.2, 0.08, 32), this.palette.travertine)
        plazaOuter.position.set(cx, 0.04, cz)
        plazaOuter.receiveShadow = true
        this.parkGroup.add(plazaOuter)

        const plazaRing = new THREE.Mesh(new THREE.TorusGeometry(4.1, 0.07, 8, 36), this.palette.agroGold)
        plazaRing.rotation.x = Math.PI * 0.5
        plazaRing.position.set(cx, 0.085, cz)
        this.parkGroup.add(plazaRing)

        // 6 Balizadores luminosos modernos ao redor da praca
        for(let i = 0; i < 6; i++)
        {
            const a = (i / 6) * Math.PI * 2 + 0.25
            const bx = cx + Math.cos(a) * 6.5
            const bz = cz + Math.sin(a) * 6.5
            const bol = new THREE.Group()
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.85, 10), this.palette.dark)
            post.position.y = 0.42
            bol.add(post)
            const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 10), this.palette.warmBulb)
            lamp.position.y = 0.90
            bol.add(lamp)
            this.addStatic(bol, bx, 0, bz, [
                { shape: 'cylinder', parameters: [ 0.45, 0.16 ], position: { x: 0, y: 0.45, z: 0 } }
            ])
        }

        // Mini Skyline em Vidro Azul & Ouro ao fundo da praca
        const skyline = new THREE.Group()
        const towerSpecs = [
            { x: -1.5, h: 2.8, w: 0.9, mat: this.palette.techGlass },
            { x:  0.0, h: 4.1, w: 1.05, mat: this.palette.ivory },
            { x:  1.4, h: 3.3, w: 0.9, mat: this.palette.techGlass },
        ]
        for(const ts of towerSpecs)
        {
            const b = new THREE.Mesh(new THREE.BoxGeometry(ts.w, ts.h, ts.w * 0.85), ts.mat)
            b.position.set(ts.x, ts.h * 0.5 + 0.18, 0)
            skyline.add(b)
            const cap = new THREE.Mesh(new THREE.BoxGeometry(ts.w * 1.05, 0.12, ts.w * 0.9), this.palette.agroGold)
            cap.position.set(ts.x, ts.h + 0.24, 0)
            skyline.add(cap)
        }
        const skyBase = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.18, 1.5), this.palette.steel)
        skyBase.position.y = 0.09
        skyline.add(skyBase)
        skyline.rotation.y = -0.35
        this.addStatic(skyline, cx + 1.4, 0.08, cz - 2.6, [
            { shape: 'cuboid', parameters: [ 2.2, 1.6, 0.8 ], position: { x: 0, y: 1.6, z: 0 } }
        ])

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
        this.addStatic(chart, cx - 0.6, 0.08, cz + 0.4, [
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
        this.addStatic(stand, cx - 2.9, 0.08, cz + 1.8, [
            { shape: 'cuboid', parameters: [ 0.52, 0.72, 0.52 ], position: { x: 0, y: 0.72, z: 0 } }
        ])

        // 5 Moedas douradas de marco ao redor da praca
        const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 16)
        coinGeo.rotateX(Math.PI * 0.5)
        const coinMat = this.palette.goldGlow
        const coins = []
        for(let i = 0; i < 5; i++)
        {
            const a = (i / 5) * Math.PI * 2 + 0.4
            const rx = cx + Math.cos(a) * 4.9
            const rz = cz + Math.sin(a) * 4.9
            const mesh = new THREE.Mesh(coinGeo, coinMat)
            mesh.position.set(rx, 0.85, rz)
            this.parkGroup.add(mesh)
            coins.push({ mesh, pos: new THREE.Vector3(rx, 0.85, rz), collected: false, phase: i * 1.1 })
        }

        this.biz = { bars, arrow, coins, collectedCount: 0 }

        this.game.interactivePoints.create(
            new THREE.Vector3(cx - 2.9, 1.6, cz + 2.7),
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
    // 4. ORLA DA HARMONIA — MUSICA (28, 0, 38) — Deck, Concha Acustica & Piano
    // ========================================================================
    setMusicArena()
    {
        const cx = 28
        const cz = 38

        // Deck costeiro ampliado em cedro quente
        const stage = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.16, 6.2), this.palette.wood)
        stage.position.set(cx, 0.08, cz - 0.3)
        stage.receiveShadow = true
        this.parkGroup.add(stage)
        const stageStep = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.08, 6.6), this.palette.leather)
        stageStep.position.set(cx, 0.04, cz - 0.3)
        stageStep.receiveShadow = true
        this.parkGroup.add(stageStep)

        // Concha Acustica Curvada em Marfim + Nervuras em Cedro atras do palco
        const shellGroup = new THREE.Group()
        const shellGeo = new THREE.SphereGeometry(4.4, 20, 12, 0, Math.PI, 0, Math.PI * 0.5)
        const shellMesh = new THREE.Mesh(shellGeo, this.palette.shellIvory)
        shellMesh.scale.set(1.08, 0.92, 0.62)
        shellMesh.rotation.y = Math.PI
        shellMesh.position.set(0, 0.12, -1.6)
        shellMesh.castShadow = true
        shellMesh.receiveShadow = true
        shellGroup.add(shellMesh)

        for(let r = -2; r <= 2; r++)
        {
            const rib = new THREE.Mesh(new THREE.TorusGeometry(4.42, 0.08, 6, 20, Math.PI), this.palette.cedar)
            rib.scale.set(1.08, 0.92, 1.0)
            rib.position.set(0, 0.12, -1.65 + r * 0.18)
            rib.rotation.x = r * 0.08
            shellGroup.add(rib)
        }

        // Postes & Varal de Luzinhas Quentes em frente ao palco
        const poleX = [ -4.4, 4.4 ]
        for(const px of poleX)
        {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 3.6, 8), this.palette.dark)
            post.position.set(px, 1.8, 2.2)
            shellGroup.add(post)
        }
        const bulbGeo = new THREE.SphereGeometry(0.11, 8, 8)
        for(let b = 0; b <= 10; b++)
        {
            const u = b / 10
            const bx = -4.2 + u * 8.4
            const sag = Math.sin(u * Math.PI) * 0.55
            const bulb = new THREE.Mesh(bulbGeo, this.palette.warmBulb)
            bulb.position.set(bx, 3.55 - sag, 2.2)
            shellGroup.add(bulb)
        }

        this.addStatic(shellGroup, cx, 0.14, cz - 0.3, [
            { shape: 'cuboid', parameters: [ 4.5, 1.6, 0.65 ], position: { x: 0, y: 1.6, z: -2.4 } },
            { shape: 'cylinder', parameters: [ 1.8, 0.14 ], position: { x: -4.4, y: 1.8, z: 2.2 } },
            { shape: 'cylinder', parameters: [ 1.8, 0.14 ], position: { x:  4.4, y: 1.8, z: 2.2 } },
        ])

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
        this.addStatic(piano, cx - 1.5, 0.16, cz - 0.6, [
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
        this.addStatic(gWrap, cx + 2.0, 0.16, cz - 0.5, [
            { shape: 'cuboid', parameters: [ 0.6, 1.2, 0.5 ], position: { x: 0, y: 1.2, z: 0 } }
        ])

        // 4 Pads de Piano Gigantes no chao com moldura de teclado (Do, Mi, Sol, Si)
        const keyBorder = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.06, 2.9), this.palette.pianoBlk)
        keyBorder.position.set(cx, 0.03, cz + 4.2)
        this.parkGroup.add(keyBorder)

        const padSpecs = [
            { x: cx - 3.0, z: cz + 4.2, freq: 261.63, col: '#3b9eff' },
            { x: cx - 1.0, z: cz + 4.2, freq: 329.63, col: '#34cfc4' },
            { x: cx + 1.0, z: cz + 4.2, freq: 392.00, col: '#ffe066' },
            { x: cx + 3.0, z: cz + 4.2, freq: 493.88, col: '#ff8a3d' },
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
            if(i < 3)
            {
                const sharpKey = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 1.25), this.palette.pianoBlk)
                sharpKey.position.set(spec.x + 1.0, 0.09, spec.z - 0.55)
                this.parkGroup.add(sharpKey)
            }
            pads.push({ index: i, mesh, pos: new THREE.Vector3(spec.x, 0.06, spec.z), freq: spec.freq, idleMat, hotMat, inside: false, flashTimer: 0 })
        }

        // Notas musicais esculpidas flutuantes (cabeca + haste + colchete)
        const noteMat = this.palette.goldGlow
        const notes = []
        for(let i = 0; i < 4; i++)
        {
            const n = new THREE.Group()
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), noteMat)
            head.scale.set(1.2, 0.85, 0.85)
            n.add(head)
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.56, 6), noteMat)
            stem.position.set(0.14, 0.28, 0)
            n.add(stem)
            const flag = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.05), noteMat)
            flag.position.set(0.24, 0.52, 0)
            flag.rotation.z = -0.35
            n.add(flag)
            n.position.set(cx - 1.8 + i * 1.2, 2.9, cz - 0.4)
            this.parkGroup.add(n)
            notes.push({ mesh: n, baseY: 2.9 + (i % 2) * 0.35, phase: i * 1.3 })
        }

        this.music = { pads, notes, sequenceStep: 0 }

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
    // 5. IRON ARENA — MUSCULACAO (16, 0, 12) — Pergolado, Halteres & PR 220kg
    // ========================================================================
    setGymArena()
    {
        const cx = 16
        const cz = 12

        // Tatame emborrachado ampliado com moldura em aco
        const mat = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.08, 6.2), this.palette.rubber)
        mat.position.set(cx, 0.04, cz)
        mat.receiveShadow = true
        this.parkGroup.add(mat)

        // Pergolado Industrial aberto (4 colunas + trelicas superiores + 4 refletores quentes)
        const pergola = new THREE.Group()
        for(const [ px, pz ] of [ [-3.8,-2.8], [3.8,-2.8], [-3.8,2.8], [3.8,2.8] ])
        {
            const col = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.8, 0.24), this.palette.steel)
            col.position.set(px, 1.9, pz)
            pergola.add(col)
            const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.28), this.palette.warmBulb)
            lamp.position.set(px * 0.85, 3.68, pz * 0.85)
            pergola.add(lamp)
        }
        for(const pz of [ -2.8, 2.8 ])
        {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(7.9, 0.20, 0.24), this.palette.dark)
            beam.position.set(0, 3.82, pz)
            pergola.add(beam)
        }
        for(const px of [ -3.8, 0, 3.8 ])
        {
            const cross = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.18, 5.8), this.palette.dark)
            cross.position.set(px, 3.84, 0)
            pergola.add(cross)
        }
        this.addStatic(pergola, cx, 0.08, cz, [
            { shape: 'cuboid', parameters: [ 0.16, 1.9, 0.16 ], position: { x: -3.8, y: 1.9, z: -2.8 } },
            { shape: 'cuboid', parameters: [ 0.16, 1.9, 0.16 ], position: { x:  3.8, y: 1.9, z: -2.8 } },
            { shape: 'cuboid', parameters: [ 0.16, 1.9, 0.16 ], position: { x: -3.8, y: 1.9, z:  2.8 } },
            { shape: 'cuboid', parameters: [ 0.16, 1.9, 0.16 ], position: { x:  3.8, y: 1.9, z:  2.8 } },
        ])

        // Estante de Halteres + Arvore de Anilhas Olimpico ao fundo
        const dbRack = new THREE.Group()
        const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.95, 0.55), this.palette.dark)
        frame.position.y = 0.48
        dbRack.add(frame)
        for(let d = 0; d < 4; d++)
        {
            const dx = -0.82 + d * 0.55
            const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 8), this.palette.silver)
            handle.rotation.x = Math.PI * 0.5
            handle.position.set(dx, 1.04, 0)
            dbRack.add(handle)
            for(const side of [ -0.14, 0.14 ])
            {
                const w = new THREE.Mesh(new THREE.CylinderGeometry(0.10 + d * 0.015, 0.10 + d * 0.015, 0.09, 10), d === 3 ? this.palette.redPlate : this.palette.steel)
                w.rotation.x = Math.PI * 0.5
                w.position.set(dx, 1.04, side)
                dbRack.add(w)
            }
        }
        this.addStatic(dbRack, cx + 1.4, 0.08, cz - 1.9, [
            { shape: 'cuboid', parameters: [ 1.22, 0.65, 0.32 ], position: { x: 0, y: 0.65, z: 0 } }
        ])

        const tree = new THREE.Group()
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.35, 10), this.palette.steel)
        post.position.y = 0.68
        tree.add(post)
        const baseCross = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.10, 0.85), this.palette.dark)
        baseCross.position.y = 0.05
        tree.add(baseCross)
        const treeMats = [ this.palette.redPlate, this.palette.bluPlate, this.palette.ylwPlate ]
        for(let p = 0; p < 3; p++)
        {
            const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.36 - p * 0.05, 0.36 - p * 0.05, 0.08, 14), treeMats[p])
            plate.position.y = 0.32 + p * 0.14
            tree.add(plate)
        }
        this.addStatic(tree, cx - 2.7, 0.08, cz - 1.9, [
            { shape: 'cylinder', parameters: [ 0.7, 0.4 ], position: { x: 0, y: 0.7, z: 0 } }
        ])

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
        this.addStatic(rackBase, cx - 0.8, 0.08, cz - 0.4, [
            { shape: 'cuboid', parameters: [ 0.95, 0.72, 1.3 ], position: { x: 0, y: 0.72, z: 0 } }
        ])

        // Barra olimpica animada (anilhas adicionadas a cada rep +40kg ate 220kg!)
        const barGroup = new THREE.Group()
        barGroup.position.set(cx - 1.45, 1.32, cz - 0.4)
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
            this.addDynamic(kb, cx - 1.3 + i * 1.15, 0.34, cz + 1.55, [
                { shape: 'ball', parameters: [ 0.25 ] }
            ], 0.35, 'hitMetal')
        }

        this.gym = { barGroup, plateStages, level: 0, liftAnim: 0, baseY: 1.32 }

        this.game.interactivePoints.create(
            new THREE.Vector3(cx + 1.3, 1.5, cz - 0.2),
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

        // 1. Agro: girar catavento + balancar lavoura + checar fardos no Silo
        if(this.agro)
        {
            this.agro.rotor.rotation.z = t * 2.2
            const s = 1 + Math.sin(t * 3.0) * 0.04
            this.agro.zoneRing.scale.setScalar(s)

            for(const c of this.agro.crops)
            {
                c.group.rotation.z = Math.sin(t * 1.9 + c.phase) * 0.085
                c.group.rotation.x = Math.cos(t * 1.4 + c.phase) * 0.055
            }

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

        // 2. Tech: antena + holo core + ligar nos do Cluster & fibras opticas
        if(this.tech)
        {
            this.tech.dishHead.rotation.y = Math.sin(t * 0.55) * 0.85
            this.tech.holoOrb.rotation.y = t * (this.tech.onlineCount === 4 ? 2.1 : 0.75)
            this.tech.holoOrb.rotation.x = Math.sin(t * 0.9) * 0.35
            this.tech.holoOrb.position.y = 4.35 + Math.sin(t * 2.0) * 0.16

            for(const n of this.tech.nodes)
            {
                if(!n.online && Math.hypot(playerPos.x - n.pos.x, playerPos.z - n.pos.z) < 3.2)
                {
                    n.online = true
                    n.beacon.material = this.tech.onlineMat
                    n.stripe.material = this.tech.onlineMat
                    n.conduit.material = this.tech.onlineMat
                    this.tech.onlineCount++
                    this.sounds.step.play(this.tech.onlineCount)
                    if(this.tech.onlineCount === 4)
                    {
                        this.tech.holoOrb.material = this.tech.onlineMat
                        this.unlockChallenge('tech', n.pos.clone().setY(2.8))
                    }
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
                n.mesh.rotation.y = Math.sin(t * 0.9 + n.phase) * 0.35
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
