// Minimal world. Upstream's World loaded 28 modules (areas, vehicle, trees, weather...), all removed.
// Default: the greybox test level (plan T1.1), loaded from the asset manifest (`eras/greybox/greybox.glb`).
// `?demo`: the empty-engine demo (T0.6): a ground slab and one dynamic cube pushed by the arrow keys (used by the ghost tests).
import * as THREE from 'three/webgpu'
import { Debug } from '../Debug.js'
import { Game } from '../Game.js'
import { Player } from '../Character/Player.js'
import { AutoWalk } from '../Character/AutoWalk.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'
import { resolveAsset } from '../assetManifest.js'
import { MovingPlatform } from './MovingPlatform.js'
import { EraCycles } from '../Cycles/EraCycles.js'
import { ZoneStreamer } from './ZoneStreamer.js'

// Name of a glTF root node -> how the engine reads it (docs/PLAN-3D.md 5.3, Objects.getFromModel):
//   `...Physical<Fixed|Dynamic|KinematicPositionBased>`  one rigid body; children cuboid*/tube*/hull*/trimesh*/ball* are its colliders
//   `ref<Name><n>`                                        reference point (position + rotation + userData), no visual
//   anything else                                         visual only
export class World
{
    constructor()
    {
        this.game = Game.getInstance()
        this.references = new Map()
        this.movingPlatforms = []

        if(__DEV_TOOLS__ && Debug.getParam('debug') === 'palette')
        {
            this.ready = import('./PaletteCalibration.js').then(({ PaletteCalibration }) =>
            {
                this.paletteCalibration = new PaletteCalibration()
                return this.paletteCalibration.ready
            })
        }
        else if(Debug.getParam('demo') !== null)
        {
            this.setGround()
            this.setCube()
            this.setDemoControls()
            this.ready = Promise.resolve()
        }
        else if((Debug.getParam('era') || '').trim().toLowerCase() === 'origens')
        {
            // Awaited by Game.init before `game.ready`
            this.ready = this.loadOrigens()
        }
        else
        {
            // Awaited by Game.init before `game.ready`
            this.ready = this.loadGreybox()
        }
    }

    async loadOrigens()
    {
        if(Debug.getParam('loco') === 'vehicle')
            this.vehicleModule = await import('../Physics/PhysicsVehicle.js')

        this.game.eraCycles = new EraCycles('origens')
        this.zoneStreamer = new ZoneStreamer(this)
        this.origensEra = await this.zoneStreamer.loadEra('origens')
        this.setPlayer()
        this.origensEra?.attachPlayer?.(this.player)
        this.autoWalk = new AutoWalk(this)
    }

    async loadGreybox()
    {
        this.breakables = []
        this.initialBreakables = []
        const resources = await this.game.resourcesLoader.load([ [ 'greybox', 'eras/greybox/greybox.glb', 'gltf' ] ])
        this.greybox = resources.greybox.scene

        // `?loco=vehicle`: fetch the lazy chunk BEFORE any physical exists, so no fixed step runs with live bodies during
        // the await (else the platform's step counter would depend on network timing and the ghost would drift)
        if(Debug.getParam('loco') === 'vehicle')
            this.vehicleModule = await import('../Physics/PhysicsVehicle.js')

        // Objects.add re-parents each node to the game scene, so iterate over a copy
        for(const node of [ ...this.greybox.children ])
        {
            if(/^ref/i.test(node.name))
            {
                this.references.set(node.name, {
                    position: node.position.clone(),
                    quaternion: node.quaternion.clone(),
                    userData: { ...node.userData },
                })
            }
            else if(/physical/i.test(node.name))
            {
                this.addPhysicalNode(node)
            }
            else
            {
                this.game.objects.add({ model: node })
            }
        }

        this.setRespawn()
        this.setMovingPlatform()
        this.setPlayer()
        await this.loadEraBakedShadow('eras/greybox/greybox_shadow')
    }

