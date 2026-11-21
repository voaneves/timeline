import * as THREE from 'three/webgpu'
import { Game } from './Game.js'

let i = 0
export class Objects
{
    constructor()
    {
        this.game = Game.getInstance()
        this.list = new Map()
        this.key = 0
        this.pendingResets = []
        this.tempPosition = { x: 0, y: 0, z: 0 }
        this.tempRotation = { x: 0, y: 0, z: 0, w: 1 }

        // Render interpolation: the physics runs at a fixed 120 Hz, the display at 60/75/144 Hz. After every physics step
        // the pose of each moving body is captured (previous + current); every frame the visual is placed between them
        // with `ticker.alpha`. Visual only: the simulation (bodies, forces) is never touched, so determinism is unaffected.
        // The visual lags the physics by up to one step (8.3 ms). Code that follows a moving body per frame (camera, UI)
        // should read the visual's position, not `body.translation()`. Teleports (setTranslation) are smeared over one
        // step unless `snapInterpolation(object)` is called.
        this.game.ticker.events.on('fixedTick', () =>
        {
            this.capture()
        }, 4)

        this.game.ticker.events.on('fixedTick', () =>
        {
            this.fixedUpdate()
        }, 5)

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 4)
    }

    add(_visualDescription = null, _physicalDescription = null)
    {
        const object = {
            visual: null,
            physical: null,
            needsUpdate: false,
            reseting: false,
            managedReset: false,
        }

        /**
         * Visual
         */
        if(_visualDescription && _visualDescription.model)
        {
            // Default parameters
            const visualDescription = {
                updateMaterials: true,
                castShadow: true,
                receiveShadow: true,
                parent: this.game.scene,
                ..._visualDescription
            }
            
            // Visual
            const visual = {}
            visual.object3D = _visualDescription.model
            visual.parent = visualDescription.parent

            // Update materials
            if(visualDescription.updateMaterials)
                this.game.materials.updateObject(visualDescription.model)

            // Update shadows
            if(visualDescription.castShadow || visualDescription.receiveShadow)
            {
                visualDescription.model.traverse(_child =>
                {
                    if(_child.isMesh)
                    {
                        if(visualDescription.castShadow)
                            _child.castShadow = true

                        if(visualDescription.receiveShadow)
                            _child.receiveShadow = true
                    }
                })
            }

            // Add to scene
            if(visualDescription.parent !== null)
                visualDescription.parent.add(visual.object3D)

            // Save
            object.visual = visual
        }

        /**
         * Physical
         */
        if(_physicalDescription)
        {
            object.physical = this.game.physics.getPhysical(_physicalDescription)
        }

        /**
         * Save physical in visual and vis versa
         */
        if(object.physical)
        {
            object.physical.body.userData = { object: object }
        }
        if(object.visual)
        {
            object.visual.object3D.userData.object = object
        }

        /**
         * Save
         */
        this.key++
        this.list.set(this.key, object)

        // If sleeping, not enabled or fixed apply transform directly
        if(object.visual && object.physical)
        {
            if(_physicalDescription.sleeping || !_physicalDescription.enabled || object.physical.type === 'fixed')
            {
                object.visual.object3D.position.copy(object.physical.body.translation())
                object.visual.object3D.quaternion.copy(object.physical.body.rotation())
            }
        }

        return object
    }

    getFromModel(_model, _visualDescription = {}, _physicalDescription = {})
    {
        let name = _model.name
        
        const physical = !!name.match(/physical/i)
        const cleanUpRegexp = /physical|fixed|dynamic|kinematicPositionBased/gi

        const colliders = []

        if(physical)
        {
            // Define type
            if(typeof _physicalDescription.type === 'undefined')
            {
                _physicalDescription.type = 'fixed'

                if(_model.name.match(/dynamic/i))
                    _physicalDescription.type = 'dynamic'
                else if(_model.name.match(/kinematicPositionBased/i))
                    _physicalDescription.type = 'kinematicPositionBased'
            }

            // Restitution
            if(typeof _model.userData.restitution !== 'undefined')
                _physicalDescription.restitution = _model.userData.restitution

            // Friction
            if(typeof _model.userData.friction !== 'undefined')
                _physicalDescription.friction = _model.userData.friction

            // Category
            if(typeof _model.userData.category !== 'undefined')
                _physicalDescription.category = _model.userData.category

            // // Collision (removed, too expensive)
            // if(_physicalDescription.type === 'dynamic')
            // {
            //     _physicalDescription.onCollision = (force, position) =>
            //     {
            //         this.game.audio.groups.get('hitDefault').playRandomNext(force, position)
            //     }
            // }

            _model.name = name.replaceAll(cleanUpRegexp, '')

            // Colliders
            const children = [..._model.children]
            for(const _child of children)
            {
                const collider = {
                    position: _child.position,
                    quaternion: _child.quaternion,
                }
                if(_child.name.match(/^trimesh/i))
                {
                    collider.shape = 'trimesh'
                    collider.parameters = [ _child.geometry.attributes.position.array, _child.geometry.index.array ]
                }
                else if(_child.name.match(/^hull/i))
                {
                    collider.shape = 'hull'
                    collider.parameters = [ _child.geometry.attributes.position.array, _child.geometry.index.array ]
                }
                else if(_child.name.match(/^cuboid/i))
                {
                    collider.shape = 'cuboid'
                    collider.parameters = [ _child.scale.x * 0.5, _child.scale.y * 0.5, _child.scale.z * 0.5 ]
                }
                else if(_child.name.match(/^tube/i))
                {
                    collider.shape = 'cylinder'
                    collider.parameters = [ _child.scale.y * 0.5, _child.scale.x * 0.5 ]
                }
                else if(_child.name.match(/^ball/i))
                {
                    collider.shape = 'ball'
                    collider.parameters = [ _child.scale.y * 0.5 ]
                }

                if(typeof _child.userData.restitution !== 'undefined')
                    collider.restitution = _child.userData.restitution

                if(typeof _child.userData.friction !== 'undefined')
                    collider.friction = _child.userData.friction

                if(typeof _child.userData.category !== 'undefined')
                    collider.category = _child.userData.category

                // Collider found
                if(collider.shape)
                {
                    // Save
                    colliders.push(collider)

                    // Remove
                    _child.removeFromParent()
                }
            }
        }
        
        // Add
        return [
            { ..._visualDescription, model: _model },
            physical ? { ..._physicalDescription, colliders: colliders } : null
        ]
    }

    addFromModel(_model, _visualDescription = {}, _physicalDescription = {})
    {
        // Add
        return this.add(...this.getFromModel(_model, _visualDescription, _physicalDescription))
    }

    cancelPendingReset(object)
    {
        for(let i = this.pendingResets.length - 1; i >= 0; i--)
        {
            if(this.pendingResets[i].object === object)
                this.pendingResets.splice(i, 1)
        }
        object.reseting = false
    }

    resetObject(object)
    {
        if(
            !object.physical ||
            object.managedReset ||
            (object.physical.type !== 'dynamic' && object.physical.type !== 'kinematicPositionBased') ||
            object.reseting
        )
            return

        const isEnabled = object.physical.body.isEnabled()
        if(!isEnabled)
            return

        object.reseting = true
        this.snapInterpolation(object)

        object.physical.body.setEnabled(false)
        object.physical.body.setTranslation(object.physical.initialState.position, false)
        object.physical.body.setRotation(object.physical.initialState.rotation, false)
        object.physical.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
        object.physical.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
        object.physical.body.resetForces()
        object.physical.body.resetTorques()

        // Reactivate deterministically after 1 fixed step
        this.pendingResets.push({
            object,
            isEnabled,
            stepsLeft: 1,
        })
        
        if(object.visual)
        {
            if(object.visual.parent && object.visual.parent !== object.visual.object3D.parent)
                object.visual.parent.add(object.visual.object3D)
            object.visual.object3D.position.copy(object.physical.initialState.position)
            object.visual.object3D.quaternion.copy(object.physical.initialState.rotation)
        }
    }

    resetAll()
    {
        this.list.forEach((object) =>
        {
            this.resetObject(object)
        })
    }

    disable(object)
    {
        if(object.physical)
        {
            object.physical.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
            object.physical.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
            object.physical.body.resetForces()
            object.physical.body.resetTorques()
            object.physical.body.setEnabled(false)
        }

        if(object.visual)
            object.visual.object3D.removeFromParent()
    }

    enable(object)
    {
        if(object.physical)
            object.physical.body.setEnabled(true)

        if(object.visual && object.visual.parent !== object.visual.object3D.parent)
            object.visual.parent.add(object.visual.object3D)
    }

    // Next captured pose becomes both previous and current (no interpolation across a teleport)
    snapInterpolation(object)
    {
        if(object.interpolation)
        {
            object.interpolation.valid = false
            object.interpolation.settled = false
            object.interpolation.snapped = false
        }
    }

    // After the physics step (fixedTick order 3): previous <- current, current <- body
    capture()
    {
        this.list.forEach((_object) =>
        {
            if(!_object.visual || !_object.physical || _object.physical.type === 'fixed')
                return

            const body = _object.physical.body
            if(!body.isEnabled())
                return

            let interpolation = _object.interpolation
            if(!interpolation)
            {
                interpolation = _object.interpolation = {
                    valid: false,
                    settled: false, // asleep and `current` is its final pose
                    snapped: false, // visual already written with that final pose
                    previousPosition: new THREE.Vector3(),
                    currentPosition: new THREE.Vector3(),
                    previousQuaternion: new THREE.Quaternion(),
                    currentQuaternion: new THREE.Quaternion(),
                }
            }

            const sleeping = body.isSleeping()
            if(sleeping && interpolation.settled)
                return

            if(interpolation.valid)
            {
                interpolation.previousPosition.copy(interpolation.currentPosition)
                interpolation.previousQuaternion.copy(interpolation.currentQuaternion)
            }
            interpolation.currentPosition.copy(body.translation(this.tempPosition))
            interpolation.currentQuaternion.copy(body.rotation(this.tempRotation))
            if(!interpolation.valid)
            {
                interpolation.previousPosition.copy(interpolation.currentPosition)
                interpolation.previousQuaternion.copy(interpolation.currentQuaternion)
                interpolation.valid = true
            }

            if(sleeping)
            {
                interpolation.previousPosition.copy(interpolation.currentPosition)
                interpolation.previousQuaternion.copy(interpolation.currentQuaternion)
                interpolation.settled = true
                interpolation.snapped = false
            }
            else
            {
                interpolation.settled = false
            }
        })
    }

    // Deterministic physics housekeeping on fixedTick (order 5, after capture at order 4)
    fixedUpdate()
    {
        for(let i = this.pendingResets.length - 1; i >= 0; i--)
        {
            const entry = this.pendingResets[i]
            entry.stepsLeft--
            if(entry.stepsLeft <= 0)
            {
                const { object, isEnabled } = entry
                this.pendingResets.splice(i, 1)
                object.physical.body.setEnabled(isEnabled)

                if(object.physical.initialState.sleeping)
                    object.physical.body.sleep()

                object.reseting = false
                object.needsUpdate = true
                this.snapInterpolation(object)
            }
        }

        this.list.forEach((_object) =>
        {
            if(!_object.physical || _object.managedReset || _object.reseting)
                return

            const body = _object.physical.body
            if(!body.isEnabled())
                return

            const position = body.translation(this.tempPosition)
            if(position.y < this.game.water.depthElevation)
                this.resetObject(_object)
        })
    }

    update()
    {
        this.list.forEach((_object) =>
        {
            // Apply physical to visual (visual only: no physics mutations in per-frame tick)
            if(_object.visual && _object.physical)
            {
                const interpolation = _object.interpolation
                const body = _object.physical.body
                const position = body.translation(this.tempPosition)

                if(_object.needsUpdate)
                {
                    // Exact pose (after a reset)
                    _object.needsUpdate = false
                    _object.visual.object3D.position.copy(position)
                    _object.visual.object3D.quaternion.copy(body.rotation(this.tempRotation))
                }
                else if(body.isEnabled())
                {
                    if(!body.isSleeping())
                    {
                        if(interpolation && interpolation.valid)
                        {
                            // Between the last two physics steps
                            const alpha = this.game.ticker.alpha
                            _object.visual.object3D.position.lerpVectors(interpolation.previousPosition, interpolation.currentPosition, alpha)
                            _object.visual.object3D.quaternion.slerpQuaternions(interpolation.previousQuaternion, interpolation.currentQuaternion, alpha)
                            interpolation.snapped = false
                        }
                        else
                        {
                            _object.visual.object3D.position.copy(position)
                            _object.visual.object3D.quaternion.copy(body.rotation(this.tempRotation))
                        }
                    }
                    else if(interpolation && interpolation.settled && !interpolation.snapped)
                    {
                        // Asleep: land exactly on the final pose once, then leave the visual alone
                        _object.visual.object3D.position.copy(interpolation.currentPosition)
                        _object.visual.object3D.quaternion.copy(interpolation.currentQuaternion)
                        interpolation.snapped = true
                    }
                }
            }
        })
    }
}
