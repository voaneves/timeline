import * as THREE from 'three/webgpu'
import { texture } from 'three/tsl'
import { Game } from '../../Game.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'
import { AmbientLife } from '../AmbientLife.js'
import { Breakables } from '../Breakables.js'
import { Grass } from '../Grass.js'
import { Line } from '../Line.js'
import { Tracks } from '../Tracks.js'
import { WaterSurface } from '../WaterSurface.js'
import { OrigensGameplay } from './OrigensGameplay.js'
import { OrigensSetPieces } from './OrigensSetPieces.js'

const ORIGENS_BOUNDS = {
    minX: -37.3,
    maxX: 37.3,
    minZ: -49.0,
    maxZ: 24.0,
}

const ORIGENS_CACHE_KEYS = [
    'eras/origens/origensVisual.glb',
    'eras/origens/origensPhysical.glb',
    'eras/origens/origensObjects.glb',
    'eras/origens/origensReferences.glb',
    'eras/origens/origens_terrain.png',
]

/**
 * Era 1 ("Origens" — Araguaína/TO) runtime world loader.
 * Loads visual, physical, dynamic objects, references, terrain mask, baked shadow,
 * Line spline, set pieces, gameplay, breakables, tracks, and ambient life.
 */
export class OrigensEra
{
    constructor(world)
    {
        this.game = Game.getInstance()
        this.world = world
        this.landmarkMeshes = new Map()
        this.dynamicObjects = []
        this.ownedObjects = []
        this.ownedReferenceKeys = []
        this.parsedReferences = {
            cameras: [],
            milestones: [],
            signals: [],
            navNodes: [],
            linePoints: [],
        }

        this.line = null
        this.setPieces = null
        this.gameplay = null
        this.breakables = null
        this.tracks = null
        this.ambientLife = null
        this.grass = null
        this.waterSurface = null
        this.paletteMaterial = null
        this.paletteTexture = null
        this.terrainTexture = null

        this._ownedListeners = []
        this._disposed = false
    }

    /**
     * Temporarily intercepts `on()` on ticker and quality emitters while constructing
     * era sub-modules so every registered listener can be cleanly removed in `dispose()`.
     */
    _captureListenersSync(fn)
    {
        const emitters = [ this.game?.ticker?.events, this.game?.quality?.events ].filter(Boolean)
        const originals = emitters.map((e) => e.on)
        const owned = this._ownedListeners

        for(let i = 0; i < emitters.length; i++)
        {
            const emitter = emitters[i]
            const origOn = originals[i]
            emitter.on = function(name, callback, order)
            {
                owned.push({ emitter, name, callback })
                return origOn.call(this, name, callback, order)
            }
        }

        try
        {
            return fn()
        }
        finally
        {
            for(let i = 0; i < emitters.length; i++)
                emitters[i].on = originals[i]
        }
    }

