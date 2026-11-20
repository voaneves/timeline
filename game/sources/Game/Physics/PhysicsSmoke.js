// Rapier smoke test (plan T0.7). Loaded only with `?debug=physics`. Runs in an isolated World (not the game's),
// fixed 1/60 s steps, so results do not depend on the display. Result: window.__physicsSmoke = { version, pass, tests }.
// Covers: createVehicleController 10 s, createCharacterController 10 s, and the "sleep bug" that made upstream
// stay on 0.19.3 (sleeping bodies must wake on impulse, on contact, and when their support is removed).
const DT = 1 / 60

const makeWorld = (RAPIER) =>
{
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    world.timestep = DT
    world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0))
    return world
}

const box = (RAPIER, world, x, y, z, half = 0.5) =>
{
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z))
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half).setDensity(1).setFriction(0.5), body)
    return { body, collider }
}

const stepUntil = (world, seconds, predicate) =>
{
    const max = Math.round(seconds / DT)
    for(let i = 0; i < max; i++)
    {
        world.step()
        if(predicate(i))
            return (i + 1) * DT
    }
    return null
}

const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)

const tests = {
    vehicle(RAPIER)
    {
        const world = makeWorld(RAPIER)
        const chassis = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0))
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.3, 1.6).setDensity(1), chassis)
        const vehicle = world.createVehicleController(chassis)
        const wheels = [ [ -0.8, 1.2 ], [ 0.8, 1.2 ], [ -0.8, -1.2 ], [ 0.8, -1.2 ] ]
        for(const [ x, z ] of wheels)
        {
            const i = vehicle.numWheels()
            vehicle.addWheel({ x, y: -0.2, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.3, 0.35)
            vehicle.setWheelSuspensionStiffness(i, 30)
            vehicle.setWheelFrictionSlip(i, 2)
        }
        const start = chassis.translation()
        const steps = Math.round(10 / DT)
        for(let i = 0; i < steps; i++)
        {
            for(let w = 2; w < 4; w++)
                vehicle.setWheelEngineForce(w, 40)
            vehicle.setWheelSteering(0, 0.1)
            vehicle.setWheelSteering(1, 0.1)
            vehicle.updateVehicle(DT)
            world.step()
        }
        const end = chassis.translation()
        const moved = Math.hypot(end.x - start.x, end.z - start.z)
        return { pass: finite(end) && end.y > 0 && end.y < 3 && moved > 1, wheels: vehicle.numWheels(), moved, endY: end.y, simSeconds: steps * DT }
    },

    character(RAPIER)
    {
        const world = makeWorld(RAPIER)
        world.createCollider(RAPIER.ColliderDesc.cuboid(2, 0.15, 2).setTranslation(6, 0.15, 0)) // step 0.3 m
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0))
        const collider = world.createCollider(RAPIER.ColliderDesc.capsule(0.4, 0.3), body)
        const controller = world.createCharacterController(0.01)
        controller.enableAutostep(0.35, 0.1, true)
        controller.enableSnapToGround(0.3)
        controller.setSlideEnabled(true)
        controller.setMaxSlopeClimbAngle(Math.PI / 4)
        let vy = 0
        let grounded = 0
        const steps = Math.round(10 / DT)
        for(let i = 0; i < steps; i++)
        {
            vy = controller.computedGrounded() ? 0 : vy - 9.81 * DT
            controller.computeColliderMovement(collider, { x: 1.2 * DT, y: vy * DT, z: 0 })
            const m = controller.computedMovement()
            const p = body.translation()
            body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z })
            world.step()
            if(controller.computedGrounded())
                grounded++
        }
        const end = body.translation()
        return { pass: finite(end) && end.x > 5 && end.y > 0.3 && end.y < 3 && grounded > steps / 2, endX: end.x, endY: end.y, groundedSteps: grounded, simSeconds: steps * DT }
    },

    // A: falls, sleeps, is woken by an impulse and moves
    sleepImpulse(RAPIER)
    {
        const world = makeWorld(RAPIER)
        const { body } = box(RAPIER, world, 0, 2, 0)
        const tSleep = stepUntil(world, 15, () => body.isSleeping())
        if(tSleep === null)
            return { pass: false, reason: 'never slept' }
        body.applyImpulse({ x: 3, y: 3, z: 0 }, true)
        const wokeImmediately = !body.isSleeping()
        stepUntil(world, 1, () => false)
        return { pass: wokeImmediately && body.translation().x > 0.5, tSleep, wokeImmediately, xAfter1s: body.translation().x }
    },

    // B: a sleeping cube is hit by a falling cube (contact wake)
    sleepContact(RAPIER)
    {
        const world = makeWorld(RAPIER)
        const a = box(RAPIER, world, 0, 0.5, 0)
        const tSleep = stepUntil(world, 15, () => a.body.isSleeping())
        if(tSleep === null)
            return { pass: false, reason: 'never slept' }
        box(RAPIER, world, 0.3, 3, 0)
        const wokeAtStep = (() => { let w = null; stepUntil(world, 3, (i) => { if(!a.body.isSleeping()) { w = i; return true } return false }); return w })()
        const pos = a.body.translation()
        return { pass: wokeAtStep !== null, tSleep, wokeAtStep, aPos: [ pos.x, pos.y, pos.z ] }
    },

    // C: B rests on A, both sleep, A removed: B must wake and fall to the ground
    sleepSupportRemoved(RAPIER)
    {
        const world = makeWorld(RAPIER)
        const a = box(RAPIER, world, 0, 0.5, 0)
        const b = box(RAPIER, world, 0, 1.5, 0)
        const tSleep = stepUntil(world, 15, () => a.body.isSleeping() && b.body.isSleeping())
        if(tSleep === null)
            return { pass: false, reason: 'stack never slept' }
        const yBefore = b.body.translation().y
        world.removeRigidBody(a.body)
        stepUntil(world, 2, () => false)
        const yAfter = b.body.translation().y
        return { pass: yAfter < yBefore - 0.4 && Math.abs(yAfter - 0.5) < 0.05, tSleep, yBefore, yAfter }
    },

    // D: same as C but removing only the support's collider
    sleepColliderRemoved(RAPIER)
    {
        const world = makeWorld(RAPIER)
        const a = box(RAPIER, world, 0, 0.5, 0)
        const b = box(RAPIER, world, 0, 1.5, 0)
        const tSleep = stepUntil(world, 15, () => a.body.isSleeping() && b.body.isSleeping())
        if(tSleep === null)
            return { pass: false, reason: 'stack never slept' }
        const yBefore = b.body.translation().y
        world.removeCollider(a.collider, true)
        stepUntil(world, 2, () => false)
        const yAfter = b.body.translation().y
        return { pass: yAfter < yBefore - 0.4, tSleep, yBefore, yAfter }
    },

    // E: B rests on a kinematic platform that moves away
    sleepKinematicMoved(RAPIER)
    {
        const world = makeWorld(RAPIER)
        const platform = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0))
        world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.25, 1), platform)
        const b = box(RAPIER, world, 0, 1.75, 0)
        const tSleep = stepUntil(world, 15, () => b.body.isSleeping())
        if(tSleep === null)
            return { pass: false, reason: 'never slept' }
        platform.setNextKinematicTranslation({ x: 0, y: 1, z: 20 })
        stepUntil(world, 2, () => false)
        return { pass: b.body.translation().y < 1.2, tSleep, yAfter: b.body.translation().y }
    },

    // F: a body thrown up must not fall asleep at the apex (velocity ~ 0) and must land
    sleepApex(RAPIER)
    {
        const world = makeWorld(RAPIER)
        const { body } = box(RAPIER, world, 0, 0.5, 0)
        body.setLinvel({ x: 0, y: 4, z: 0 }, true)
        let maxY = 0
        let sleptInAir = false
        stepUntil(world, 3, () => { maxY = Math.max(maxY, body.translation().y); if(body.isSleeping() && body.translation().y > 0.6) sleptInAir = true; return false })
        return { pass: !sleptInAir && maxY > 1.0 && Math.abs(body.translation().y - 0.5) < 0.05, maxY, sleptInAir, yEnd: body.translation().y }
    },

    // G: a sleeping cube is pushed by a kinematic body
    sleepKinematicPush(RAPIER)
    {
        const world = makeWorld(RAPIER)
        const a = box(RAPIER, world, 0, 0.5, 0)
        const tSleep = stepUntil(world, 15, () => a.body.isSleeping())
        if(tSleep === null)
            return { pass: false, reason: 'never slept' }
        const pusher = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-3, 0.5, 0))
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), pusher)
        for(let i = 0; i < 120; i++)
        {
            pusher.setNextKinematicTranslation({ x: -3 + i * 0.03, y: 0.5, z: 0 })
            world.step()
        }
        return { pass: a.body.translation().x > 0.5, tSleep, xAfter: a.body.translation().x, asleepNow: a.body.isSleeping() }
    },
}

export async function runPhysicsSmoke(RAPIER)
{
    const result = { version: typeof RAPIER.version === 'function' ? RAPIER.version() : 'unknown', pass: true, tests: {}, startedAt: performance.now() }
    for(const [ name, fn ] of Object.entries(tests))
    {
        try
        {
            result.tests[name] = fn(RAPIER)
        }
        catch(error)
        {
            result.tests[name] = { pass: false, error: String(error?.stack || error) }
        }
        if(!result.tests[name].pass)
            result.pass = false
    }
    result.ms = performance.now() - result.startedAt
    window.__physicsSmoke = result
    console.log('[physics-smoke]', JSON.stringify(result))
    return result
}
