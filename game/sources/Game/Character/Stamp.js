// Stamp (plan T1.4, docs/PLAN-3D.md 3.2): in the air the player pulls out a giant rubber stamp, hangs for `lockTime`, then
// dives straight down at `diveSpeed` and marks the "point" on the ground. On impact: a ring is left on the floor, the
// controller emits 'stamp' (sound / shake hooks) and the breakable crates of the level are removed ('break' per crate).
//
// Determinism: advance() runs inside CharacterController.step() (fixedTick only), counts REAL seconds in fixed steps
// and never reads the frame delta, wall clock or Math.random. Only the ring/handle visuals animate per frame, and they
// never feed back into the simulation. Tunables: data/feel.js (group `stamp`).
import * as THREE from 'three/webgpu'
import { feel } from '../../data/feel.js'

export class Stamp
{
    static IDLE = 0
    static LOCK = 1 // hanging in the air
    static DIVE = 2 // falling straight down at diveSpeed

    constructor(controller)
    {
        this.controller = controller
        this.game = controller.game
        this.phase = Stamp.IDLE
        this.timer = 0 // s left of the lock
        this.count = 0 // stamps landed since the start
        this.broken = 0 // crates broken since the start

        this.setVisuals()
        this.game.ticker.events.on('tick', () => this.update(), 6)
    }

    get active()
    {
        return this.phase !== Stamp.IDLE
    }

    // Placeholder visuals: a flat ring mark on the floor and a stamp handle held in front of the character
    setVisuals()
    {
        this.ring = new THREE.Mesh(
            new THREE.RingGeometry(0.55, 0.75, 32),
            new THREE.MeshBasicMaterial({ name: 'stampRing', color: '#1f1f1f', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
        )
        this.ring.rotation.x = - Math.PI / 2
        this.ring.visible = false
        this.ring.name = 'stampRing'
        this.ringAge = Infinity // s since the impact (visual time)
        this.game.scene.add(this.ring)

        this.handle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.22, 0.22, 0.12, 20),
            new THREE.MeshStandardMaterial({ name: 'greyDark', color: '#4a4a4a' })
        )
        this.handle.position.set(0, - 0.5, - 0.05)
        this.handle.visible = false
        this.handle.name = 'stampHandle'
    }

    attachVisual(parent)
    {
        parent.add(this.handle)
    }

    reset()
    {
        this.phase = Stamp.IDLE
        this.timer = 0
    }

    // Called at the start of every fixed step. `input.stampPressed` is the latched edge. Returns true while the stamp
    // drives the step (lock or dive).
    advance(input, dt)
    {
        const controller = this.controller
        const settings = feel.stamp

        if(this.phase === Stamp.IDLE)
        {
            if(input.stampPressed && !controller.grounded && controller.heightAboveGround(settings.minHeight) >= settings.minHeight)
            {
                this.phase = Stamp.LOCK
                this.timer = settings.lockTime
                controller.jumping = false
                controller.gliding = false
                controller.bufferTimer = 0
                controller.skidTimer = 0
                controller.velocity.x = controller.velocity.y = controller.velocity.z = 0
                controller.events.trigger('stampStart', [ {} ])
            }
        }

        else if(this.phase === Stamp.LOCK)
        {
            if(controller.grounded)
            {
                this.reset()
                return false
            }
            this.timer -= dt
            if(this.timer <= 1e-9)
                this.phase = Stamp.DIVE
        }

        return this.phase !== Stamp.IDLE
    }

    // Vertical speed commanded this step while stamping (0 while hanging)
    get verticalSpeed()
    {
        return this.phase === Stamp.DIVE ? - feel.stamp.diveSpeed : 0
    }

    // The dive touched the ground: mark it, break the crates, emit 'stamp'
    impact(position)
    {
        const settings = feel.stamp
        const feetY = position.y - (feel.body.halfHeight + feel.body.radius)
        this.phase = Stamp.IDLE
        this.count++

        // Crates whose centre is within `breakRadius` (horizontal) and close to the stamped surface
        const broken = []
        const crates = this.game.world?.breakables ?? []
        for(const crate of [ ...crates ])
        {
            if(!crate.physical?.body?.isEnabled())
                continue
            const at = crate.physical.body.translation()
            const dy = at.y - feetY
            if(Math.hypot(at.x - position.x, at.z - position.z) <= settings.breakRadius && dy >= - settings.breakDepth && dy <= settings.breakHeight)
                broken.push({ crate, x: at.x, y: at.y, z: at.z })
        }
        for(const { crate, x, y, z } of broken)
        {
            this.game.objects.disable(crate) // removes the body from the simulation and the visual from the scene
            const idx = crates.indexOf(crate)
            if(idx !== - 1)
                crates.splice(idx, 1)
            this.broken++
            this.controller.events.trigger('break', [ { object: crate, x, y, z } ])
        }

        // Ring on the floor (visual time)
        this.ring.position.set(position.x, feetY + 0.02, position.z)
        this.ring.visible = true
        this.ringAge = 0

        this.controller.events.trigger('stamp', [ { x: position.x, y: feetY, z: position.z, broken: broken.length, speed: settings.diveSpeed } ])
    }

    // Per frame, visual only
    update()
    {
        this.handle.visible = this.active

        if(this.ring.visible)
        {
            this.ringAge += this.game.ticker.delta
            const t = this.ringAge / feel.stamp.ringLife
            if(t >= 1)
                this.ring.visible = false
            else
            {
                const scale = 1 + 1.5 * (1 - Math.pow(1 - Math.min(t * 4, 1), 3))
                this.ring.scale.set(scale, scale, 1)
                this.ring.material.opacity = 0.85 * (1 - t)
            }
        }
    }
}