    async load()
    {
        this._disposed = false
        this.world.breakables = this.world.breakables || []
        this.world.initialBreakables = this.world.initialBreakables || []

        const resources = await this.game.resourcesLoader.load([
            [ 'origensVisual', 'eras/origens/origensVisual.glb', 'gltf' ],
            [ 'origensPhysical', 'eras/origens/origensPhysical.glb', 'gltf' ],
            [ 'origensObjects', 'eras/origens/origensObjects.glb', 'gltf' ],
            [ 'origensReferences', 'eras/origens/origensReferences.glb', 'gltf' ],
            [ 'origensTerrain', 'eras/origens/origens_terrain.png', 'texture' ],
            [ 'palette', 'palette.png', 'texture' ],
        ])

        this.terrainTexture = resources.origensTerrain
        this.paletteTexture = resources.palette
        this.applyPaletteMaterial(resources.palette)
        this.parseReferences(resources.origensReferences.scene)
        this.setRespawn()

        let waterMesh = null
        let foliageMesh = null

        for(const node of [ ...resources.origensVisual.scene.children ])
        {
            const obj = this.game.objects.add({ model: node })
            this.ownedObjects.push(obj)
            if(node.name === 'OrigensWaterBase')
                waterMesh = node
            else if(node.name === 'OrigensFoliageStatic')
                foliageMesh = node
        }

        for(const node of [ ...resources.origensPhysical.scene.children ])
        {
            if(/physical/i.test(node.name))
            {
                const obj = this.world.addPhysicalNode(node, {
                    parent: null,
                    updateMaterials: false,
                    castShadow: false,
                    receiveShadow: false,
                })
                this.ownedObjects.push(obj)
            }
        }

        for(const node of [ ...resources.origensObjects.scene.children ])
        {
            if(/physical/i.test(node.name))
            {
                const obj = this.world.addPhysicalNode(node)
                this.dynamicObjects.push(obj)
                this.ownedObjects.push(obj)
            }
            else
            {
                const obj = this.game.objects.add({ model: node })
                this.landmarkMeshes.set(node.name, obj)
                this.ownedObjects.push(obj)
            }
        }

        await this.world.loadEraBakedShadow('eras/origens/origens_shadow')

        // Line spline ("a Linha")
        this.line = new Line({ game: this.game, url: null })
        await this.line.load('eras/origens/origens_line_spline.json')
        this.world.line = this.line
        if(this.game.world)
            this.game.world.line = this.line

        // Sub-modules (listeners captured for deterministic disposal)
        this._captureListenersSync(() =>
        {
            this.waterSurface = new WaterSurface({
                waterMesh,
                foliageMesh,
                terrainTexture: resources.origensTerrain,
                bounds: this.world.bakedShadowMeta || ORIGENS_BOUNDS,
                qualityTier: this.game.quality?.tier || 'Q0',
            })
            this.grass = new Grass({
                terrainTexture: resources.origensTerrain,
                bounds: this.world.bakedShadowMeta || ORIGENS_BOUNDS,
            })
            this.breakables = new Breakables(this.world)
            this.breakables.scan(this.dynamicObjects)
            this.tracks = new Tracks()
            this.ambientLife = new AmbientLife(this.world)
            this.setPieces = new OrigensSetPieces(this)
            this.setPieces._eraPlayerBound = Boolean(this.world?.player)
            this.gameplay = new OrigensGameplay(this)
        })

        this._setupIslandPerimeterWalls()

        if(this.world?.player)
            this.attachPlayer(this.world.player)
    }

    _setupIslandPerimeterWalls()
    {
        this._perimeterPhysicals = []
        if(!this.game?.physics)
            return

        // Soft invisible containment around Origens island shoreline so Victor never falls into the ocean void
        const walls = [
            { x: -33.6, y: 2.0, z: -18.0, hx: 0.5, hy: 4.0, hz: 32.0 }, // West shore
            { x:  33.6, y: 2.0, z: -18.0, hx: 0.5, hy: 4.0, hz: 32.0 }, // East shore
            { x:   0.0, y: 2.0, z:   9.2, hx: 34.5, hy: 4.0, hz: 0.5 }, // South shore (Rio Tocantins bank)
            { x:   0.0, y: 2.0, z: -46.8, hx: 34.5, hy: 4.0, hz: 0.5 }, // North plateau rim
        ]
        for(const w of walls)
        {
            const phys = this.game.physics.getPhysical({
                type: 'fixed',
                position: { x: w.x, y: w.y, z: w.z },
                colliders: [
                    {
                        shape: 'cuboid',
                        parameters: [ w.hx, w.hy, w.hz ],
                        position: { x: 0, y: 0, z: 0 },
                    },
                ],
            })
            if(phys)
                this._perimeterPhysicals.push(phys)
        }
    }

