import * as THREE from 'three/webgpu'
import { Events } from '../../Events.js'
import { Game } from '../../Game.js'
import { Ticker } from '../../Ticker.js'
import { feel } from '../../../data/feel.js'

const SIGNAL_TOTAL = 20
const SIGNAL_COLLECT_RADIUS = 1.25
const SECRET_STAMP_RADIUS = 2.2
const PIPE_TOUCH_RADIUS = 0.95
const PIPE_INTERACT_RADIUS = 2.2
const PIPE_WARP_DURATION = 1.2 // seconds (144 fixed steps at 120 Hz)
const ENDDOT_TRIGGER_RADIUS = 2.35
const ENDDOT_RESET_RADIUS = 3.5

const STAMP_STYLE_ID = 'vn-enddot-stamp-style'

function ensureStampStyles()
{
    if(typeof document === 'undefined' || document.getElementById(STAMP_STYLE_ID))
        return

    const style = document.createElement('style')
    style.id = STAMP_STYLE_ID
    style.textContent = `
        .vn-enddot-stamp {
            position: fixed;
            inset: 0;
            z-index: 60;
            display: grid;
            place-items: center;
            background: rgba(246, 241, 231, 0.94);
            color: #0a0a0a;
            opacity: 0;
            pointer-events: none;
            transition: opacity 280ms ease-out;
        }
        .vn-enddot-stamp.is-visible {
            opacity: 1;
        }
        .is-reduced-motion .vn-enddot-stamp {
            transition: none;
        }
        .vn-enddot-seal {
            width: min(260px, 68vw);
            aspect-ratio: 1;
            border-radius: 50%;
            border: 6px solid #f50000;
            outline: 3px solid #0a0a0a;
            outline-offset: -12px;
            display: grid;
            place-items: center;
            text-align: center;
            padding: 24px;
            background: #f6f1e7;
            transform: rotate(-8deg);
            box-shadow: 0 10px 32px rgba(10, 10, 10, 0.14);
        }
        .vn-enddot-seal-kicker {
            display: block;
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: #f50000;
        }
        .vn-enddot-seal-title {
            display: block;
            margin-top: 6px;
            font-size: 1.55rem;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: #0a0a0a;
        }
    `
    document.head.appendChild(style)
}

/**
 * Era 1 ("Origens") gameplay orchestrator:
 * - T2.20a: 20 instanced collectible signals (1 InstancedMesh) + HUD sync
 * - T2.20b: Secret hollow termite mound (refSecretTermite) + 3 hidden signals + retro console prop
 * - T2.20c: Contact Pipe (~1.2s deterministic warp) -> Provisional End-Dot Island -> single-transition stamp + Contact card
 */
export class OrigensGameplay
{
    constructor(era)
    {
        this.game = Game.getInstance()
        this.era = era
        this.world = era.world
        this.events = new Events()

        this.signals = []
        this.collectedCount = 0
        this.secretOpened = false
        this.endDotTriggered = false
        this.warpState = null
        this.visualTime = 0
        this.dummy = new THREE.Object3D()

        this._boundController = null
        this._boundPlayer = null
        this._stampTimer = null

        this.setupSignals()
        this.setupSecretChamber()
        this.setupContactAndEndDot()
        this.bindTicker()

        this.game.ui?.setSignalsCount?.(0, this.signals.length || SIGNAL_TOTAL)
    }

    setupSignals()
    {
        const entries = []
        for(let i = 1; i <= SIGNAL_TOTAL; i++)
        {
            const key = `refSignal${String(i).padStart(2, '0')}`
            const ref = this.world.references.get(key)
            if(ref)
            {
                entries.push({
                    index: i,
                    id: ref.userData?.signalId || `origens_sig_${String(i).padStart(2, '0')}`,
                    position: ref.position.clone(),
                    hidden: Boolean(ref.userData?.hidden || i >= 18),
                    rare: Boolean(ref.userData?.rare || i === 20),
                    revealed: !(ref.userData?.hidden || i >= 18),
                    collected: false,
                })
            }
        }

        this.signals = entries
        const count = Math.max(1, entries.length)
        const geometry = new THREE.OctahedronGeometry(0.30, 0)
        const material = new THREE.MeshStandardMaterial({
            name: 'origensSignalMat',
            color: '#ffffff',
            emissive: '#f50000',
            emissiveIntensity: 0.42,
            roughness: 0.35,
            metalness: 0.15,
        })

        this.signalsMesh = new THREE.InstancedMesh(geometry, material, count)
        this.signalsMesh.name = 'origensSignals'
        this.signalsMesh.count = entries.length
        this.signalsMesh.castShadow = false
        this.signalsMesh.receiveShadow = false
        this.signalsMesh.frustumCulled = false

        const c = new THREE.Color()
        for(let i = 0; i < entries.length; i++)
        {
            c.set(entries[i].rare ? '#ffd23f' : '#f50000')
            this.signalsMesh.setColorAt(i, c)
        }
        if(this.signalsMesh.instanceColor)
            this.signalsMesh.instanceColor.needsUpdate = true

        this.game.scene.add(this.signalsMesh)
        this.updateSignalsVisuals()
    }

