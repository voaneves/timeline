// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
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
}