    attachPlayer(player)
    {
        if(!player || this._disposed)
            return

        this.gameplay?.attachPlayer?.(player)
        this.breakables?.attachController?.(player.controller)
        this.tracks?.attachController?.(player.controller)

        if(this.setPieces && !this.setPieces._eraPlayerBound)
        {
            this.setPieces._eraPlayerBound = true
            if(player.controller?.events)
            {
                const onBump = (info) => this.setPieces?.onPlayerBump(info)
                const onStamp = (info) => this.setPieces?.onPlayerStamp(info)
                player.controller.events.on('bump', onBump)
                player.controller.events.on('stamp', onStamp)
                this._ownedListeners.push(
                    { emitter: player.controller.events, name: 'bump', callback: onBump },
                    { emitter: player.controller.events, name: 'stamp', callback: onStamp }
                )
            }
            if(player.events)
            {
                const onInteract = () => this.setPieces?.onPlayerInteract()
                player.events.on('interact', onInteract)
                this._ownedListeners.push({ emitter: player.events, name: 'interact', callback: onInteract })
            }
        }
    }

    applyPaletteMaterial(paletteTex)
    {
        paletteTex.colorSpace = THREE.SRGBColorSpace
        paletteTex.minFilter = THREE.NearestFilter
        paletteTex.magFilter = THREE.NearestFilter
        paletteTex.generateMipmaps = false
        paletteTex.flipY = false
        paletteTex.needsUpdate = true

        this.game.materials.paletteTexture = paletteTex

        const paletteMaterial = new MeshDefaultMaterial({
            colorNode: texture(paletteTex).rgb,
            hasCoreShadows: true,
            hasDropShadows: true,
            hasLightBounce: true,
            hasVertexAo: true,
            hasWater: false,
            hasFog: true,
            hasReveal: true,
        })

        this.game.materials.save('palette', paletteMaterial)
        this.paletteMaterial = paletteMaterial
    }

    parseReferences(scene)
    {
        for(const node of scene.children)
        {
            if(!/^ref/i.test(node.name))
                continue

            const entry = {
                name: node.name,
                position: node.position.clone(),
                quaternion: node.quaternion.clone(),
                userData: { ...node.userData },
            }
            this.world.references.set(node.name, entry)
            this.ownedReferenceKeys.push(node.name)

            if(/^refCamera/i.test(node.name))
                this.parsedReferences.cameras.push(entry)
            else if(/^refMilestone/i.test(node.name))
                this.parsedReferences.milestones.push(entry)
            else if(/^refSignal\d{2}$/i.test(node.name))
                this.parsedReferences.signals.push(entry)
            else if(/^refNav\d{2}$/i.test(node.name))
                this.parsedReferences.navNodes.push(entry)
            else if(/^refLinePoint\d{2}$/i.test(node.name))
                this.parsedReferences.linePoints.push(entry)
        }
    }

    setRespawn()
    {
        const reference = this.world.references.get('refRespawnOrigens') || this.world.references.get('refRespawn')
        if(!reference)
            return

        const yaw = new THREE.Euler().setFromQuaternion(reference.quaternion, 'YXZ').y
        this.game.respawns.setItems([
            { name: 'origens', x: reference.position.x, y: reference.position.y, z: reference.position.z, rotation: yaw },
        ])
        this.game.respawns.defaultName = 'origens'

        const focusPoint = this.game.view.focusPoint
        focusPoint.trackedPosition.set(reference.position.x, 0, reference.position.z)
        focusPoint.position.copy(focusPoint.trackedPosition)
        focusPoint.smoothedPosition.copy(focusPoint.trackedPosition)
    }

    _disposeObject3DResources(root)
    {
        if(!root)
            return

        const sharedTextures = new Set([ this.paletteTexture, this.game?.materials?.paletteTexture ].filter(Boolean))
        const disposedMaterials = new Set()

        root.traverse((child) =>
        {
            if(child.geometry)
                child.geometry.dispose()

            const mats = Array.isArray(child.material) ? child.material : [ child.material ]
            for(const mat of mats)
            {
                if(!mat || disposedMaterials.has(mat))
                    continue
                disposedMaterials.add(mat)

                for(const val of Object.values(mat))
                {
                    if(val && val.isTexture && !sharedTextures.has(val))
                        val.dispose()
                }
                mat.dispose?.()
            }
        })
    }