    async loadEraBakedShadow(baseLogicalPath)
    {
        MeshDefaultMaterial.clearBakedShadow()

        const shadowParam = (Debug.getParam('q1shadow') || '').trim().toLowerCase()
        if(shadowParam === 'realtime' || shadowParam === 'map' || shadowParam === '0' || shadowParam === 'off')
            return false

        // Only activate static top-down baked shadow on Q1+ (or when explicitly requested via ?q1shadow=baked)
        if(this.game.quality.level === 0 && shadowParam !== 'baked' && shadowParam !== 'static')
            return false

        const pngLogical = `${baseLogicalPath}.png`
        const metaLogical = `${baseLogicalPath}.json`

        try
        {
            const manifest = await this.game.resourcesLoader.getManifest()
            let pngUrl = null
            let metaUrl = null

            if(manifest?.assets?.[pngLogical] && manifest?.assets?.[metaLogical])
            {
                pngUrl = resolveAsset(manifest, pngLogical, document.baseURI)
                metaUrl = resolveAsset(manifest, metaLogical, document.baseURI)
            }
            else if(shadowParam === 'baked' || shadowParam === 'static')
            {
                // Fallback direct fetch from root/static if staged directly in dist root
                const shortBase = baseLogicalPath.split('/').pop()
                pngUrl = new URL(`${shortBase}.png`, document.baseURI).href
                metaUrl = new URL(`${shortBase}.json`, document.baseURI).href
            }
            else
            {
                return false
            }

            const metaResp = await fetch(metaUrl)
            if(!metaResp.ok)
                return false
            const meta = await metaResp.json()

            const texLoader = this.game.resourcesLoader.getLoader('texture')
            const shadowTex = await new Promise((resolve, reject) =>
            {
                texLoader.load(pngUrl, resolve, undefined, reject)
            })

            this.bakedShadowTexture = shadowTex
            this.bakedShadowMeta = meta
            MeshDefaultMaterial.setBakedShadow(shadowTex, meta)
            return true
        }
        catch
        {
            return false
        }
    }

    addPhysicalNode(node, visualDescription = {})
    {
        const dynamic = /dynamic/i.test(node.name)
        const kinematic = /kinematicPositionBased/i.test(node.name)

        // getFromModel reads type (from the node name), friction/restitution/category (from userData) and strips the collider children
        const physicalDescription = {
            position: node.position,
            rotation: node.quaternion,
        }
        if(typeof node.userData.mass !== 'undefined')
            physicalDescription.mass = node.userData.mass
        if(dynamic)
            physicalDescription.sleeping = true // wakes on first contact
        if(kinematic)
            physicalDescription.canSleep = false // driven by setNextKinematicTranslation

        const object = this.game.objects.addFromModel(node, visualDescription, physicalDescription)

        // Crates break under the stamp (T1.4): `breakables` is read by Character/Stamp.js
        if(/^crate\d/i.test(node.name))
        {
            this.breakables.push(object)
            this.initialBreakables.push(object)
        }

        if(kinematic)
            this.movingPlatform = { object, userData: { ...node.userData } }
        return object
    }

    // The default respawn comes from `refRespawn` (forward is -Z, yaw 0)
    setRespawn()
    {
        const reference = this.references.get('refRespawn')
        if(!reference)
            return

        const yaw = new THREE.Euler().setFromQuaternion(reference.quaternion, 'YXZ').y
        this.game.respawns.setItems([
            { name: 'greybox', x: reference.position.x, y: reference.position.y, z: reference.position.z, rotation: yaw },
        ])
        this.game.respawns.defaultName = 'greybox'

        // The camera was created on the placeholder respawn: re-aim it
        const focusPoint = this.game.view.focusPoint
        focusPoint.trackedPosition.set(reference.position.x, 0, reference.position.z)
        focusPoint.position.copy(focusPoint.trackedPosition)
        focusPoint.smoothedPosition.copy(focusPoint.trackedPosition)
    }

    // Kinematic platform shuttling between refPlatformPath1 and refPlatformPath2 (props `speed` m/s, `pause` s at each end).
    // Driven by the fixed-step counter (not wall clock), before Player and Physics (order 2 < 3), so ghosts replay it exactly.
    setMovingPlatform()
    {
        const a = this.references.get('refPlatformPath1')
        const b = this.references.get('refPlatformPath2')
        if(!this.movingPlatform || !a || !b)
            return

        const platform = new MovingPlatform({
            object: this.movingPlatform.object,
            start: a.position,
            end: b.position,
            speed: this.movingPlatform.userData.speed ?? 2,
            pause: this.movingPlatform.userData.pause ?? 0.5,
            userData: this.movingPlatform.userData,
        })
        this.movingPlatform = platform
        this.movingPlatforms.push(platform)
        this.platformPositionAt = (time) => platform.positionAt(time)
    }

    // The player (T1.2): kinematic capsule on the Rapier KCC, spawned at the default respawn. Created after the moving
    // platform so its fixed-step update (order 2) runs after the platform's (T1.5 reads the platform delta).
    setPlayer()
    {
        // `?loco=vehicle` (T1.10): the grey box cart instead of the on-foot player (lazy chunk, quarantined)
        if(Debug.getParam('loco') === 'vehicle')
        {
            this.vehicle = new this.vehicleModule.PhysicsVehicle()
            return
        }
        this.player = new Player()
    }

