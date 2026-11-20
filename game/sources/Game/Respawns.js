// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
// Change: respawns are defined in code (upstream read them from a GLB of reference empties).
import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

const DEFAULT_RESPAWNS = [
    { name: 'origin', x: 0, y: 4, z: 0, rotation: 0 },
]

export class Respawns
{
    constructor(defaultName = 'origin', definitions = DEFAULT_RESPAWNS)
    {
        this.game = Game.getInstance()
        this.defaultName = defaultName

        this.setItems(definitions)
    }

    setItems(definitions)
    {
        this.items = new Map()

        for(const definition of definitions)
        {
            this.items.set(definition.name, {
                name: definition.name,
                position: new THREE.Vector3(definition.x, definition.y, definition.z),
                rotation: definition.rotation
            })
        }
    }

    getByName(name)
    {
        return this.items.get(name)
    }

    getDefault()
    {
        return this.items.get(this.defaultName)
    }

    getClosest(position)
    {
        let closestItem = null
        let closestDistance = Infinity

        this.items.forEach((item) =>
        {
            const distance = Math.hypot(item.position.x - position.x, item.position.z - position.z)

            if(distance < closestDistance)
            {
                closestDistance = distance
                closestItem = item
            }
        })

        return closestItem
    }
}