    dispose()
    {
        if(this._disposed)
            return
        this._disposed = true

        // 1. Remove all captured ticker/quality/player listeners
        for(const { emitter, name, callback } of this._ownedListeners)
            emitter?.off?.(name, callback)
        this._ownedListeners = []

        // 2. Dispose sub-modules
        this.setPieces?.dispose?.()
        this.setPieces = null

        this.gameplay?.dispose?.()
        this.gameplay = null

        this.breakables?.dispose?.()
        this.breakables = null

        this.tracks?.dispose?.()
        this.tracks = null

        this.ambientLife?.dispose?.()
        this.ambientLife = null

        this.grass?.dispose?.()
        this.grass = null

        this.waterSurface = null

        // 3. Dispose Line spline & its Rapier sensor body
        if(this.line)
        {
            this.line.dispose?.()
            if(this.world?.line === this.line)
                this.world.line = null
            if(this.game.world?.line === this.line)
                this.game.world.line = null
            this.line = null
        }

        // 4. Remove all owned objects from Objects, Physics, Scene and dispose GPU resources
        const ownedSet = new Set(this.ownedObjects)
        if(this.game?.objects?.list)
        {
            for(const [ key, obj ] of this.game.objects.list.entries())
            {
                if(ownedSet.has(obj))
                    this.game.objects.list.delete(key)
            }
        }

        const ownedPhysicals = new Set(this._perimeterPhysicals || [])
        const physicsWorld = this.game?.physics?.world

        for(const phys of (this._perimeterPhysicals || []))
        {
            if(phys?.body)
            {
                phys.body.userData = null
                physicsWorld?.removeRigidBody(phys.body)
            }
        }
        this._perimeterPhysicals = []

        for(const obj of this.ownedObjects)
        {
            this.game?.objects?.cancelPendingReset?.(obj)

            if(obj.physical)
            {
                ownedPhysicals.add(obj.physical)
                if(obj.physical.body)
                {
                    obj.physical.body.userData = null
                    physicsWorld?.removeRigidBody(obj.physical.body)
                }
            }

            if(obj.visual?.object3D)
            {
                obj.visual.object3D.removeFromParent()
                this._disposeObject3DResources(obj.visual.object3D)
            }
        }

        if(this.game?.physics?.physicals && ownedPhysicals.size > 0)
            this.game.physics.physicals = this.game.physics.physicals.filter((p) => !ownedPhysicals.has(p))

        if(Array.isArray(this.world?.breakables))
            this.world.breakables = this.world.breakables.filter((b) => !ownedSet.has(b))
        if(Array.isArray(this.world?.initialBreakables))
            this.world.initialBreakables = this.world.initialBreakables.filter((b) => !ownedSet.has(b))

        this.ownedObjects = []
        this.dynamicObjects = []
        this.landmarkMeshes.clear()
        this.parsedReferences = { cameras: [], milestones: [], signals: [], navNodes: [], linePoints: [] }

        // 5. Dispose era textures & materials
        if(this.terrainTexture)
        {
            this.terrainTexture.dispose()
            this.terrainTexture = null
        }

        if(this.paletteMaterial)
        {
            this.paletteMaterial.dispose()
            this.paletteMaterial = null
            this.game?.materials?.list?.delete?.('palette')
        }

        if(this.world?.bakedShadowTexture)
        {
            this.world.bakedShadowTexture.dispose()
            this.world.bakedShadowTexture = null
            this.world.bakedShadowMeta = null
            MeshDefaultMaterial.clearBakedShadow()
        }

        // 6. Remove era references and purge era GLTF/terrain from ResourcesLoader cache
        for(const key of this.ownedReferenceKeys)
            this.world?.references?.delete(key)
        this.ownedReferenceKeys = []

        const cache = this.game?.resourcesLoader?.cache
        if(cache)
        {
            for(const key of ORIGENS_CACHE_KEYS)
                cache.delete(key)
        }
    }
}