    setGround()
    {
        const size = 80
        const thickness = 1

        // `name` drives Materials.getFromName(): same name => same MeshDefaultMaterial
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(size, thickness, size),
            new THREE.MeshStandardMaterial({ name: 'ground', color: '#7fb069' })
        )

        this.ground = this.game.objects.add(
            { model: mesh },
            {
                type: 'fixed',
                position: { x: 0, y: - thickness / 2, z: 0 },
                friction: 0.7,
                colliders: [
                    { shape: 'cuboid', parameters: [ size / 2, thickness / 2, size / 2 ] },
                ],
            }
        )
    }

    setCube()
    {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ name: 'cube', color: '#e8734a' })
        )

        // Fixed tilt so the drop tumbles deterministically
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.3, 0.2))

        this.cube = this.game.objects.add(
            { model: mesh },
            {
                type: 'dynamic',
                position: { x: 0, y: 4, z: 0 },
                rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
                mass: 1,
                friction: 0.5,
                restitution: 0.3,
                colliders: [
                    { shape: 'cuboid', parameters: [ 0.5, 0.5, 0.5 ] },
                ],
            }
        )
    }

    // Demo gameplay for the ghost tests (T0.16): arrow keys / WASD push the cube, Space kicks it up with a seeded
    // random sideways nudge. Forces are applied on 'fixedTick' (before physics, order 3), never from event handlers.
    setDemoControls()
    {
        const direction = { demoLeft: [ - 1, 0 ], demoRight: [ 1, 0 ], demoForward: [ 0, - 1 ], demoBack: [ 0, 1 ] }
        this.game.inputs.addActions([
            { name: 'demoLeft', categories: [ 'wandering' ], keys: [ 'Keyboard.ArrowLeft', 'Keyboard.KeyA' ] },
            { name: 'demoRight', categories: [ 'wandering' ], keys: [ 'Keyboard.ArrowRight', 'Keyboard.KeyD' ] },
            { name: 'demoForward', categories: [ 'wandering' ], keys: [ 'Keyboard.ArrowUp', 'Keyboard.KeyW' ] },
            { name: 'demoBack', categories: [ 'wandering' ], keys: [ 'Keyboard.ArrowDown', 'Keyboard.KeyS' ] },
            { name: 'demoJump', categories: [ 'wandering' ], keys: [ 'Keyboard.Space' ] },
        ])

        let jumpPending = false
        this.game.inputs.events.on('demoJump', (action) =>
        {
            if(action.active)
                jumpPending = true
        })

        this.game.ticker.events.on('fixedTick', () =>
        {
            const body = this.cube.physical.body
            let x = 0
            let z = 0
            for(const name in direction)
            {
                if(this.game.inputs.actions.get(name).active)
                {
                    x += direction[name][0]
                    z += direction[name][1]
                }
            }

            if(x !== 0 || z !== 0)
                body.applyImpulse({ x: x * 0.03, y: 0, z: z * 0.03 }, true)

            if(jumpPending)
            {
                jumpPending = false
                body.applyImpulse({ x: (Math.random() - 0.5) * 0.6, y: 3, z: (Math.random() - 0.5) * 0.6 }, true)
            }
        }, 2)
    }

    reset()
    {
        if(this.initialBreakables)
        {
            this.breakables = []
            for(const crate of this.initialBreakables)
            {
                this.game.objects.cancelPendingReset(crate)
                const body = crate.physical.body
                const initial = crate.physical.initialState
                body.setEnabled(true)
                body.setTranslation(initial.position, false)
                body.setRotation(initial.rotation, false)
                body.setLinvel({ x: 0, y: 0, z: 0 }, false)
                body.setAngvel({ x: 0, y: 0, z: 0 }, false)
                body.resetForces()
                body.resetTorques()
                if(initial.sleeping)
                    body.sleep()
                if(crate.visual)
                {
                    if(crate.visual.parent && crate.visual.parent !== crate.visual.object3D.parent)
                        crate.visual.parent.add(crate.visual.object3D)
                    crate.visual.object3D.position.copy(initial.position)
                    crate.visual.object3D.quaternion.copy(initial.rotation)
                }
                crate.needsUpdate = true
                this.game.objects.snapInterpolation(crate)
                this.breakables.push(crate)
            }
        }

        for(const platform of this.movingPlatforms)
            platform.reset()

        if(this.player)
        {
            this.player.clearWalkTarget()
            this.player.controller.respawn()
        }

        if(this.vehicle)
            this.vehicle.reset()

        this.game.physics?.world?.propagateModifiedBodyPositionsToColliders()
    }
}
