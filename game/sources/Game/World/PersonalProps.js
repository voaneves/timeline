import * as THREE from 'three/webgpu'
import { color, Fn, sin, uv, vec4 } from 'three/tsl'
import { Howler } from 'howler'
import { Game } from '../Game.js'
import { InteractivePoints } from '../InteractivePoints.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

/**
 * Props tematicos pessoais posicionados em clareiras secas (y = 0) da ilha:
 * - Agronegocio (-56, 0, 6): Silo metalico, catavento rural, trator e fardos de feno dinamicos
 * - Tecnologia (-60, 0, -38): Racks de servidor com LEDs, mesa dev ultrawide, antena telemetria e caixotes
 * - Negocios (-20, 0, -22): Grafico 3D ascendente com seta luminosa, maleta executiva e blocos
 * - Musica (-36, 0, -44): Palco com Piano de Cauda, Violao Acustico, amp, notas e ponto interativo musical
 * - Musculacao (-56, 0, -28): Tablado, supino com barra olimpica e anilhas coloridas, rack de halteres e kettlebells
 */
export class PersonalProps
{
    constructor()
    {
        this.game = Game.getInstance()
        this.group = new THREE.Group()
        this.game.scene.add(this.group)

        this.animations = {
            windmillRotor: null,
            dish: null,
            bizArrow: null,
            bizArrowBaseY: 3.15,
            leds: [],
            musicNotes: [],
        }

        this.setMaterials()
        this.setAgribusinessZone()
        this.setTechnologyZone()
        this.setBusinessZone()
        this.setMusicZone()
        this.setFitnessZone()

        this.game.ticker.events.on('tick', () =>
        {
            if(this.game.worldManager?.isUnderwater)
                return
            this.update()
        }, 10)
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
            { model, parent: this.group, updateMaterials: false },
            { type: 'fixed', position: new THREE.Vector3(x, y, z), rotation: model.quaternion.clone(), enabled: true, friction, colliders }
        )
    }

    addDynamic(model, x, y, z, colliders, mass = 0.3, hitSound = 'hitDefault')
    {
        model.position.set(x, y, z)
        return this.game.objects.add(
            { model, parent: this.group, updateMaterials: false },
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

    // ------------------------------------------------------------------------
    // 1. AGRONEGOCIO (-56, 0, 6)
    // ------------------------------------------------------------------------
    setAgribusinessZone()
    {
        const cx = -56
        const cz = 6

        // Silo metalico de graos
        const silo = new THREE.Group()
        const body = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.55, 4.2, 18), this.palette.silver)
        body.position.y = 2.1
        silo.add(body)

        for(const ry of [ 0.9, 2.0, 3.1, 4.1 ])
        {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(1.57, 0.045, 6, 20), this.palette.steel)
            ring.rotation.x = Math.PI * 0.5
            ring.position.y = ry
            silo.add(ring)
        }
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.58, 1.58, 0.38, 18), this.palette.agroGrn)
        stripe.position.y = 3.55
        silo.add(stripe)

        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.66, 1.35, 18), this.palette.agroGold)
        roof.position.y = 4.85
        silo.add(roof)

        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.35, 0.25, 12), this.palette.silver)
        cap.position.y = 5.55
        silo.add(cap)

        this.addStatic(silo, cx - 2.0, 0, cz - 1.8, [
            { shape: 'cylinder', parameters: [ 2.2, 1.62 ], position: { x: 0, y: 2.2, z: 0 } }
        ])

        // Catavento rural com rotor giratorio
        const mill = new THREE.Group()
        for(const [ px, pz ] of [ [-0.45,-0.45], [0.45,-0.45], [-0.45,0.45], [0.45,0.45] ])
        {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 4.6, 6), this.palette.steel)
            leg.position.set(px * 0.65, 2.3, pz * 0.65)
            leg.rotation.z = px > 0 ? 0.11 : -0.11
            leg.rotation.x = pz > 0 ? -0.11 : 0.11
            mill.add(leg)
        }
        const vane = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 1.1), this.palette.redPlate)
        vane.position.set(0, 4.65, -0.7)
        mill.add(vane)

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
        this.animations.windmillRotor = rotor

        this.addStatic(mill, cx + 2.3, 0, cz - 2.1, [
            { shape: 'cuboid', parameters: [ 0.65, 2.4, 0.65 ], position: { x: 0, y: 2.4, z: 0 } }
        ])

        // Mini Trator estilizado verde & amarelo
        const tractor = new THREE.Group()
        const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.65, 0.9), this.palette.agroGrn)
        hood.position.set(0.35, 0.72, 0)
        tractor.add(hood)
        const grille = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.52, 0.78), this.palette.agroGold)
        grille.position.set(1.12, 0.7, 0)
        tractor.add(grille)
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.05, 0.96), this.palette.dark)
        cab.position.set(-0.45, 1.32, 0)
        tractor.add(cab)
        const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.14, 1.08), this.palette.agroGrn)
        cabRoof.position.set(-0.45, 1.88, 0)
        tractor.add(cabRoof)
        const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 8), this.palette.steel)
        exhaust.position.set(0.65, 1.38, -0.3)
        tractor.add(exhaust)
        for(const sz of [ -0.62, 0.62 ])
        {
            const rearW = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.34, 14), this.palette.dark)
            rearW.rotation.x = Math.PI * 0.5
            rearW.position.set(-0.48, 0.55, sz)
            tractor.add(rearW)
            const rearRim = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.36, 10), this.palette.agroGold)
            rearRim.rotation.x = Math.PI * 0.5
            rearRim.position.set(-0.48, 0.55, sz)
            tractor.add(rearRim)

            const frontW = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12), this.palette.dark)
            frontW.rotation.x = Math.PI * 0.5
            frontW.position.set(0.75, 0.34, sz * 0.88)
            tractor.add(frontW)
            const frontRim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10), this.palette.agroGold)
            frontRim.rotation.x = Math.PI * 0.5
            frontRim.position.set(0.75, 0.34, sz * 0.88)
            tractor.add(frontRim)
        }
        tractor.rotation.y = 0.45
        this.addStatic(tractor, cx + 1.8, 0, cz + 1.4, [
            { shape: 'cuboid', parameters: [ 1.15, 0.95, 0.8 ], position: { x: 0, y: 0.95, z: 0 } }
        ])

        // 5 Fardos de feno cilindricos dinamicos (derrubaveis/rolaveis)
        const baleCoords = [
            [ cx - 1.2, 0.48, cz + 1.8 ],
            [ cx - 0.1, 0.48, cz + 2.3 ],
            [ cx - 2.2, 0.48, cz + 2.4 ],
            [ cx - 1.5, 1.38, cz + 2.15 ],
            [ cx + 0.4, 0.48, cz + 0.6 ],
        ]
        for(const [ bx, by, bz ] of baleCoords)
        {
            const bale = new THREE.Group()
            const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.78, 14), this.palette.hay)
            roll.rotation.z = Math.PI * 0.5
            bale.add(roll)
            const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.1, 14), this.palette.leather)
            strap.rotation.z = Math.PI * 0.5
            bale.add(strap)

            this.addDynamic(bale, bx, by, bz, [
                { shape: 'ball', parameters: [ 0.47 ] }
            ], 0.22, 'hitDefault')
        }
    }

    // ------------------------------------------------------------------------
    // 2. TECNOLOGIA (-60, 0, -38)
    // ------------------------------------------------------------------------
    setTechnologyZone()
    {
        const cx = -60
        const cz = -38

        // Base plataforma tech
        const pad = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.1, 4.6), this.palette.steel)
        pad.position.set(cx, 0.05, cz)
        pad.receiveShadow = true
        this.group.add(pad)

        // 2 Racks de servidores com LEDs piscantes
        const racks = new THREE.Group()
        const ledColors = [ '#22d3ee', '#34d399', '#facc15' ]
        for(const rx of [ -0.75, 0.75 ])
        {
            const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.5, 0.95), this.palette.dark)
            cab.position.set(rx, 1.25, 0)
            racks.add(cab)

            for(let slot = 0; slot < 5; slot++)
            {
                const face = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.04), this.palette.steel)
                face.position.set(rx, 0.45 + slot * 0.42, 0.48)
                racks.add(face)

                const ledMat = this.glowMat(ledColors[slot % ledColors.length], 2.0)
                const led = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.03), ledMat)
                led.position.set(rx - 0.3, 0.45 + slot * 0.42, 0.51)
                racks.add(led)
                this.animations.leds.push({ mesh: led, phase: slot * 1.3 + rx * 2.1 })
            }
        }
        this.addStatic(racks, cx - 1.1, 0.1, cz - 1.1, [
            { shape: 'cuboid', parameters: [ 1.35, 1.25, 0.55 ], position: { x: 0, y: 1.25, z: 0 } }
        ])

        // Estacao Dev com monitor ultrawide & codigo luminoso
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
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.36, 0.12), this.palette.dark)
        stand.position.set(0, 1.1, -0.25)
        desk.add(stand)
        const monitor = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.68, 0.06), this.palette.dark)
        monitor.position.set(0, 1.36, -0.22)
        desk.add(monitor)

        const screenMat = new THREE.MeshBasicNodeMaterial()
        screenMat.outputNode = Fn(() =>
        {
            const line = sin(uv().y.mul(36.0)).mul(0.5).add(0.5)
            const col = color('#38bdf8').mul(line.mul(0.75).add(0.45)).mul(1.5)
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, col), 1)
        })()
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.38, 0.56), screenMat)
        screen.position.set(0, 1.36, -0.185)
        desk.add(screen)

        this.addStatic(desk, cx + 1.5, 0.1, cz - 0.9, [
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
        const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 8), this.palette.teal)
        feed.rotation.x = Math.PI * 0.32
        feed.position.set(0, 0.25, 0.3)
        dishHead.add(feed)
        dishGroup.add(dishHead)
        this.animations.dish = dishHead

        this.addStatic(dishGroup, cx + 2.0, 0.1, cz + 1.2, [
            { shape: 'cuboid', parameters: [ 0.6, 1.1, 0.6 ], position: { x: 0, y: 1.1, z: 0 } }
        ])

        // 3 Caixotes hardware dinamicos
        for(let i = 0; i < 3; i++)
        {
            const box = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.65), i % 2 === 0 ? this.palette.teal : this.palette.navy)
            this.addDynamic(box, cx - 1.6 + i * 0.85, 0.44, cz + 1.3, [
                { shape: 'cuboid', parameters: [ 0.33, 0.33, 0.33 ] }
            ], 0.25)
        }
    }

    // ------------------------------------------------------------------------
    // 3. NEGOCIOS (-20, 0, -22)
    // ------------------------------------------------------------------------
    setBusinessZone()
    {
        const cx = -20
        const cz = -22

        // Monumento Grafico de Crescimento 3D
        const chart = new THREE.Group()
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.26, 1.7), this.palette.stone)
        plinth.position.y = 0.13
        chart.add(plinth)

        const barHeights = [ 0.85, 1.3, 1.75, 2.2, 2.75 ]
        const barMats = [ this.palette.navy, this.palette.navy, this.palette.teal, this.palette.teal, this.palette.agroGold ]
        for(let i = 0; i < barHeights.length; i++)
        {
            const h = barHeights[i]
            const bar = new THREE.Mesh(new THREE.BoxGeometry(0.55, h, 0.55), barMats[i])
            bar.position.set(-1.5 + i * 0.75, 0.26 + h * 0.5, 0)
            chart.add(bar)
        }

        const arrowMat = this.glowMat('#ffe066', 2.0)
        const arrowGroup = new THREE.Group()
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.18), arrowMat)
        shaft.rotation.z = -Math.PI * 0.32
        arrowGroup.add(shaft)
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.48, 8), arrowMat)
        tip.rotation.z = -Math.PI * 0.32
        tip.position.set(0.42, 0.28, 0)
        arrowGroup.add(tip)
        arrowGroup.position.set(1.35, 3.15, 0)
        chart.add(arrowGroup)
        this.animations.bizArrow = arrowGroup

        chart.rotation.y = -0.35
        this.addStatic(chart, cx, 0, cz, [
            { shape: 'cuboid', parameters: [ 2.2, 1.4, 0.85 ], position: { x: 0, y: 1.4, z: 0 } }
        ])

        // Pedestal com Maleta Executiva
        const briefcaseStand = new THREE.Group()
        const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.8, 12), this.palette.stone)
        stand.position.y = 0.4
        briefcaseStand.add(stand)
        const caseBody = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.62, 0.28), this.palette.leather)
        caseBody.position.y = 1.12
        briefcaseStand.add(caseBody)
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12, Math.PI), this.palette.agroGold)
        handle.position.y = 1.44
        briefcaseStand.add(handle)
        for(const lx of [ -0.25, 0.25 ])
        {
            const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.31), this.palette.agroGold)
            clasp.position.set(lx, 1.24, 0)
            briefcaseStand.add(clasp)
        }
        this.addStatic(briefcaseStand, cx - 2.3, 0, cz + 1.5, [
            { shape: 'cuboid', parameters: [ 0.52, 0.72, 0.52 ], position: { x: 0, y: 0.72, z: 0 } }
        ])

        // 3 Blocos de metas dourados/azul-marinho dinamicos
        for(let i = 0; i < 3; i++)
        {
            const cube = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), i === 1 ? this.palette.agroGold : this.palette.teal)
            this.addDynamic(cube, cx + 1.8 + i * 0.75, 0.34, cz + 1.7, [
                { shape: 'cuboid', parameters: [ 0.31, 0.31, 0.31 ] }
            ], 0.25)
        }
    }

    // ------------------------------------------------------------------------
    // 4. MUSICA: PIANO DE CAUDA & VIOLAO (-36, 0, -44)
    // ------------------------------------------------------------------------
    setMusicZone()
    {
        const cx = -36
        const cz = -44

        // Tablado de madeira acolhedor (visual plano, sem collider alto para o carro subir suave)
        const stage = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.14, 5.4), this.palette.wood)
        stage.position.set(cx, 0.07, cz)
        stage.receiveShadow = true
        stage.castShadow = true
        this.group.add(stage)

        // Piano de Cauda Preto com teclas e tampa aberta
        const piano = new THREE.Group()
        const rimMain = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.42, 1.55), this.palette.pianoBlk)
        rimMain.position.set(0, 0.92, 0)
        piano.add(rimMain)
        const tailCurve = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 0.42, 18), this.palette.pianoBlk)
        tailCurve.position.set(0, 0.92, -0.78)
        piano.add(tailCurve)

        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.08, 0.06, 1.52), this.palette.pianoBlk)
        lid.position.set(0.28, 1.48, -0.22)
        lid.rotation.z = -0.34
        piano.add(lid)
        const propStick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), this.palette.agroGold)
        propStick.position.set(0.82, 1.42, -0.15)
        propStick.rotation.z = -0.15
        piano.add(propStick)

        const keyBed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.36), this.palette.ivory)
        keyBed.position.set(0, 0.86, 0.92)
        piano.add(keyBed)
        for(let k = 0; k < 10; k++)
        {
            if(k === 2 || k === 6) continue
            const sharpKey = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.2), this.palette.dark)
            sharpKey.position.set(-0.78 + k * 0.17, 0.92, 0.84)
            piano.add(sharpKey)
        }
        for(const [ lx, lz ] of [ [-0.85, 0.72], [0.85, 0.72], [0, -1.25] ])
        {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.74, 8), this.palette.pianoBlk)
            leg.position.set(lx, 0.37, lz)
            piano.add(leg)
        }
        const bench = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.48, 0.48), this.palette.leather)
        bench.position.set(0, 0.24, 1.55)
        piano.add(bench)

        piano.rotation.y = 0.25
        this.addStatic(piano, cx - 1.35, 0.14, cz - 0.55, [
            { shape: 'cuboid', parameters: [ 1.15, 0.9, 1.2 ], position: { x: 0, y: 0.9, z: 0 } }
        ])

        // Violao Acustico em Suporte de Madeira
        const guitarGroup = new THREE.Group()
        const standBack = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.08, 0.75), this.palette.dark)
        standBack.position.y = 0.04
        guitarGroup.add(standBack)

        const guitar = new THREE.Group()
        guitar.position.set(0, 1.05, 0)
        guitar.rotation.x = -0.18
        const lowerBout = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.24, 18), this.palette.cedar)
        lowerBout.rotation.x = Math.PI * 0.5
        lowerBout.position.y = -0.22
        guitar.add(lowerBout)
        const upperBout = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.24, 18), this.palette.cedar)
        upperBout.rotation.x = Math.PI * 0.5
        upperBout.position.y = 0.34
        guitar.add(upperBout)
        const soundHole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.26, 14), this.palette.dark)
        soundHole.rotation.x = Math.PI * 0.5
        soundHole.position.y = 0.18
        guitar.add(soundHole)
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.28), this.palette.dark)
        bridge.position.y = -0.32
        guitar.add(bridge)
        const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.05, 0.1), this.palette.leather)
        neck.position.set(0, 1.12, -0.02)
        guitar.add(neck)
        const headstock = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.1), this.palette.dark)
        headstock.position.set(0, 1.78, -0.02)
        guitar.add(headstock)
        for(let p = 0; p < 3; p++)
        {
            const pegL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), this.palette.agroGold)
            pegL.position.set(-0.16, 1.68 + p * 0.09, -0.02)
            guitar.add(pegL)
            const pegR = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), this.palette.agroGold)
            pegR.position.set(0.16, 1.68 + p * 0.09, -0.02)
            guitar.add(pegR)
        }
        guitarGroup.add(guitar)
        guitarGroup.rotation.y = -0.35

        this.addStatic(guitarGroup, cx + 1.85, 0.14, cz - 0.35, [
            { shape: 'cuboid', parameters: [ 0.6, 1.2, 0.5 ], position: { x: 0, y: 1.2, z: 0 } }
        ])

        // Amplificador & Notas Musicais flutuantes
        const amp = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.78, 0.55), this.palette.dark)
        this.addStatic(amp, cx + 2.55, 0.53, cz + 0.95, [
            { shape: 'cuboid', parameters: [ 0.38, 0.39, 0.28 ] }
        ])

        const noteMat = this.glowMat('#ffe066', 1.9)
        for(let i = 0; i < 4; i++)
        {
            const note = new THREE.Group()
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), noteMat)
            note.add(head)
            const stem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.04), noteMat)
            stem.position.set(0.1, 0.18, 0)
            note.add(stem)
            note.position.set(cx - 0.8 + i * 1.0, 2.2, cz - 0.5)
            this.group.add(note)
            this.animations.musicNotes.push({ mesh: note, baseY: 2.3 + i * 0.2, phase: i * 1.4 })
        }

        // Ponto interativo para tocar acorde sintetizado de piano & violao
        this.game.interactivePoints.create(
            new THREE.Vector3(cx, 1.5, cz + 2.4),
            () => this.game.i18n.t('prompt.musicStage'),
            InteractivePoints.ALIGN_RIGHT,
            InteractivePoints.STATE_CONCEALED,
            () => this.playMusicalChord(cx, cz),
            () => this.game.inputs.interactiveButtons.addItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            () => this.game.inputs.interactiveButtons.removeItems([ 'interact' ]),
            'surface'
        )
    }

    playMusicalChord(cx, cz)
    {
        if(!this.game.audio?.mute?.active)
        {
            try
            {
                const ctx = Howler.ctx || new (window.AudioContext || window.webkitAudioContext)()
                if(ctx)
                {
                    if(ctx.state === 'suspended')
                        ctx.resume()
                    const dest = Howler.masterGain || ctx.destination
                    const now = ctx.currentTime
                    // Acorde quente Do maior com 9a (piano + violao dedilhado)
                    const freqs = [ 261.63, 329.63, 392.00, 493.88, 587.33 ]
                    freqs.forEach((f, idx) =>
                    {
                        const osc = ctx.createOscillator()
                        const gain = ctx.createGain()
                        osc.type = idx % 2 === 0 ? 'triangle' : 'sine'
                        osc.frequency.setValueAtTime(f, now + idx * 0.075)
                        gain.gain.setValueAtTime(0.0001, now + idx * 0.075)
                        gain.gain.linearRampToValueAtTime(0.11, now + idx * 0.075 + 0.03)
                        gain.gain.exponentialRampToValueAtTime(0.0008, now + idx * 0.075 + 1.35)
                        osc.connect(gain)
                        gain.connect(dest)
                        osc.start(now + idx * 0.075)
                        osc.stop(now + idx * 0.075 + 1.4)
                    })
                }
            }
            catch(e) {}
        }

        if(this.game.world?.confetti)
            this.game.world.confetti.pop(new THREE.Vector3(cx, 2.2, cz))

        this.game.notifications?.show(
            /* html */`<div class="discovery">${this.game.i18n.t('personal.music.toast')}</div>`,
            'discovery',
            3.5,
            null,
            'music-chord'
        )
    }

    // ------------------------------------------------------------------------
    // 5. MUSCULACAO (-56, 0, -28)
    // ------------------------------------------------------------------------
    setFitnessZone()
    {
        const cx = -56
        const cz = -28

        // Tatame emborrachado escuro
        const mat = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.08, 4.8), this.palette.rubber)
        mat.position.set(cx, 0.04, cz)
        mat.receiveShadow = true
        this.group.add(mat)

        // Estacao de Supino + Barra Olimpica carregada com anilhas coloridas
        const benchStation = new THREE.Group()
        const benchPad = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.16, 0.5), this.palette.dark)
        benchPad.position.set(0, 0.52, 0)
        benchStation.add(benchPad)
        for(const lx of [ -0.6, 0.6 ])
        {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.42), this.palette.steel)
            leg.position.set(lx, 0.25, 0)
            benchStation.add(leg)
        }
        for(const sz of [ -0.62, 0.62 ])
        {
            const upright = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.35, 0.1), this.palette.steel)
            upright.position.set(-0.65, 0.68, sz)
            benchStation.add(upright)
        }
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 10), this.palette.silver)
        bar.rotation.x = Math.PI * 0.5
        bar.position.set(-0.65, 1.24, 0)
        benchStation.add(bar)

        const plateSpecs = [
            { z: 0.92, r: 0.42, mat: this.palette.redPlate },
            { z: 1.04, r: 0.36, mat: this.palette.bluPlate },
            { z: 1.15, r: 0.28, mat: this.palette.ylwPlate },
        ]
        for(const side of [ -1, 1 ])
        {
            for(const p of plateSpecs)
            {
                const plate = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, 0.08, 16), p.mat)
                plate.rotation.x = Math.PI * 0.5
                plate.position.set(-0.65, 1.24, side * p.z)
                benchStation.add(plate)
            }
        }
        this.addStatic(benchStation, cx - 1.15, 0.08, cz - 0.65, [
            { shape: 'cuboid', parameters: [ 0.95, 0.72, 1.3 ], position: { x: 0, y: 0.72, z: 0 } }
        ])

        // Rack de Halteres
        const rack = new THREE.Group()
        const frame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.85, 0.55), this.palette.steel)
        frame.position.y = 0.425
        rack.add(frame)
        for(let d = 0; d < 3; d++)
        {
            const dx = -0.68 + d * 0.68
            const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 8), this.palette.silver)
            handle.rotation.x = Math.PI * 0.5
            handle.position.set(dx, 0.96, 0)
            rack.add(handle)
            const rBell = 0.11 + d * 0.03
            for(const bz of [ -0.16, 0.16 ])
            {
                const bell = new THREE.Mesh(new THREE.CylinderGeometry(rBell, rBell, 0.11, 6), this.palette.dark)
                bell.rotation.x = Math.PI * 0.5
                bell.position.set(dx, 0.96, bz)
                rack.add(bell)
            }
        }
        this.addStatic(rack, cx + 1.6, 0.08, cz - 0.9, [
            { shape: 'cuboid', parameters: [ 1.08, 0.55, 0.32 ], position: { x: 0, y: 0.55, z: 0 } }
        ])

        // 4 Kettlebells dinamicos no tatame
        const kbMats = [ this.palette.redPlate, this.palette.bluPlate, this.palette.ylwPlate, this.palette.teal ]
        for(let i = 0; i < 4; i++)
        {
            const kb = new THREE.Group()
            const ball = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), kbMats[i])
            kb.add(ball)
            const grip = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 6, 14, Math.PI), this.palette.dark)
            grip.position.y = 0.2
            kb.add(grip)

            this.addDynamic(kb, cx - 1.4 + i * 1.15, 0.34, cz + 1.45, [
                { shape: 'ball', parameters: [ 0.25 ] }
            ], 0.35, 'hitMetal')
        }
    }

    update()
    {
        const t = this.game.ticker.elapsedScaled

        if(this.animations.windmillRotor)
            this.animations.windmillRotor.rotation.z = t * 2.1

        if(this.animations.dish)
            this.animations.dish.rotation.y = Math.sin(t * 0.55) * 0.85

        if(this.animations.bizArrow)
        {
            this.animations.bizArrow.position.y = this.animations.bizArrowBaseY + Math.sin(t * 2.2) * 0.18
            this.animations.bizArrow.rotation.y = Math.sin(t * 0.8) * 0.22
        }

        for(const led of this.animations.leds)
            led.mesh.visible = Math.sin(t * 5.0 + led.phase) > -0.15

        for(const n of this.animations.musicNotes)
        {
            n.mesh.position.y = n.baseY + Math.sin(t * 1.8 + n.phase) * 0.28
            n.mesh.rotation.y = t * 0.9 + n.phase
        }
    }
}
