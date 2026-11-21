// Rail-grind mechanic along the Line ("a Linha") spline (T2.18b / T2.18c).
//
// Determinism: `advance(input, dt)` runs strictly inside CharacterController.step() ('fixedTick' only, dt = 1/120 s)
// with zero wall-clock or Math.random reads. When no `game.world.line` is loaded (e.g. greybox), `advance()` is a pure
// no-op so Phase 1 ghosts remain 100% bit-identical.
// Visual FX (InstancedMesh sparks in ipeGold #f7c531 + signalEmissive #ff2a2a, scarf/ribbon glow) run on 'tick'.
import * as THREE from 'three/webgpu'
import { Events } from '../Events.js'
import { feel } from '../../data/feel.js'
import { Line } from '../World/Line.js'

const BASE_SPEED = 11.5
const MIN_SPEED = 9.0
const MAX_SPEED = 14.0
const REENTRY_COOLDOWN = 0.25
const MAX_ENTRY_VY = 2.5
const JUMP_BOOST_FACTOR = 1.2
const DOWNHILL_ACCEL = 14.0
const UPHILL_DAMP = 6.0
const FLAT_RELAX = 0.8
const DEG = Math.PI / 180

const MAX_SPARKS = 96
const IPE_GOLD = new THREE.Color('#f7c531')
const SIGNAL_EMISSIVE = new THREE.Color('#ff2a2a')

export class Grind
{
    constructor(controller)
    {
        this.controller = controller
        this.game = controller.game
        this.LineClass = Line
        this.events = new Events()

        this.active = false
        this.s = 0
        this.speed = BASE_SPEED
        this.direction = 1
        this.cooldownTimer = 0
        this.entries = 0
        this.jumps = 0
        this.sparks = 0
        this.milestoneIndex = - 1
        this.sparkCursor = 0
        this.sparkEmitAcc = 0
        this.fxTime = 0

        this.exposeTelemetry()
        this.setVisuals()

        if(this.game?.ticker?.events)
            this.game.ticker.events.on('tick', () => this.update(), 6)
    }

    get line()
    {
        return this.game?.world?.line ?? null
    }

    get length()
    {
        return this.line?.length ?? 0
    }

    get progress()
    {
        const len = this.length
        return len > 0 ? Math.max(0, Math.min(1, this.s / len)) : 0
    }

    exposeTelemetry()
    {
        if(typeof window === 'undefined')
            return
        const self = this
        Object.defineProperty(window, '__grind', {
            configurable: true,
            get()
            {
                return {
                    active: self.active,
                    s: self.s,
                    length: self.length,
                    speed: self.speed,
                    progress: self.progress,
                    entries: self.entries,
                    jumps: self.jumps,
                    sparks: self.sparks,
                    milestoneIndex: self.milestoneIndex,
                }
            },
        })
    }

    setVisuals()
    {
        if(!this.game?.scene)
            return

        // InstancedMesh sparks spraying behind Victor's shoes (ipeGold + signalEmissive)
        const sparkGeo = new THREE.BoxGeometry(0.038, 0.038, 0.16)
        const sparkMat = new THREE.MeshBasicMaterial({
            name: 'grindSparks',
            color: '#ffffff',
            transparent: true,
            opacity: 0.95,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        })
        this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS)
        this.sparkMesh.name = 'grindSparks'
        this.sparkMesh.frustumCulled = false
        this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

        this.sparkPool = []
        const dummy = new THREE.Object3D()
        dummy.scale.set(0, 0, 0)
        dummy.updateMatrix()

        for(let i = 0; i < MAX_SPARKS; i++)
        {
            const isGold = (i % 10) < 7
            this.sparkMesh.setColorAt(i, isGold ? IPE_GOLD : SIGNAL_EMISSIVE)
            this.sparkMesh.setMatrixAt(i, dummy.matrix)
            this.sparkPool.push({
                life: 0,
                maxLife: 0.25,
                x: 0,
                y: 0,
                z: 0,
                vx: 0,
                vy: 0,
                vz: 0,
            })
        }
        if(this.sparkMesh.instanceColor)
            this.sparkMesh.instanceColor.needsUpdate = true
        this.sparkMesh.instanceMatrix.needsUpdate = true
        this.game.scene.add(this.sparkMesh)

