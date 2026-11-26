import * as THREE from 'three/webgpu'
import { color, float, Fn, sin, uv, vec4 } from 'three/tsl'
import { Howler } from 'howler'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

/**
 * Circuito Visual de Acrobacias (Superficie):
 * - Rampas esculpidas com trilhos luminosos e lip suave (sem enroscar pneus)
 * - Boost Pads Turbo ciano/ouro no chao com onda de choque ao atravessar
 * - Aros aereos luminosos rotativos (Golden Ring of Fire, Neon Tabletop, Sunset Hoops)
 * - Detector de manobras aereas ao vivo (MEGA AIR, 180/360 SPIN, ARO AEREO)
 */
export class StuntPark
{
    constructor()
    {
        this.game = Game.getInstance()
        this.group = new THREE.Group()
        this.game.scene.add(this.group)

        this.turboPads = []
        this.hoops = []
        this.bursts = []

        this.airTime = 0
        this.wasAirborne = false
        this.maxAirY = 0
        this.airSpin = 0
        this.lastYaw = null
        this.hoopCombo = 0
        this.toastTimer = null

        this.setMaterials()
        this.setDomToast()
        this.setAirAura()
        this.buildParkZones()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 11)
    }

    mat(hex)
    {
        return new MeshDefaultMaterial({ colorNode: color(hex), hasWater: false, hasLightBounce: false })
    }

    glowMat(hex, mult = 1.85)
    {
        const m = new THREE.MeshBasicNodeMaterial()
        m.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color(hex).mul(mult)), 1))()
        return m
    }

    alphaGlowMat(hex, opacity = 0.65, mult = 1.9)
    {
        const m = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        })
        m.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color(hex).mul(mult)), opacity))()
        return m
    }

    setMaterials()
    {
        this.mats = {
            steel: this.mat('#334155'),
            dark: this.mat('#1e293b'),
            ivory: this.mat('#f1f5f9'),
            orange: this.mat('#f97316'),
            gold: this.glowMat('#facc15', 2.0),
            cyan: this.glowMat('#22d3ee', 2.1),
            magenta: this.glowMat('#e879f9', 2.0),
            orangeGlow: this.glowMat('#fb923c', 2.0),
        }

        // Material animado de setas turbo no chao
        const chevronMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide })
        chevronMat.outputNode = Fn(() =>
        {
            const pulse = sin(uv().y.mul(18.0).sub(this.game.ticker.elapsedScaledUniform.mul(4.5))).mul(0.5).add(0.5)
            const c = color('#22d3ee').mul(pulse.mul(1.1).add(0.85))
            return vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, c), 1)
        })()
        this.mats.turboPad = chevronMat
    }

    setDomToast()
    {
        this.toastEl = document.createElement('div')
        this.toastEl.className = 'stunt-toast'
        document.body.appendChild(this.toastEl)
    }

    showToast(text, accent = 'gold', durationMs = 1750)
    {
        clearTimeout(this.toastTimer)
        this.toastEl.textContent = text
        this.toastEl.dataset.accent = accent
        this.toastEl.classList.remove('is-active')
        void this.toastEl.offsetWidth
        this.toastEl.classList.add('is-active')
        this.toastTimer = setTimeout(() =>
        {
            this.toastEl.classList.remove('is-active')
        }, durationMs)
    }

    playSynthChord(freqs, dur = 0.35, wave = 'triangle', peak = 0.10)
    {
        if(this.game.audio?.mute?.active) return
        try
        {
            const ctx = Howler.ctx || new (window.AudioContext || window.webkitAudioContext)()
            if(!ctx) return
            if(ctx.state === 'suspended') ctx.resume()
            const dest = Howler.masterGain || ctx.destination
            const t0 = ctx.currentTime
            freqs.forEach((f, idx) =>
            {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = wave
                osc.frequency.setValueAtTime(f, t0 + idx * 0.045)
                gain.gain.setValueAtTime(0.0001, t0 + idx * 0.045)
                gain.gain.linearRampToValueAtTime(peak, t0 + idx * 0.045 + 0.02)
                gain.gain.exponentialRampToValueAtTime(0.0006, t0 + idx * 0.045 + dur)
                osc.connect(gain)
                gain.connect(dest)
                osc.start(t0 + idx * 0.045)
                osc.stop(t0 + idx * 0.045 + dur + 0.03)
            })
        }
        catch(e) {}
    }

    setAirAura()
    {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(1.4, 1.85, 28),
            this.alphaGlowMat('#fb923c', 0.72, 2.2)
        )
        ring.rotation.x = -Math.PI * 0.5
        ring.visible = false
        this.group.add(ring)
        this.airAura = ring
    }

    spawnBurst(pos, hexColor = '#facc15')
    {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.9, 1.35, 28),
            this.alphaGlowMat(hexColor, 0.85, 2.2)
        )
        ring.rotation.x = -Math.PI * 0.5
        ring.position.set(pos.x, Math.max(0.18, pos.y), pos.z)
        this.group.add(ring)
        this.bursts.push({ ring, age: 0, maxAge: 1.1 })
    }

    addRamp(x, z, yaw, width = 3.8, length = 5.4, height = 1.65, railMat = this.mats.orangeGlow)
    {
        const slopeAngle = Math.atan2(height, length)
        const slopeLen = Math.hypot(length, height)

        const model = new THREE.Group()
        model.position.set(x, 0, z)
        model.rotation.y = yaw

        // Rampa principal inclinada com entrada suave no nivel do chao
        const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.22, slopeLen), this.mats.dark)
        deck.position.set(0, height * 0.5 - 0.11, 0)
        deck.rotation.x = -slopeAngle
        deck.castShadow = true
        deck.receiveShadow = true
        model.add(deck)

        // Faixa central esportiva branca + trilhos laterais neon
        const centerStripe = new THREE.Mesh(new THREE.BoxGeometry(width * 0.22, 0.24, slopeLen * 0.96), this.mats.ivory)
        centerStripe.position.copy(deck.position)
        centerStripe.rotation.x = -slopeAngle
        model.add(centerStripe)

        for(const side of [ -1, 1 ])
        {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.30, slopeLen * 0.98), railMat)
            rail.position.set(side * (width * 0.5 + 0.06), height * 0.5 - 0.06, 0)
            rail.rotation.x = -slopeAngle
            model.add(rail)

            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, height * 0.85, 0.24), this.mats.steel)
            leg.position.set(side * (width * 0.44), height * 0.42, length * 0.42)
            model.add(leg)
        }

        const qDeck = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -slopeAngle)
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)

        this.game.objects.add(
            { model, parent: this.group, updateMaterials: false },
            {
                type: 'fixed',
                position: new THREE.Vector3(x, 0, z),
                rotation: qYaw,
                enabled: true,
                friction: 0.45,
                restitution: 0.05,
                colliders: [
                    {
                        shape: 'cuboid',
                        parameters: [ width * 0.5, 0.12, slopeLen * 0.5 ],
                        position: { x: 0, y: height * 0.5 - 0.12, z: 0 },
                        rotation: qDeck,
                        category: 'floor'
                    }
                ]
            }
        )
    }

    addFlatDeck(x, z, yaw, width, length, height, railMat = this.mats.cyan)
    {
        const model = new THREE.Group()
        model.position.set(x, 0, z)
        model.rotation.y = yaw

        const deck = new THREE.Mesh(new THREE.BoxGeometry(width, 0.26, length), this.mats.steel)
        deck.position.set(0, height - 0.13, 0)
        deck.castShadow = true
        deck.receiveShadow = true
        model.add(deck)

        for(const side of [ -1, 1 ])
        {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, length), railMat)
            rail.position.set(side * (width * 0.5 + 0.06), height - 0.08, 0)
            model.add(rail)
            for(const pz of [ -length * 0.38, length * 0.38 ])
            {
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.28, height, 0.28), this.mats.dark)
                pillar.position.set(side * (width * 0.42), height * 0.5, pz)
                model.add(pillar)
            }
        }

        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
        this.game.objects.add(
            { model, parent: this.group, updateMaterials: false },
            {
                type: 'fixed',
                position: new THREE.Vector3(x, 0, z),
                rotation: qYaw,
                enabled: true,
                friction: 0.45,
                colliders: [
                    {
                        shape: 'cuboid',
                        parameters: [ width * 0.5, 0.13, length * 0.5 ],
                        position: { x: 0, y: height - 0.13, z: 0 },
                        category: 'floor'
                    }
                ]
            }
        )
    }

    addTurboPad(x, z, yaw, width = 3.2, length = 4.4)
    {
        const g = new THREE.Group()
        g.position.set(x, 0.04, z)
        g.rotation.y = yaw

        const frame = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.05, length + 0.3), this.mats.dark)
        g.add(frame)

        const pad = new THREE.Mesh(new THREE.PlaneGeometry(width, length), this.mats.turboPad)
        pad.rotation.x = -Math.PI * 0.5
        pad.position.y = 0.032
        g.add(pad)

        this.group.add(g)
        const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize()
        this.turboPads.push({ pos: new THREE.Vector3(x, 0, z), dir, cooldown: 0 })
    }

    addStuntHoop(x, y, z, yaw, radius = 2.6, hexColor = '#facc15', label = '🔥 ARO AÉREO! +500')
    {
        const mat = this.glowMat(hexColor, 2.1)
        const group = new THREE.Group()
        group.position.set(x, y, z)
        group.rotation.y = yaw

        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.20, 10, 32), mat)
        group.add(ring)

        // 4 marcadores estelares girando ao redor do aro
        const orbGeo = new THREE.OctahedronGeometry(0.28, 0)
        for(let i = 0; i < 4; i++)
        {
            const a = (i / 4) * Math.PI * 2
            const marker = new THREE.Mesh(orbGeo, mat)
            marker.position.set(Math.cos(a) * (radius + 0.42), Math.sin(a) * (radius + 0.42), 0)
            ring.add(marker)
        }

        this.group.add(group)
        this.hoops.push({ group, ring, pos: new THREE.Vector3(x, y, z), radius, hexColor, label, cooldown: 0 })
    }

    buildParkZones()
    {
        // ====================================================================
        // 1. ARENA ACROBATICA DO LESTE (39, 0, 10) — Rampa Dupla + Ring of Fire
        // ====================================================================
        this.addTurboPad(29.0, 10.0, Math.PI * 0.5)
        this.addRamp(33.8, 10.0, Math.PI * 0.5, 4.0, 5.2, 1.85, this.mats.orangeGlow)
        this.addTurboPad(49.0, 10.0, -Math.PI * 0.5)
        this.addRamp(44.2, 10.0, -Math.PI * 0.5, 4.0, 5.2, 1.85, this.mats.gold)
        this.addStuntHoop(39.0, 4.5, 10.0, Math.PI * 0.5, 2.75, '#facc15', '🔥 RING OF FIRE! +600')

        // Aro lateral ciano para salto em diagonal (em frente aos distritos sul/norte)
        this.addTurboPad(39.0, 22.8, Math.PI)
        this.addRamp(39.0, 18.2, Math.PI, 3.6, 4.8, 1.65, this.mats.cyan)
        this.addStuntHoop(39.0, 4.0, 14.0, 0, 2.4, '#22d3ee', '⚡ TURBO HOOP! +500')

        // ====================================================================
        // 2. OVERPASS TABLETOP OESTE (-59, 0, -34) — Ponte Aerea de Manobras
        // ====================================================================
        this.addTurboPad(-59.0, -23.5, Math.PI)
        this.addRamp(-59.0, -28.0, Math.PI, 3.8, 5.2, 1.95, this.mats.magenta)
        this.addFlatDeck(-59.0, -34.0, 0, 3.8, 6.8, 1.95, this.mats.magenta)
        this.addRamp(-59.0, -40.0, 0, 3.8, 5.2, 1.95, this.mats.cyan)
        this.addTurboPad(-59.0, -44.5, 0)
        this.addStuntHoop(-59.0, 4.4, -34.0, 0, 2.45, '#e879f9', '🌀 TABLETOP HOOP! +550')

        // ====================================================================
        // 3. SALTO POR DO SOL SUDOESTE (-32, 0, 19) — Rampa Costeira + Duplo Aro
        // ====================================================================
        this.addTurboPad(-32.0, 24.5, Math.PI)
        this.addRamp(-32.0, 20.0, Math.PI, 3.8, 5.0, 1.75, this.mats.orangeGlow)
        this.addStuntHoop(-32.0, 3.8, 15.2, 0, 2.45, '#fb923c', '🌅 SALTO COSTEIRO! +500')
        this.addStuntHoop(-32.0, 4.3, 11.4, 0, 2.55, '#34cfc4', '✨ DUPLO ARO! +800')
    }

    update()
    {
        if(this.game.worldManager?.isUnderwater)
        {
            if(this.airAura) this.airAura.visible = false
            return
        }

        const pv = this.game.physicalVehicle
        const playerPos = this.game.player?.position
        if(!pv || !playerPos) return

        const t = this.game.ticker.elapsedScaled
        const dt = Math.min(0.05, this.game.ticker.delta || 0.016)

        // Ondas de choque expansivas
        for(let i = this.bursts.length - 1; i >= 0; i--)
        {
            const b = this.bursts[i]
            b.age += dt
            const p = b.age / b.maxAge
            if(p >= 1)
            {
                this.group.remove(b.ring)
                b.ring.geometry.dispose()
                this.bursts.splice(i, 1)
                continue
            }
            b.ring.scale.setScalar(1 + p * 8.5)
            b.ring.visible = p < 0.92
        }

        // Boost Turbo Pads no chao
        for(const pad of this.turboPads)
        {
            if(pad.cooldown > 0) pad.cooldown = Math.max(0, pad.cooldown - dt)
            if(pad.cooldown === 0 && Math.hypot(playerPos.x - pad.pos.x, playerPos.z - pad.pos.z) < 2.6 && playerPos.y < 1.8)
            {
                pad.cooldown = 1.2
                const body = pv.chassis?.physical?.body
                if(body && pv.xzSpeed < 27)
                {
                    const impulse = pad.dir.clone().multiplyScalar(pv.chassis.mass * 9.5)
                    body.applyImpulse({ x: impulse.x, y: pv.chassis.mass * 1.1, z: impulse.z }, true)
                }
                this.spawnBurst(pad.pos, '#22d3ee')
                this.playSynthChord([ 440, 659.25, 880 ], 0.25, 'sawtooth', 0.075)
                this.showToast('⚡ TURBO LAUNCH!', 'cyan', 950)
            }
        }

        // Aros aereos giratorios + pontuacao
        for(const h of this.hoops)
        {
            if(h.cooldown > 0) h.cooldown = Math.max(0, h.cooldown - dt)
            h.ring.rotation.z = t * 1.35
            if(h.cooldown === 0 && playerPos.distanceTo(h.pos) < h.radius + 1.05)
            {
                h.cooldown = 2.0
                this.hoopCombo++
                this.spawnBurst(h.pos, h.hexColor)
                this.game.world?.confetti?.pop(h.pos.clone())
                this.playSynthChord([ 523.25, 659.25, 783.99, 1046.5 ], 0.38, 'triangle', 0.12)
                this.showToast(this.hoopCombo > 1 ? `${h.label} x${this.hoopCombo}` : h.label, 'gold', 1500)
            }
        }

        // Detector ao vivo de manobras aereas (tempo no ar + rotacao yaw)
        const inAir = pv.wheels.inContactCount === 0 && playerPos.y > 1.22
        if(inAir)
        {
            if(!this.wasAirborne)
            {
                this.wasAirborne = true
                this.airTime = 0
                this.maxAirY = playerPos.y
                this.airSpin = 0
                this.lastYaw = pv.yRotation
            }
            this.airTime += dt
            this.maxAirY = Math.max(this.maxAirY, playerPos.y)
            if(this.lastYaw !== null)
            {
                let dYaw = pv.yRotation - this.lastYaw
                while(dYaw > Math.PI) dYaw -= Math.PI * 2
                while(dYaw < -Math.PI) dYaw += Math.PI * 2
                this.airSpin += dYaw
            }
            this.lastYaw = pv.yRotation

            if(this.airAura)
            {
                this.airAura.visible = this.airTime > 0.22
                this.airAura.position.set(playerPos.x, 0.14, playerPos.z)
                this.airAura.rotation.z = t * 4.5
                this.airAura.scale.setScalar(1 + Math.min(0.6, this.airTime * 0.35))
            }
        }
        else if(this.wasAirborne && pv.wheels.inContactCount >= 2)
        {
            if(this.airTime >= 0.48)
            {
                const absSpin = Math.abs(this.airSpin)
                let label = `✨ SALTO LIMPO! (${this.airTime.toFixed(1)}s)`
                let pts = Math.round(this.airTime * 300)
                if(absSpin >= 4.4)
                {
                    pts += 800
                    label = `🌀 360° ACROBATICO! +${pts}`
                }
                else if(absSpin >= 2.3)
                {
                    pts += 450
                    label = `🌀 180° DRIFT AIR! +${pts}`
                }
                else if(this.airTime >= 1.25 || this.maxAirY >= 3.8)
                {
                    pts += 500
                    label = `🚀 MEGA AIR ${this.airTime.toFixed(1)}s! +${pts}`
                }
                this.spawnBurst(playerPos, '#f97316')
                this.game.world?.confetti?.pop(playerPos.clone().setY(playerPos.y + 1.4))
                this.playSynthChord([ 440, 554.37, 659.25 ], 0.32, 'triangle', 0.11)
                this.showToast(label, 'gold', 1750)
            }
            this.wasAirborne = false
            this.airTime = 0
            this.hoopCombo = 0
            if(this.airAura) this.airAura.visible = false
        }
        else
        {
            if(this.airAura) this.airAura.visible = false
        }
    }
}
