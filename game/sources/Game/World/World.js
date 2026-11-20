// Minimal world for the empty engine (plan T0.6): a ground slab and one dynamic cube.
// Upstream's World loaded 28 modules (areas, vehicle, trees, weather...), all removed.
import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'

export class World
{
    constructor()
    {
        this.game = Game.getInstance()

        this.setGround()
        this.setCube()
        this.setDemoControls()
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
}