        // Glowing scarf/aura highlight around Victor while grinding
        const auraGeo = new THREE.TorusGeometry(0.36, 0.045, 8, 24)
        this.scarfGlowMaterial = new THREE.MeshBasicMaterial({
            name: 'grindScarfGlow',
            color: IPE_GOLD.clone(),
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        })
        this.scarfGlow = new THREE.Mesh(auraGeo, this.scarfGlowMaterial)
        this.scarfGlow.rotation.x = Math.PI * 0.5
        this.scarfGlow.visible = false
        this.scarfGlow.name = 'grindScarfGlow'
        this.game.scene.add(this.scarfGlow)
    }

    reset()
    {
        if(this.active)
            this.triggerEvent('grindEnd', { s: this.s, progress: this.progress, speed: this.speed, reason: 'reset' })
        this.active = false
        this.s = 0
        this.speed = BASE_SPEED
        this.direction = 1
        this.cooldownTimer = 0
        this.milestoneIndex = - 1
        this.line?.setGrindVisualState?.(false, 0)
    }

    triggerEvent(name, payload)
    {
        this.events.trigger(name, [ payload ])
        this.controller.events.trigger(name, [ payload ])
    }

    // Called in CharacterController.step() (fixedTick only). Returns true when Grind owns the step.
    advance(input, dt)
    {
        const line = this.line
        if(!line || line.length <= 0)
            return false

        if(this.cooldownTimer > 0)
            this.cooldownTimer = Math.max(0, this.cooldownTimer - dt)

        const controller = this.controller
        const half = feel.body.halfHeight + feel.body.radius

        if(!this.active)
        {
            if(controller.grounded || controller.stamp.active || controller.velocity.y > MAX_ENTRY_VY || this.cooldownTimer > 0)
                return false

            const pos = controller.body.translation()
            const feetHit = line.detect({ x: pos.x, y: pos.y - half, z: pos.z })
            const bodyHit = line.detect(pos)
            const hit = (!feetHit || (bodyHit && bodyHit.distance < feetHit.distance)) ? bodyHit : feetHit
            if(!hit)
                return false

            const vx = controller.velocity.x
            const vz = controller.velocity.z
            const horizSpeed = Math.hypot(vx, vz)
            const dir = horizSpeed > 0.25
                ? ((vx * hit.tangent.x + vz * hit.tangent.z) >= 0 ? 1 : - 1)
                : 1

            // Do not re-latch at the very exit tip
            if((dir > 0 && hit.s >= line.length - 0.15) || (dir < 0 && hit.s <= 0.15))
                return false

            this.active = true
            this.s = hit.s
            this.direction = dir
            this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.max(BASE_SPEED, horizSpeed)))
            this.entries++
            this.milestoneIndex = this.findMilestoneIndex(this.s)

            controller.grounded = false
            controller.jumping = false
            controller.gliding = false
            controller.glideUsed = false
            controller.skidTimer = 0
            controller.bufferTimer = 0
            controller.coyoteTimer = 0
            controller.lean = 0
            controller.groundPlatform = null
            controller.inheritedAirVelocity.x = controller.inheritedAirVelocity.z = 0

            line.setGrindVisualState?.(true, this.progress)
            this.setCharacterVisualState('grind')
            this.triggerEvent('grindStart', {
                s: this.s,
                progress: this.progress,
                speed: this.speed,
                x: hit.point.x,
                y: hit.point.y,
                z: hit.point.z,
            })
        }

        // --- Jump off the Line with +20% horizontal speed boost along spline tangent
        if(input.jumpPressed || controller.bufferTimer > 0)
        {
            const sample = line.sampleAt(this.s)
            const tx = sample.tangent.x * this.direction
            const tz = sample.tangent.z * this.direction
            const hLen = Math.hypot(tx, tz) || 1
            const boostSpeed = this.speed * JUMP_BOOST_FACTOR

            this.active = false
            this.cooldownTimer = REENTRY_COOLDOWN
            this.jumps++

            controller.velocity.x = (tx / hLen) * boostSpeed
            controller.velocity.z = (tz / hLen) * boostSpeed
            controller.velocity.y = controller.jumpSpeed
            controller.speed = boostSpeed
            controller.movedSpeed = boostSpeed
            controller.jumping = true
            controller.grounded = false
            controller.gliding = false
            controller.glideUsed = false
            controller.jumpStartY = controller.next.y
            controller.bufferTimer = 0
            controller.coyoteTimer = 0

            const pos = controller.body.translation()
            controller.next.x = pos.x + controller.velocity.x * dt
            controller.next.y = pos.y + controller.velocity.y * dt
            controller.next.z = pos.z + controller.velocity.z * dt
            controller.body.setNextKinematicTranslation(controller.next)
            controller.body.setNextKinematicRotation(controller.yawQuaternion())
            controller.steps++

            line.setGrindVisualState?.(false, this.progress)
            this.setCharacterVisualState('jump')
            this.triggerEvent('grindEnd', {
                s: this.s,
                progress: this.progress,
                speed: this.speed,
                reason: 'jump',
                x: controller.next.x,
                y: controller.next.y,
                z: controller.next.z,
            })
            controller.events.trigger('jump', [ { speed: controller.jumpSpeed, grindBoost: boostSpeed } ])
            return true
        }

        // --- Advance along spline tangent
        const prevS = this.s
        const currentSample = line.sampleAt(this.s)
        const slopeY = currentSample.tangent.y * this.direction

        if(slopeY < - 1e-4)
            this.speed += (- slopeY) * DOWNHILL_ACCEL * dt
        else if(slopeY > 1e-4)
            this.speed -= slopeY * UPHILL_DAMP * dt
        this.speed += (BASE_SPEED - this.speed) * FLAT_RELAX * dt
        this.speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, this.speed))

        this.s += this.direction * this.speed * dt

        // Check milestone crossings
        this.checkMilestones(prevS, this.s, currentSample.point)

        // Check end of spline
        if((this.direction > 0 && this.s >= line.length) || (this.direction < 0 && this.s <= 0))
        {
            this.s = Math.max(0, Math.min(line.length, this.s))
            const endSample = line.sampleAt(this.s)
            this.active = false
            this.cooldownTimer = REENTRY_COOLDOWN

            controller.velocity.x = endSample.tangent.x * this.direction * this.speed
            controller.velocity.y = endSample.tangent.y * this.direction * this.speed
            controller.velocity.z = endSample.tangent.z * this.direction * this.speed
            controller.next.x = endSample.point.x
            controller.next.y = endSample.point.y + half + line.thickness * 0.5
            controller.next.z = endSample.point.z
            controller.body.setNextKinematicTranslation(controller.next)
            controller.body.setNextKinematicRotation(controller.yawQuaternion())
            controller.steps++

            line.setGrindVisualState?.(false, this.progress)
            this.setCharacterVisualState('fall')
            this.triggerEvent('grindEnd', {
                s: this.s,
                progress: this.progress,
                speed: this.speed,
                reason: 'end',
                x: endSample.point.x,
                y: endSample.point.y,
                z: endSample.point.z,
            })
            return true
        }

        const nextSample = line.sampleAt(this.s)
        controller.next.x = nextSample.point.x
        controller.next.y = nextSample.point.y + half + line.thickness * 0.5
        controller.next.z = nextSample.point.z

        controller.velocity.x = nextSample.tangent.x * this.direction * this.speed
        controller.velocity.y = nextSample.tangent.y * this.direction * this.speed
        controller.velocity.z = nextSample.tangent.z * this.direction * this.speed
        controller.speed = Math.hypot(controller.velocity.x, controller.velocity.z)
        controller.movedSpeed = this.speed
        controller.grounded = false
        controller.lean = 0

        // Face along the spline tangent
        const heading = Math.atan2(- nextSample.tangent.x * this.direction, - nextSample.tangent.z * this.direction)
        let diff = heading - controller.yaw
        diff = Math.atan2(Math.sin(diff), Math.cos(diff))
        const maxStep = feel.turn.yawRate * DEG * dt
        const yawDelta = Math.max(- maxStep, Math.min(maxStep, diff))
        controller.yaw = Math.atan2(Math.sin(controller.yaw + yawDelta), Math.cos(controller.yaw + yawDelta))

        controller.body.setNextKinematicTranslation(controller.next)
        controller.body.setNextKinematicRotation(controller.yawQuaternion())
        controller.steps++

        line.setGrindVisualState?.(true, this.progress)
        this.setCharacterVisualState('grind')
        this.triggerEvent('grindTick', {
            s: this.s,
            progress: this.progress,
            speed: this.speed,
            normalizedSpeed: (this.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED),
            x: nextSample.point.x,
            y: nextSample.point.y,
            z: nextSample.point.z,
        })

        return true
    }

    findMilestoneIndex(s)
    {
        const milestones = this.line?.milestones
        if(!milestones || milestones.length === 0)
            return - 1
        let idx = - 1
        for(let i = 0; i < milestones.length; i++)
        {
            if(s >= milestones[i].s)
                idx = i
        }
        return idx
    }

    checkMilestones(prevS, nextS, point)
    {
        const milestones = this.line?.milestones
        if(!milestones || milestones.length === 0)
            return

        const minS = Math.min(prevS, nextS)
        const maxS = Math.max(prevS, nextS)
        for(let i = 0; i < milestones.length; i++)
        {
            const m = milestones[i]
            if(m.s > minS && m.s <= maxS && i !== this.milestoneIndex)
            {
                this.milestoneIndex = i
                this.triggerEvent('milestonePass', {
                    index: m.index,
                    name: m.name,
                    s: m.s,
                    progress: m.progress,
                    x: point.x,
                    y: point.y,
                    z: point.z,
                })
            }
        }
    }

    setCharacterVisualState(state)
    {
        const visual = this.game?.world?.player?.visual ?? this.controller.visual
        if(visual && typeof visual.setState === 'function')
            visual.setState(state)
    }

    // Per frame, visual only (sparks + scarf glow)
    update()
    {
        const dt = this.game?.ticker?.delta ?? 0
        if(dt <= 0)
            return
        this.fxTime += dt

        const half = feel.body.halfHeight + feel.body.radius
        const pos = this.controller.next

        if(this.scarfGlow)
        {
            if(this.active)
            {
                const pulse = 0.5 + 0.5 * Math.sin(this.fxTime * 18)
                this.scarfGlow.visible = true
                this.scarfGlow.position.set(pos.x, pos.y + 0.15, pos.z)
                const s = 1 + 0.18 * pulse
                this.scarfGlow.scale.set(s, s, s)
                this.scarfGlowMaterial.color.copy(IPE_GOLD).lerp(SIGNAL_EMISSIVE, pulse * 0.6)
                this.scarfGlowMaterial.opacity = 0.55 + 0.35 * pulse
            }
            else
            {
                this.scarfGlow.visible = false
            }
        }

        if(!this.sparkMesh)
            return

        if(this.active)
        {
            this.sparkEmitAcc += dt * 75
            const count = Math.floor(this.sparkEmitAcc)
            this.sparkEmitAcc -= count
            const vx = this.controller.velocity.x
            const vz = this.controller.velocity.z
            const hLen = Math.hypot(vx, vz) || 1
            const bx = - vx / hLen
            const bz = - vz / hLen

            for(let i = 0; i < count; i++)
            {
                const p = this.sparkPool[this.sparkCursor]
                this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS
                const spread = ((this.sparkCursor % 7) - 3) * 0.35
                p.life = p.maxLife
                p.x = pos.x + bx * 0.18 + (- bz) * spread * 0.25
                p.y = pos.y - half + 0.05
                p.z = pos.z + bz * 0.18 + bx * spread * 0.25
                p.vx = bx * (3.5 + (this.sparkCursor % 4) * 0.6) + (- bz) * spread
                p.vy = 1.6 + (this.sparkCursor % 5) * 0.45
                p.vz = bz * (3.5 + (this.sparkCursor % 4) * 0.6) + bx * spread
                this.sparks++
            }
        }

        const dummy = new THREE.Object3D()
        let anyDirty = false
        for(let i = 0; i < MAX_SPARKS; i++)
        {
            const p = this.sparkPool[i]
            if(p.life > 0)
            {
                p.life = Math.max(0, p.life - dt)
                p.vy -= 9.81 * dt
                p.x += p.vx * dt
                p.y += p.vy * dt
                p.z += p.vz * dt
                const t = p.life / p.maxLife
                dummy.position.set(p.x, p.y, p.z)
                dummy.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz)
                dummy.scale.set(t, t, t * 1.4)
                dummy.updateMatrix()
                this.sparkMesh.setMatrixAt(i, dummy.matrix)
                anyDirty = true
            }
            else if(this.active || p.life === 0)
            {
                dummy.scale.set(0, 0, 0)
                dummy.updateMatrix()
                this.sparkMesh.setMatrixAt(i, dummy.matrix)
                anyDirty = true
                p.life = - 1
            }
        }
        if(anyDirty)
            this.sparkMesh.instanceMatrix.needsUpdate = true
    }
}
