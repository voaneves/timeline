import { Game } from '../Game.js'
import { Debug } from '../Debug.js'
import * as THREE from 'three/webgpu'

export class PhysicsWireframe
{
    constructor()
    {
        this.game = Game.getInstance()

        // On from the start with `?wireframe` or `?debug=physics` (works in the production build too, no panel needed);
        // otherwise toggled from the Tweakpane panel (Physics > Wireframe > debug)
        this.active = Debug.getParam('wireframe') !== null || Debug.getParam('debug') === 'physics'

        this.geometry = new THREE.BufferGeometry()
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
        this.geometry.setAttribute('color', new THREE.Float32BufferAttribute([], 4))

        this.material = new THREE.LineBasicNodeMaterial({ vertexColors: true })

        this.lineSegments = new THREE.LineSegments(this.geometry, this.material)
        this.lineSegments.frustumCulled = false // the geometry is rebuilt every frame, a cached bounding sphere would be stale

        if(this.active)
            this.game.scene.add(this.lineSegments)

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 4)

        if(this.game.debug.active)
        {
            this.debugPanel = this.game.physics.debugPanel.addFolder({
                title: 'Wireframe',
                expanded: true,
            })
            
            this.debugPanel.addBinding(this, 'active', { label: 'debug' }).on('change', () =>
            {
                if(this.active)
                    this.game.scene.add(this.lineSegments)
                else
                    this.game.scene.remove(this.lineSegments)
            })
        }
    }
    
    update()
    {
        if(!this.active)
            return

        const { vertices, colors } = this.game.physics.world.debugRender()

        // A WebGPU vertex buffer cannot be resized: when the segment count changes, replace the attributes (debug only)
        if(this.geometry.attributes.position.array.length !== vertices.length)
        {
            this.geometry.attributes.position.dispose?.()
            this.geometry.attributes.color.dispose?.()
            this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
            this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))
            return
        }

        this.geometry.attributes.position.array.set(vertices)
        this.geometry.attributes.position.needsUpdate = true

        this.geometry.attributes.color.array.set(colors)
        this.geometry.attributes.color.needsUpdate = true
    }
}