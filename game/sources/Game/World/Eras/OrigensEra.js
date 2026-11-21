import * as THREE from 'three/webgpu'
import { texture } from 'three/tsl'
import { Game } from '../../Game.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'
import { Grass } from '../Grass.js'
import { WaterSurface } from '../WaterSurface.js'

const ORIGENS_BOUNDS = {
    minX: -37.3,
    maxX: 37.3,
    minZ: -49.0,
    maxZ: 24.0,
}

/**
 * Era 1 ("Origens" — Araguaína/TO) runtime world loader.
 * Loads visual, physical, dynamic objects, references, terrain mask, baked shadow, and palette.
 */
export class OrigensEra
{
    constructor(world)
    {
        this.game = Game.getInstance()
        this.world = world
        this.landmarkMeshes = new Map()
        this.dynamicObjects = []
        this.parsedReferences = {
            cameras: [],
            milestones: [],
            signals: [],
            navNodes: [],
            linePoints: [],
        }
        this.grass = null
        this.waterSurface = null
    }

    async load()
    {
        this.world.breakables = []
        this.world.initialBreakables = []

        const resources = await this.game.resourcesLoader.load([
            [ 'origensVisual', 'eras/origens/origensVisual.glb', 'gltf' ],
            [ 'origensPhysical', 'eras/origens/origensPhysical.glb', 'gltf' ],
            [ 'origensObjects', 'eras/origens/origensObjects.glb', 'gltf' ],
            [ 'origensReferences', 'eras/origens/origensReferences.glb', 'gltf' ],
            [ 'origensTerrain', 'eras/origens/origens_terrain.png', 'texture' ],
            [ 'palette', 'palette.png', 'texture' ],
        ])

        this.applyPaletteMaterial(resources.palette)
        this.parseReferences(resources.origensReferences.scene)
        this.setRespawn()

        let waterMesh = null
        let foliageMesh = null

        for(const node of [ ...resources.origensVisual.scene.children ])
        {
            this.game.objects.add({ model: node })
            if(node.name === 'OrigensWaterBase')
                waterMesh = node
            else if(node.name === 'OrigensFoliageStatic')
                foliageMesh = node
        }

        for(const node of [ ...resources.origensPhysical.scene.children ])
        {
            if(/physical/i.test(node.name))
                this.world.addPhysicalNode(node, { parent: null, updateMaterials: false, castShadow: false, receiveShadow: false })
        }

        for(const node of [ ...resources.origensObjects.scene.children ])
        {
            if(/physical/i.test(node.name))
            {
                const obj = this.world.addPhysicalNode(node)
                this.dynamicObjects.push(obj)
            }
            else
            {
                const obj = this.game.objects.add({ model: node })
                this.landmarkMeshes.set(node.name, obj)
            }
        }

        await this.world.loadEraBakedShadow('eras/origens/origens_shadow')

        this.waterSurface = new WaterSurface({ waterMesh, foliageMesh })
        this.grass = new Grass({
            terrainTexture: resources.origensTerrain,
            bounds: this.world.bakedShadowMeta || ORIGENS_BOUNDS,
        })
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
}