    setupSecretChamber()
    {
        this.secretRef = this.world.references.get('refSecretTermite') || null
        this.retroConsole = this.createRetroConsoleProp()
        this.retroConsole.visible = false
        if(this.secretRef)
            this.retroConsole.position.set(this.secretRef.position.x, this.secretRef.position.y + 0.38, this.secretRef.position.z)
        this.game.scene.add(this.retroConsole)
    }

    createRetroConsoleProp()
    {
        const group = new THREE.Group()
        group.name = 'origensSecretRetroConsole'

        const deck = new THREE.Mesh(
            new THREE.BoxGeometry(0.46, 0.12, 0.34),
            new THREE.MeshStandardMaterial({ color: '#d8d2c5', roughness: 0.65 })
        )
        deck.position.y = 0.06

        const cartSlot = new THREE.Mesh(
            new THREE.BoxGeometry(0.22, 0.08, 0.06),
            new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.7 })
        )
        cartSlot.position.set(0, 0.14, -0.05)

        const cartridge = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.14, 0.04),
            new THREE.MeshStandardMaterial({ color: '#f50000', emissive: '#550000', roughness: 0.45 })
        )
        cartridge.position.set(0, 0.21, -0.05)

        const led = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.02, 0.02),
            new THREE.MeshBasicMaterial({ color: '#44ff66' })
        )
        led.position.set(0.16, 0.125, 0.12)

        group.add(deck, cartSlot, cartridge, led)
        return group
    }

    setupContactAndEndDot()
    {
        this.pipeContactRef = this.world.references.get('refPipeContact') || null
        this.endDotIslandRef = this.world.references.get('refEndDotIsland') || null
        this.endDotSphereRef = this.world.references.get('refEndDotSphere') || null

        if(this.endDotIslandRef)
        {
            // Arrival terrace pad on Provisional End-Dot Island (Three.js Y-up offset from island root)
            this.endDotArrivalPos = new THREE.Vector3(
                this.endDotIslandRef.position.x - 3.15,
                this.endDotIslandRef.position.y + 1.45,
                this.endDotIslandRef.position.z + 2.35
            )
        }
        else
        {
            this.endDotArrivalPos = new THREE.Vector3(-25.15, 5.45, -17.65)
        }

        ensureStampStyles()
        if(typeof document !== 'undefined')
        {
            const root = this.game?.domElement || document.body
            this.stampOverlay = document.createElement('div')
            this.stampOverlay.className = 'vn-enddot-stamp js-enddot-stamp'
            this.stampOverlay.setAttribute('aria-hidden', 'true')
            this.stampOverlay.innerHTML = `
                <div class="vn-enddot-seal">
                    <div>
                        <span class="vn-enddot-seal-kicker">Ponto Final</span>
                        <strong class="vn-enddot-seal-title">CONTATO</strong>
                    </div>
                </div>
            `
            root.appendChild(this.stampOverlay)
        }
    }

    bindTicker()
    {
        this._onStamp = ({ x, y, z }) =>
        {
            if(this.secretOpened || !this.secretRef)
                return
            const distXZ = Math.hypot(x - this.secretRef.position.x, z - this.secretRef.position.z)
            if(distXZ <= SECRET_STAMP_RADIUS && y >= this.secretRef.position.y + 0.5)
                this.openSecret()
        }

        this._onBreak = ({ object }) =>
        {
            if(this.secretOpened)
                return
            const name = object?.visual?.object3D?.name || ''
            const role = object?.visual?.object3D?.userData?.role || ''
            if(/secret/i.test(name) || role === 'secret_termite_breakable_cap')
                this.openSecret()
        }

        this._onInteract = () =>
        {
            if(this.warpState || !this.pipeContactRef || !this._boundController)
                return
            const pos = this._boundController.body.translation()
            const feetY = pos.y - (feel.body.halfHeight + feel.body.radius)
            const distXZ = Math.hypot(pos.x - this.pipeContactRef.position.x, pos.z - this.pipeContactRef.position.z)
            const dy = feetY - this.pipeContactRef.position.y
            if(distXZ <= PIPE_INTERACT_RADIUS && Math.abs(dy) <= 1.8)
                this.startPipeWarp()
        }

        this.game.ticker.events.on('fixedTick', () =>
        {
            this.fixedUpdate()
        }, 5)

        this.game.ticker.events.on('tick', () =>
        {
            this.updateVisuals()
        }, 6)
    }

    attachPlayer(player)
    {
        if(!player)
            return
        if(player.controller && this._boundController !== player.controller)
        {
            this._boundController = player.controller
            player.controller.events.on('stamp', this._onStamp)
            player.controller.events.on('break', this._onBreak)
        }
        if(this._boundPlayer !== player)
        {
            this._boundPlayer = player
            player.events.on('interact', this._onInteract)
        }
    }

    openSecret()
    {
        if(this.secretOpened)
            return false

        this.secretOpened = true
        for(const sig of this.signals)
        {
            if(sig.hidden)
                sig.revealed = true
        }

        // Disable secret cap if still active
        for(const obj of [ ...(this.world.breakables || []) ])
        {
            const name = obj?.visual?.object3D?.name || ''
            const role = obj?.visual?.object3D?.userData?.role || ''
            if(/secret/i.test(name) || role === 'secret_termite_breakable_cap')
            {
                this.game.objects.disable(obj)
                const idx = this.world.breakables.indexOf(obj)
                if(idx !== -1)
                    this.world.breakables.splice(idx, 1)
            }
        }

        if(this.retroConsole)
            this.retroConsole.visible = true

        this.events.trigger('secretOpen', [ { signalsRevealed: 3 } ])
        this._boundController?.events.trigger('secretOpen', [ { signalsRevealed: 3 } ])
        this.game.ui?.announcer?.announce('Segredo do cupinzeiro aberto!')
        return true
    }

    startPipeWarp()
    {
        if(this.warpState || !this._boundController || !this.pipeContactRef)
            return false

        const startPos = this._boundController.body.translation()
        const centerOffsetY = feel.body.halfHeight + feel.body.radius + feel.kcc.offset
        this.warpState = {
            step: 0,
            totalSteps: Math.round(PIPE_WARP_DURATION / Ticker.FIXED_DELTA),
            start: new THREE.Vector3(startPos.x, startPos.y, startPos.z),
            end: new THREE.Vector3(
                this.endDotArrivalPos.x,
                this.endDotArrivalPos.y + centerOffsetY,
                this.endDotArrivalPos.z
            ),
        }

        this._boundController.velocity.x = 0
        this._boundController.velocity.y = 0
        this._boundController.velocity.z = 0
        this.events.trigger('pipeWarpStart', [ { duration: PIPE_WARP_DURATION } ])
        this._boundController.events.trigger('pipeWarpStart', [ { duration: PIPE_WARP_DURATION } ])
        return true
    }

    stepPipeWarp()
    {
        const w = this.warpState
        const c = this._boundController
        if(!w || !c)
            return

        w.step++
        const t = Math.min(1, w.step / w.totalSteps)
        const smooth = t * t * (3 - 2 * t)

        const x = THREE.MathUtils.lerp(w.start.x, w.end.x, smooth)
        const z = THREE.MathUtils.lerp(w.start.z, w.end.z, smooth)
        const arc = Math.sin(smooth * Math.PI) * 3.5
        const y = THREE.MathUtils.lerp(w.start.y, w.end.y, smooth) + arc

        c.velocity.x = c.velocity.y = c.velocity.z = 0
        c.body.setTranslation({ x, y, z }, true)
        c.body.setNextKinematicTranslation({ x, y, z })
        this.game.physics.world.propagateModifiedBodyPositionsToColliders()

        if(w.step >= w.totalSteps)
        {
            this.warpState = null
            c.teleport(w.end.x, w.end.y, w.end.z, c.yaw)
            this.events.trigger('pipeWarpComplete', [ { x: w.end.x, y: w.end.y, z: w.end.z } ])
            c.events.trigger('pipeWarpComplete', [ { x: w.end.x, y: w.end.y, z: w.end.z } ])
        }
    }

    triggerEndDotStamp()
    {
        if(this.endDotTriggered)
            return

        this.endDotTriggered = true
        this.events.trigger('endDotStamp', [ {} ])
        this._boundController?.events.trigger('endDotStamp', [ {} ])

        const reduced = Boolean(this.game.ui?.options?.reducedMotion)
        if(this.stampOverlay)
        {
            this.stampOverlay.classList.add('is-visible')
            if(this._stampTimer)
                clearTimeout(this._stampTimer)

            const holdMs = reduced ? 80 : 420
            this._stampTimer = setTimeout(() =>
            {
                this.stampOverlay?.classList.remove('is-visible')
                this.game.ui?.openContact?.()
            }, holdMs)
        }
        else
        {
            this.game.ui?.openContact?.()
        }
    }

    fixedUpdate()
    {
        const player = this.game.world?.player
        if(player && (this._boundPlayer !== player || this._boundController !== player.controller))
            this.attachPlayer(player)

        const controller = this._boundController
        if(!controller)
            return

        if(this.warpState)
        {
            this.stepPipeWarp()
            return
        }

        const pos = controller.body.translation()
        const feetY = pos.y - (feel.body.halfHeight + feel.body.radius)

        // 1. Collect revealed signals on touch
        for(const sig of this.signals)
        {
            if(sig.collected || !sig.revealed)
                continue

            const dist = Math.hypot(
                pos.x - sig.position.x,
                pos.y - sig.position.y,
                pos.z - sig.position.z
            )
            if(dist <= SIGNAL_COLLECT_RADIUS)
            {
                sig.collected = true
                this.collectedCount++
                this.game.ui?.setSignalsCount?.(this.collectedCount, this.signals.length)
                const payload = {
                    index: sig.index,
                    id: sig.id,
                    collected: this.collectedCount,
                    total: this.signals.length,
                    rare: sig.rare,
                }
                this.events.trigger('signalCollect', [ payload ])
                controller.events.trigger('signalCollect', [ payload ])
            }
        }

        // 2. Contact pipe touch trigger
        if(this.pipeContactRef)
        {
            const distXZ = Math.hypot(pos.x - this.pipeContactRef.position.x, pos.z - this.pipeContactRef.position.z)
            const dy = feetY - this.pipeContactRef.position.y
            if(distXZ <= PIPE_TOUCH_RADIUS && dy >= -0.2 && dy <= 1.35)
                this.startPipeWarp()
        }

        // 3. Provisional End-Dot sphere trigger
        if(this.endDotSphereRef)
        {
            const distSphere = Math.hypot(
                pos.x - this.endDotSphereRef.position.x,
                pos.y - this.endDotSphereRef.position.y,
                pos.z - this.endDotSphereRef.position.z
            )
            if(!this.endDotTriggered && distSphere <= ENDDOT_TRIGGER_RADIUS)
                this.triggerEndDotStamp()
            else if(this.endDotTriggered && distSphere > ENDDOT_RESET_RADIUS)
                this.endDotTriggered = false
        }
    }

    updateSignalsVisuals()
    {
        if(!this.signalsMesh)
            return

        for(let i = 0; i < this.signals.length; i++)
        {
            const sig = this.signals[i]
            if(sig.collected || !sig.revealed)
            {
                this.dummy.scale.set(0, 0, 0)
                this.dummy.updateMatrix()
                this.signalsMesh.setMatrixAt(i, this.dummy.matrix)
                continue
            }

            const bob = Math.sin(this.visualTime * 2.6 + sig.index * 0.45) * 0.12
            const spin = this.visualTime * 1.8 + sig.index * 0.3
            this.dummy.position.set(sig.position.x, sig.position.y + bob, sig.position.z)
            this.dummy.rotation.set(0.25, spin, 0)
            this.dummy.scale.setScalar(sig.rare ? 1.25 : 1.0)
            this.dummy.updateMatrix()
            this.signalsMesh.setMatrixAt(i, this.dummy.matrix)
        }
        this.signalsMesh.instanceMatrix.needsUpdate = true
    }

    updateVisuals()
    {
        const reduced = Boolean(this.game.ui?.options?.reducedMotion)
        if(!reduced)
            this.visualTime += Math.min(this.game.ticker.delta, 0.05)

        this.updateSignalsVisuals()

        if(this.retroConsole?.visible && !reduced)
            this.retroConsole.rotation.y = Math.sin(this.visualTime * 0.8) * 0.15
    }

    getStats()
    {
        return {
            signalsTotal: this.signals.length,
            signalsCollected: this.collectedCount,
            signalsDrawCalls: 1,
            secretOpened: this.secretOpened,
            endDotTriggered: this.endDotTriggered,
            warping: Boolean(this.warpState),
        }
    }

    dispose()
    {
        if(this._stampTimer)
            clearTimeout(this._stampTimer)
        if(this._boundController)
        {
            this._boundController.events.off('stamp', this._onStamp)
            this._boundController.events.off('break', this._onBreak)
        }
        if(this._boundPlayer)
            this._boundPlayer.events.off('interact', this._onInteract)

        this.signalsMesh?.removeFromParent()
        this.signalsMesh?.geometry.dispose()
        this.signalsMesh?.material.dispose()
        this.retroConsole?.removeFromParent()
        this.stampOverlay?.remove()
    }
}
