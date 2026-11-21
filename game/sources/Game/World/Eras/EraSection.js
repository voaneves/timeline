import * as THREE from 'three/webgpu'
import { texture } from 'three/tsl'
import { Game } from '../../Game.js'
import { resolveAsset } from '../../assetManifest.js'
import { MeshDefaultMaterial } from '../../Materials/MeshDefaultMaterial.js'
import { Breakables } from '../Breakables.js'
import { Line } from '../Line.js'
import { MovingPlatform } from '../MovingPlatform.js'
import { Tracks } from '../Tracks.js'
import { WaterSurface } from '../WaterSurface.js'

const DEFAULT_BOUNDS = {
    minX: -37.3,
    maxX: 37.3,
    minZ: -49.0,
    maxZ: 24.0,
}

const SIGNAL_COLLECT_RADIUS = 1.25
const MILESTONE_INTERACT_RADIUS = 2.25
const SECRET_STAMP_RADIUS = 2.4
const PIPE_INTERACT_RADIUS = 2.25
const GATE_INTERACT_RADIUS = 2.6
const ENDDOT_TRIGGER_RADIUS = 3.2
const ENDDOT_RESET_RADIUS = 4.5

const PROJECT_ID_MAP = {
    'dtcg-contrast': 'p-dtcg-contrast',
    'xbox-sales': 'p-xbox-sales',
    'snake-arena': 'p-snake-arena',
    'meu-poupig': 'p-meupoupig',
    'js-games': 'p-js-games',
    'financial-sample-analysis': 'p-financial_sample_analysis',
}

const ENTRY_ID_MAP = {
    '2018-07': 'e-2018-07',
}

const ERA_CONFIGS = {
    unicamp: {
        name: 'unicamp',
        label: 'UNICAMP (2012–2014)',
        respawnRef: 'refRespawnUnicamp',
        waterMeshName: 'UnicampWaterBase',
        foliageMeshName: 'UnicampFoliageStatic',
        secretRef: 'refSecretLab',
        secretHatchName: 'UnicampSecretLabHatch',
        exitGates: [ { ref: 'refBusStopUnicamp', targetEra: 'industria' } ],
        setPiece: 'unicamp',
    },
    industria: {
        name: 'industria',
        label: 'Indústria (2017–2019)',
        respawnRef: 'refRespawnIndustria',
        waterMeshName: 'IndustriaCanalWater.001',
        foliageMeshName: null,
        secretRef: 'refSecretVault',
        secretHatchName: 'IndustriaSecretVaultHatch',
        exitGates: [ { ref: 'refAirshipDock', targetEra: 'alemanha' } ],
        setPiece: 'industria',
    },
    alemanha: {
        name: 'alemanha',
        label: 'Alemanha (2018)',
        respawnRef: 'refRespawnAlemanha',
        waterMeshName: 'AlemanhaWaterBase',
        foliageMeshName: 'AlemanhaFoliageStatic',
        secretRef: null,
        secretHatchName: null,
        exitGates: [ { ref: 'refAirshipReturn', targetEra: 'industria' } ],
        setPiece: 'alemanha',
    },
    dados: {
        name: 'dados',
        label: 'Dados (2019–2021)',
        respawnRef: 'refRespawnDados',
        waterMeshName: 'DadosTocantinsWater.001',
        foliageMeshName: null,
        secretRef: 'refSecretMatrix',
        secretHatchName: 'DadosSecretMatrixHatch',
        exitGates: [],
        setPiece: 'dados',
    },
    transformacao: {
        name: 'transformacao',
        label: 'Transformação Digital (2022–hoje)',
        respawnRef: 'refRespawnTransformacao',
        waterMeshName: 'TransformacaoWaterBase',
        foliageMeshName: 'TransformacaoFoliageStatic',
        secretRef: 'refSecretBackstage',
        secretHatchName: 'BackstageTrapdoorHatch',
        exitGates: [],
        setPiece: 'transformacao',
    },
    hub: {
        name: 'hub',
        label: 'Ponto Final — Hub',
        respawnRef: 'refRespawnHub',
        waterMeshName: 'HubWaterBase',
        foliageMeshName: 'HubFoliageStatic',
        secretRef: 'refBackstage',
        secretHatchName: null,
        exitGates: [],
        setPiece: 'hub',
    },
}

const STAMP_STYLE_ID = 'vn-enddot-stamp-style'

function ensureStampStyles()
{
    if(typeof document === 'undefined' || document.getElementById(STAMP_STYLE_ID))
        return

    const style = document.createElement('style')
    style.id = STAMP_STYLE_ID
    style.textContent = `
        .vn-enddot-stamp {
            position: fixed;
            inset: 0;
            z-index: 60;
            display: grid;
            place-items: center;
            background: rgba(246, 241, 231, 0.94);
            color: #0a0a0a;
            opacity: 0;
            pointer-events: none;
            transition: opacity 280ms ease-out;
        }
        .vn-enddot-stamp.is-visible {
            opacity: 1;
        }
        .is-reduced-motion .vn-enddot-stamp {
            transition: none;
        }
        .vn-enddot-seal {
            width: min(260px, 68vw);
            aspect-ratio: 1;
            border-radius: 50%;
            border: 6px solid #f50000;
            outline: 3px solid #0a0a0a;
            outline-offset: -12px;
            display: grid;
            place-items: center;
            text-align: center;
            padding: 24px;
            background: #f6f1e7;
            transform: rotate(-8deg);
            box-shadow: 0 10px 32px rgba(10, 10, 10, 0.14);
        }
        .vn-enddot-seal-kicker {
            display: block;
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: #f50000;
        }
        .vn-enddot-seal-title {
            display: block;
            margin-top: 6px;
            font-size: 1.55rem;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: #0a0a0a;
        }
    `
    document.head.appendChild(style)
}

function normalizeEntryId(rawId)
{
    if(!rawId)
        return ''
    return ENTRY_ID_MAP[rawId] || rawId
}

function normalizeProjectId(rawId)
{
    if(!rawId)
        return ''
    return PROJECT_ID_MAP[rawId] || rawId
}

/**
 * Shared data-driven runtime loader for Eras 2–6 + Hub:
 * `unicamp`, `industria`, `alemanha`, `dados`, `transformacao`, `hub`.
 */
export class EraSection
{
    constructor(world, eraName)
    {
        const key = String(eraName || '').trim().toLowerCase()
        if(!Object.hasOwn(ERA_CONFIGS, key))
            throw new Error(`Unknown EraSection config: ${eraName}`)

        this.game = Game.getInstance()
        this.world = world
        this.eraName = key
        this.config = ERA_CONFIGS[key]

        this.landmarkMeshes = new Map()
        this.dynamicObjects = []
        this.ownedObjects = []
        this.ownedReferenceKeys = []
        this.ownedPlatforms = []
        this._ownedTextures = []
        this._ownedListeners = []
        this._ownedDom = []
        this._timers = []

        this.parsedReferences = {
            cameras: [],
            milestones: [],
            signals: [],
            navNodes: [],
            linePoints: [],
        }

        this.line = null
        this.breakables = null
        this.tracks = null
        this.waterSurface = null
        this.terrainTexture = null
        this.paletteTexture = null
        this.signalsMesh = null
        this.signals = []
        this.collectedSignalCount = 0
        this.milestones = []
        this.secretOpened = false
        this.endDotTriggered = false

        // Era-specific runtime state
        this.nanotubePillars = []
        this.ongGlowMeshes = []
        this.ongGlowing = false
        this.liveBars = []
        this.scatterNodes = []
        this.regressionLine = null
        this.regressionLit = false
        this.projectScreens = []
        this.cartridges = []
        this.creditsDialog = null
        this.stampOverlay = null

        this._visualTime = 0
        this._dummy = new THREE.Object3D()
        this._tempVec = new THREE.Vector3()
        this._disposed = false
    }

    _cacheKeys()
    {
        const e = this.eraName
        return [
            `eras/${e}/${e}Visual.glb`,
            `eras/${e}/${e}Physical.glb`,
            `eras/${e}/${e}Objects.glb`,
            `eras/${e}/${e}References.glb`,
            `eras/${e}/${e}_terrain.png`,
        ]
    }

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

        const e = this.eraName
        const resources = await this.game.resourcesLoader.load([
            [ 'visual', `eras/${e}/${e}Visual.glb`, 'gltf' ],
            [ 'physical', `eras/${e}/${e}Physical.glb`, 'gltf' ],
            [ 'objects', `eras/${e}/${e}Objects.glb`, 'gltf' ],
            [ 'references', `eras/${e}/${e}References.glb`, 'gltf' ],
            [ 'terrain', `eras/${e}/${e}_terrain.png`, 'texture' ],
            [ 'palette', 'palette.png', 'texture' ],
        ])

        if(this._disposed)
            return

        this.terrainTexture = resources.terrain
        this.paletteTexture = resources.palette
        this._ensurePaletteMaterial(resources.palette)
        this._parseReferences(resources.references.scene)
        this.setRespawn()

        let waterMesh = null
        let foliageMesh = null

        for(const node of [ ...resources.visual.scene.children ])
        {
            const obj = this.game.objects.add({ model: node })
            this.ownedObjects.push(obj)
            if(this.config.waterMeshName && node.name === this.config.waterMeshName)
                waterMesh = node
            if(this.config.foliageMeshName && node.name === this.config.foliageMeshName)
                foliageMesh = node
        }

        for(const node of [ ...resources.physical.scene.children ])
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

        for(const node of [ ...resources.objects.scene.children ])
        {
            if(/physical/i.test(node.name))
            {
                const obj = this.world.addPhysicalNode(node)
                this.dynamicObjects.push(obj)
                this.ownedObjects.push(obj)
                this.landmarkMeshes.set(node.name, obj)
            }
            else
            {
                const obj = this.game.objects.add({ model: node })
                this.landmarkMeshes.set(node.name, obj)
                this.ownedObjects.push(obj)
            }
        }

        await this.world.loadEraBakedShadow(`eras/${e}/${e}_shadow`)

        this.line = new Line({ game: this.game, url: null })
        await this.line.load(`eras/${e}/${e}_line_spline.json`)
        this.world.line = this.line
        if(this.game.world)
            this.game.world.line = this.line

        this._captureListenersSync(() =>
        {
            this.waterSurface = new WaterSurface({ waterMesh, foliageMesh })
            this.breakables = new Breakables(this.world)
            this.breakables.scan(this.dynamicObjects)
            this.tracks = new Tracks()

            this._setupSignals()
            this._setupMilestones()
            this._setupSetPieces()
            this._bindUpdateLoop()
        })

        if(this.eraName === 'transformacao')
            await this._loadProjectScreenTextures()

        this.world.autoWalk?.buildGraph?.()

        if(this.world?.player)
            this.attachPlayer(this.world.player)
    }

    _ensurePaletteMaterial(paletteTex)
    {
        paletteTex.colorSpace = THREE.SRGBColorSpace
        paletteTex.minFilter = THREE.NearestFilter
        paletteTex.magFilter = THREE.NearestFilter
        paletteTex.generateMipmaps = false
        paletteTex.flipY = false
        paletteTex.needsUpdate = true

        this.game.materials.paletteTexture = paletteTex
        if(this.game.materials.list?.has('palette'))
            return

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
    }

    _parseReferences(scene)
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
            else if(/^refSignal\d+$/i.test(node.name))
                this.parsedReferences.signals.push(entry)
            else if(/^refNav\d+$/i.test(node.name))
                this.parsedReferences.navNodes.push(entry)
            else if(/^refLinePoint\d+$/i.test(node.name))
                this.parsedReferences.linePoints.push(entry)
        }
    }

    setRespawn()
    {
        const reference = this.world.references.get(this.config.respawnRef)
            || this.world.references.get('refRespawn')
        if(!reference)
            return

        const yaw = new THREE.Euler().setFromQuaternion(reference.quaternion, 'YXZ').y
        this.game.respawns.setItems([
            { name: this.eraName, x: reference.position.x, y: reference.position.y, z: reference.position.z, rotation: yaw },
        ])
        this.game.respawns.defaultName = this.eraName

        const focusPoint = this.game.view?.focusPoint
        if(focusPoint)
        {
            focusPoint.trackedPosition.set(reference.position.x, 0, reference.position.z)
            focusPoint.position.copy(focusPoint.trackedPosition)
            focusPoint.smoothedPosition.copy(focusPoint.trackedPosition)
        }
    }

    getObject3D(name)
    {
        const entry = this.landmarkMeshes.get(name)
        if(entry?.visual?.object3D)
            return entry.visual.object3D
        return this.game?.scene?.getObjectByName(name) || null
    }

    _setupSignals()
    {
        const entries = []
        const sorted = [ ...this.parsedReferences.signals ].sort((a, b) => a.name.localeCompare(b.name))
        for(let i = 0; i < sorted.length; i++)
        {
            const ref = sorted[i]
            const hidden = Boolean(ref.userData?.hidden || ref.userData?.secret)
            entries.push({
                index: i + 1,
                id: ref.userData?.signalId || `${this.eraName}_sig_${String(i + 1).padStart(2, '0')}`,
                position: ref.position.clone(),
                hidden,
                rare: Boolean(ref.userData?.rare),
                revealed: !hidden,
                collected: false,
            })
        }

        this.signals = entries
        const count = Math.max(1, entries.length)
        const geometry = new THREE.OctahedronGeometry(0.28, 0)
        const material = new THREE.MeshStandardMaterial({
            name: `${this.eraName}SignalMat`,
            color: '#ffffff',
            emissive: '#f50000',
            emissiveIntensity: 0.42,
            roughness: 0.35,
            metalness: 0.15,
        })

        this.signalsMesh = new THREE.InstancedMesh(geometry, material, count)
        this.signalsMesh.name = `${this.eraName}Signals`
        this.signalsMesh.count = entries.length
        this.signalsMesh.castShadow = false
        this.signalsMesh.receiveShadow = false
        this.signalsMesh.frustumCulled = false

        const c = new THREE.Color()
        for(let i = 0; i < entries.length; i++)
        {
            c.set(entries[i].rare ? '#ffd23f' : '#f50000')
            this.signalsMesh.setColorAt(i, c)
        }
        if(this.signalsMesh.instanceColor)
            this.signalsMesh.instanceColor.needsUpdate = true

        this.game.scene?.add(this.signalsMesh)
        this._syncSignalMatrices()
        this.game.ui?.setSignalsCount?.(0, entries.length)
    }

    _syncSignalMatrices()
    {
        if(!this.signalsMesh)
            return

        for(let i = 0; i < this.signals.length; i++)
        {
            const sig = this.signals[i]
            if(sig.collected || !sig.revealed)
            {
                this._dummy.position.set(0, -100, 0)
                this._dummy.scale.setScalar(0.0001)
            }
            else
            {
                const bob = Math.sin(this._visualTime * 2.8 + i * 0.7) * 0.12
                this._dummy.position.set(sig.position.x, sig.position.y + 0.55 + bob, sig.position.z)
                this._dummy.rotation.set(0, this._visualTime * 1.8 + i * 0.5, 0)
                this._dummy.scale.setScalar(sig.rare ? 1.25 : 1.0)
            }
            this._dummy.updateMatrix()
            this.signalsMesh.setMatrixAt(i, this._dummy.matrix)
        }
        this.signalsMesh.instanceMatrix.needsUpdate = true
    }

    _setupMilestones()
    {
        this.milestones = this.parsedReferences.milestones.map((ref) => ({
            refName: ref.name,
            entryId: normalizeEntryId(ref.userData?.entryId || ''),
            position: ref.position.clone(),
            triggered: false,
        })).filter((m) => Boolean(m.entryId))
    }

    _setupSetPieces()
    {
        switch(this.config.setPiece)
        {
            case 'unicamp':
                this._setupUnicamp()
                break
            case 'industria':
                this._setupIndustria()
                break
            case 'alemanha':
                this._setupAlemanha()
                break
            case 'dados':
                this._setupDados()
                break
            case 'transformacao':
                this._setupTransformacao()
                break
            case 'hub':
                this._setupHub()
                break
        }
    }

    _setupUnicamp()
    {
        for(let i = 1; i <= 6; i++)
        {
            const key = `UnicampNanotubeKey${String(i).padStart(2, '0')}PhysicalKinematic`
            const obj = this.landmarkMeshes.get(key)
            if(!obj)
                continue

            const ud = obj.visual?.object3D?.userData || obj.physical?.body?.userData || {}
            const pos = obj.physical?.body?.translation() || obj.visual?.object3D?.position || { x: 0, y: 1, z: 0 }
            this.nanotubePillars.push({
                object: obj,
                baseX: pos.x,
                baseY: pos.y,
                baseZ: pos.z,
                amplitude: Number(ud.oscillateAmplitude ?? 0.34),
                speed: Number(ud.oscillateSpeed ?? 1.7),
                phase: Number(ud.oscillatePhase ?? (i - 1) * 1.05),
            })
        }

        const ongMesh = this.getObject3D('UnicampMilestone2012_07')
        if(ongMesh)
            this.ongGlowMeshes.push(ongMesh)
    }

    _setupIndustria()
    {
        const beltNames = [
            'IndustriaConveyorBeltAPhysicalKinematicPositionBased',
            'IndustriaConveyorBeltBPhysicalKinematicPositionBased',
        ]
        for(const name of beltNames)
        {
            const obj = this.landmarkMeshes.get(name)
            if(!obj?.physical?.body)
                continue

            const ud = obj.visual?.object3D?.userData || {}
            const t = obj.physical.body.translation()
            const start = new THREE.Vector3(
                Number(ud.startX ?? t.x),
                Number(ud.startY ?? t.y),
                Number(ud.startZ ?? t.z)
            )
            const end = new THREE.Vector3(
                Number(ud.endX ?? t.x + 6),
                Number(ud.endY ?? t.y),
                Number(ud.endZ ?? t.z)
            )
            const platform = new MovingPlatform({
                object: obj,
                start,
                end,
                speed: Number(ud.speed ?? 2.1),
                pause: Number(ud.pause ?? 0.35),
                userData: ud,
            })
            this.ownedPlatforms.push(platform)
            this.world.movingPlatforms?.push(platform)
        }
    }

    _setupAlemanha()
    {
        // Return airship (refAirshipReturn) and clocktower milestone handled via exitGates + milestones
    }

    _setupDados()
    {
        for(let i = 1; i <= 6; i++)
        {
            const idx = String(i).padStart(2, '0')
            const physObj = this.landmarkMeshes.get(`DadosLiveBar${idx}PhysicalKinematicPositionBased`)
            const visMesh = this.getObject3D(`DadosLiveBar${idx}`)
            const refMesh = visMesh || physObj?.visual?.object3D
            const ud = refMesh?.userData || {}
            const basePos = physObj?.physical?.body?.translation() || refMesh?.position || { x: 0, y: 0, z: 0 }

            if(physObj || visMesh)
            {
                this.liveBars.push({
                    physObj,
                    visMesh,
                    baseX: basePos.x,
                    baseY: basePos.y,
                    baseZ: basePos.z,
                    minHeight: Number(ud.minHeight ?? 0.28),
                    maxHeight: Number(ud.maxHeight ?? (0.7 + (i - 1) * 0.45)),
                    growRadius: Number(ud.growRadius ?? 6.5),
                    currentRatio: 0,
                })
            }
        }

        for(let i = 1; i <= 12; i++)
        {
            const idx = String(i).padStart(2, '0')
            const node = this.getObject3D(`DadosScatterNode${idx}`)
            if(node)
                this.scatterNodes.push(node)
        }
        this.regressionLine = this.getObject3D('DadosRegressionLine')
    }

    _setupTransformacao()
    {
        for(let i = 1; i <= 6; i++)
        {
            const idx = String(i).padStart(2, '0')
            const ref = this.world.references.get(`refProject${idx}`)
            const cartridge = this.getObject3D(`Cartridge${idx}`)
            const screen = this.getObject3D(`ProjectScreen${idx}`)
            const rawId = ref?.userData?.projectId || cartridge?.userData?.projectId || screen?.userData?.projectId || ''
            const mappedId = normalizeProjectId(rawId)
            const screenImage = ref?.userData?.screenImage || screen?.userData?.screenImage || (rawId ? `projects/${rawId}.webp` : '')

            this.projectScreens.push({
                index: i,
                rawId,
                projectId: mappedId,
                screenImage,
                position: (ref?.position || cartridge?.position || screen?.position || new THREE.Vector3()).clone(),
                cartridge,
                screen,
                loaded: false,
            })
        }
    }

    async _loadProjectScreenTextures()
    {
        const manifest = await this.game.resourcesLoader.getManifest().catch(() => null)
        const texLoader = this.game.resourcesLoader.getLoader('texture')

        for(const entry of this.projectScreens)
        {
            if(this._disposed || !entry.screen || !entry.screenImage)
                continue

            const logicalPath = `eras/transformacao/${entry.screenImage}`
            let url = null
            if(manifest?.assets?.[logicalPath])
                url = resolveAsset(manifest, logicalPath, document.baseURI)
            else
                url = new URL(logicalPath, document.baseURI).href

            try
            {
                const tex = await new Promise((resolve, reject) => texLoader.load(url, resolve, undefined, reject))
                if(this._disposed)
                {
                    tex.dispose()
                    return
                }
                tex.colorSpace = THREE.SRGBColorSpace
                tex.flipY = false
                tex.needsUpdate = true
                this._ownedTextures.push(tex)

                entry.screen.traverse((child) =>
                {
                    if(!child.isMesh)
                        return
                    child.material = new THREE.MeshBasicMaterial({
                        map: tex,
                        toneMapped: false,
                    })
                })
                entry.loaded = true
            }
            catch
            {
                // Ignore missing optional webp in non-standard builds
            }
        }
    }

    _setupHub()
    {
        ensureStampStyles()
    }

    _bindUpdateLoop()
    {
        this.game.ticker.events.on('fixedTick', () => this._fixedUpdate(), 7)
        this.game.ticker.events.on('tick', () => this._update(), 8)
    }

    attachPlayer(player)
    {
        if(!player || this._disposed)
            return

        this.breakables?.attachController?.(player.controller)
        this.tracks?.attachController?.(player.controller)

        if(player.controller?.events)
        {
            const onStamp = () => this.onPlayerInteract(true)
            const onBump = (info) => this._onPlayerBump(info)
            player.controller.events.on('stamp', onStamp)
            player.controller.events.on('bump', onBump)
            this._ownedListeners.push(
                { emitter: player.controller.events, name: 'stamp', callback: onStamp },
                { emitter: player.controller.events, name: 'bump', callback: onBump }
            )
        }
        if(player.events)
        {
            const onInteract = () => this.onPlayerInteract(false)
            player.events.on('interact', onInteract)
            this._ownedListeners.push({ emitter: player.events, name: 'interact', callback: onInteract })
        }
    }

    _getPlayerPos()
    {
        const player = this.world?.player
        const bodyPos = player?.controller?.body?.translation?.()
        if(bodyPos)
            return this._tempVec.set(bodyPos.x, bodyPos.y, bodyPos.z)
        if(player?.model?.position)
            return this._tempVec.copy(player.model.position)
        return null
    }

    _fixedUpdate()
    {
        if(this._disposed)
            return

        const dt = this.game.ticker.fixedDelta
        this._visualTime += dt

        // 1. Unicamp oscillating nanotube pillars
        if(this.nanotubePillars.length > 0)
        {
            for(const p of this.nanotubePillars)
            {
                const y = p.baseY + Math.sin(this._visualTime * p.speed + p.phase) * p.amplitude
                p.object.physical?.body?.setNextKinematicTranslation({ x: p.baseX, y, z: p.baseZ })
                if(p.object.visual?.object3D)
                    p.object.visual.object3D.position.y = y
            }
        }

        const pos = this._getPlayerPos()
        if(!pos)
            return

        // 2. Collect visible signals on proximity
        for(let i = 0; i < this.signals.length; i++)
        {
            const sig = this.signals[i]
            if(sig.collected || !sig.revealed)
                continue
            const d = Math.hypot(pos.x - sig.position.x, pos.z - sig.position.z)
            if(d <= SIGNAL_COLLECT_RADIUS && Math.abs(pos.y - sig.position.y) <= 2.2)
            {
                sig.collected = true
                this.collectedSignalCount++
                this.game.ui?.setSignalsCount?.(this.collectedSignalCount, this.signals.length)
                this.game.audio?.playSfx?.('signal')
            }
        }

        // 3. Dados living bar chart pillars + regression line
        if(this.liveBars.length > 0)
        {
            let anyNear = false
            for(const bar of this.liveBars)
            {
                const d = Math.hypot(pos.x - bar.baseX, pos.z - bar.baseZ)
                const targetRatio = d <= bar.growRadius ? 1 - (d / bar.growRadius) * 0.35 : 0
                if(d <= bar.growRadius)
                    anyNear = true
                bar.currentRatio += (targetRatio - bar.currentRatio) * Math.min(1, dt * 6)
                const h = bar.minHeight + (bar.maxHeight - bar.minHeight) * bar.currentRatio
                const scaleY = Math.max(0.2, h / Math.max(0.2, bar.maxHeight))
                if(bar.visMesh)
                    bar.visMesh.scale.y = scaleY
                if(bar.physObj?.physical?.body)
                {
                    bar.physObj.physical.body.setNextKinematicTranslation({
                        x: bar.baseX,
                        y: bar.baseY + (h - bar.minHeight) * 0.5,
                        z: bar.baseZ,
                    })
                }
            }
            if(anyNear && !this.regressionLit)
                this._illuminateRegressionLine()
        }

        // 4. Hub End-Dot sphere proximity trigger
        if(this.eraName === 'hub')
        {
            const ref = this.world.references.get('refEndDotSphere') || this.world.references.get('refMilestoneEndDot')
            if(ref)
            {
                const d = pos.distanceTo(ref.position)
                if(!this.endDotTriggered && d <= ENDDOT_TRIGGER_RADIUS)
                    this.triggerHubEndDot()
                else if(this.endDotTriggered && d > ENDDOT_RESET_RADIUS)
                    this.endDotTriggered = false
            }
        }
    }

    _update()
    {
        if(this._disposed)
            return
        this._syncSignalMatrices()
    }

    _onPlayerBump(info)
    {
        const body = info?.collider?.parent?.()
        if(!body)
            return
        // Kickable bottles in Industria
        if(this.eraName === 'industria' && /Bottle/i.test(body.userData?.name || ''))
            body.applyImpulse?.({ x: 0, y: 1.5, z: -2.2 }, true)
    }

    onPlayerInteract(isStamp = false)
    {
        if(this._disposed)
            return

        const pos = this._getPlayerPos()
        if(!pos)
            return

        // 1. Milestones
        for(const m of this.milestones)
        {
            if(pos.distanceTo(m.position) <= MILESTONE_INTERACT_RADIUS)
            {
                this.triggerMilestone(m.entryId)
                return
            }
        }

        // 2. Transformacao project cartridges
        if(this.eraName === 'transformacao')
        {
            for(const p of this.projectScreens)
            {
                if(pos.distanceTo(p.position) <= MILESTONE_INTERACT_RADIUS)
                {
                    this.triggerProject(p.index)
                    return
                }
            }
        }

        // 3. Secret hatch / Backstage
        if(this.config.secretRef)
        {
            const secretRef = this.world.references.get(this.config.secretRef)
            if(secretRef && pos.distanceTo(secretRef.position) <= SECRET_STAMP_RADIUS)
            {
                this.triggerSecret(isStamp)
                return
            }
        }

        // 4. Contact shortcut pipe -> Hub
        const pipeRef = this.world.references.get('refPipeContact')
        if(pipeRef && pos.distanceTo(pipeRef.position) <= PIPE_INTERACT_RADIUS)
        {
            this.game.transitions?.transitionTo?.('hub')
            return
        }

        // 5. Era exit gates
        for(const gate of this.config.exitGates)
        {
            const gateRef = this.world.references.get(gate.ref)
            if(gateRef && pos.distanceTo(gateRef.position) <= GATE_INTERACT_RADIUS)
            {
                this.game.transitions?.transitionTo?.(gate.targetEra)
                return
            }
        }
    }

    triggerMilestone(entryId)
    {
        const id = normalizeEntryId(entryId)
        if(!id)
            return false
        if(this.eraName === 'unicamp' && id === 'e-2012-07')
            this._glowOngWindows()
        if(this.eraName === 'dados' && id === 'e-2021-06')
            this._illuminateRegressionLine()
        this.game.ui?.openMilestone?.(id)
        return true
    }

    triggerProject(indexOrId)
    {
        const match = this.projectScreens.find(
            (p) => p.index === Number(indexOrId) || p.rawId === indexOrId || p.projectId === indexOrId
        )
        if(!match || !match.projectId)
            return false
        this.game.ui?.openProject?.(match.projectId)
        return true
    }

    triggerSecret()
    {
        if(this.eraName === 'hub' || this.eraName === 'transformacao')
        {
            this.secretOpened = true
            this.openBackstageCredits()
            return true
        }

        this.secretOpened = true
        const hatch = this.config.secretHatchName ? this.getObject3D(this.config.secretHatchName) : null
        if(hatch)
            hatch.visible = false

        for(const sig of this.signals)
        {
            if(sig.hidden)
                sig.revealed = true
        }
        this._syncSignalMatrices()
        this.game.audio?.playSfx?.('secret')
        return true
    }

    _glowOngWindows()
    {
        if(this.ongGlowing)
            return
        this.ongGlowing = true
        for(const mesh of this.ongGlowMeshes)
        {
            mesh.traverse((child) =>
            {
                if(child.isMesh && child.material && child.material.emissive)
                {
                    child.material.emissive.set('#ffd23f')
                    child.material.emissiveIntensity = 0.6
                }
            })
        }
    }

    _illuminateRegressionLine()
    {
        if(this.regressionLit)
            return
        this.regressionLit = true
        const targets = [ this.regressionLine, ...this.scatterNodes ].filter(Boolean)
        for(const obj of targets)
        {
            obj.traverse((child) =>
            {
                if(child.isMesh && child.material && child.material.emissive)
                {
                    child.material.emissive.set('#ffd75a')
                    child.material.emissiveIntensity = 0.75
                }
            })
        }
    }

    triggerHubEndDot()
    {
        if(this.endDotTriggered)
            return false
        this.endDotTriggered = true

        ensureStampStyles()
        if(typeof document !== 'undefined' && !this.stampOverlay)
        {
            const el = document.createElement('div')
            el.className = 'vn-enddot-stamp'
            el.setAttribute('aria-hidden', 'true')
            el.innerHTML = `
                <div class="vn-enddot-seal">
                    <span class="vn-enddot-seal-kicker">PONTO FINAL</span>
                    <span class="vn-enddot-seal-title">VICTOR NEVES</span>
                </div>
            `
            document.body.appendChild(el)
            this.stampOverlay = el
            this._ownedDom.push(el)
        }

        this.stampOverlay?.classList.add('is-visible')
        this.game.audio?.playSfx?.('stamp')
        this.game.view?.camera?.setDistance?.(16)

        const timer = setTimeout(() =>
        {
            if(this._disposed)
                return
            this.stampOverlay?.classList.remove('is-visible')
            this.game.ui?.openContact?.()
        }, 700)
        this._timers.push(timer)
        return true
    }

    openBackstageCredits()
    {
        if(typeof document === 'undefined')
            return false

        if(!this.creditsDialog)
        {
            const dialog = document.createElement('dialog')
            dialog.className = 'vn-dialog vn-card-dialog js-backstage-credits'
            dialog.setAttribute('aria-labelledby', 'vn-credits-title')
            dialog.innerHTML = `
                <article class="vn-card">
                    <header class="vn-card-header">
                        <span class="vn-card-badge">Backstage · Créditos</span>
                        <button type="button" class="vn-btn vn-icon-btn js-credits-close" aria-label="Fechar créditos">
                            <span aria-hidden="true">×</span>
                        </button>
                    </header>
                    <div class="vn-card-content">
                        <h2 id="vn-credits-title" class="vn-card-title">Linha do Tempo 3D — Victor Neves</h2>
                        <p>Licença MIT · Motor WebGPU / WebGL2 com Three.js e física Rapier3D.</p>
                        <p>Consulte <code>LICENSES.md</code> para atribuições completas de terceiros.</p>
                    </div>
                    <footer class="vn-card-footer">
                        <button type="button" class="vn-btn vn-btn-primary js-credits-done">Fechar</button>
                    </footer>
                </article>
            `
            const root = this.game?.domElement || document.body
            root.appendChild(dialog)
            this.creditsDialog = dialog
            this._ownedDom.push(dialog)

            const close = () => dialog.close()
            dialog.querySelector('.js-credits-close')?.addEventListener('click', close)
            dialog.querySelector('.js-credits-done')?.addEventListener('click', close)
        }

        if(!this.creditsDialog.open)
            this.creditsDialog.showModal?.()
        return true
    }

    triggerSetPiece(action, arg = null)
    {
        switch(action)
        {
            case 'milestone':
                return this.triggerMilestone(arg)
            case 'project':
                return this.triggerProject(arg ?? 1)
            case 'secret':
            case 'backstage':
                return this.triggerSecret()
            case 'enddot':
                return this.triggerHubEndDot()
            case 'ong':
                this._glowOngWindows()
                return true
            case 'regression':
                this._illuminateRegressionLine()
                return true
            default:
                return false
        }
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

        for(const t of this._timers)
            clearTimeout(t)
        this._timers = []

        for(const { emitter, name, callback } of this._ownedListeners)
            emitter?.off?.(name, callback)
        this._ownedListeners = []

        for(const el of this._ownedDom)
            el?.remove?.()
        this._ownedDom = []
        this.creditsDialog = null
        this.stampOverlay = null

        if(this.ownedPlatforms.length > 0)
        {
            const platformSet = new Set(this.ownedPlatforms)
            if(Array.isArray(this.world?.movingPlatforms))
                this.world.movingPlatforms = this.world.movingPlatforms.filter((p) => !platformSet.has(p))
            this.ownedPlatforms = []
        }

        if(this.signalsMesh)
        {
            this.signalsMesh.removeFromParent()
            this.signalsMesh.geometry?.dispose?.()
            this.signalsMesh.material?.dispose?.()
            this.signalsMesh = null
        }

        for(const tex of this._ownedTextures)
            tex?.dispose?.()
        this._ownedTextures = []

        this.breakables?.dispose?.()
        this.breakables = null
        this.tracks?.dispose?.()
        this.tracks = null
        this.waterSurface = null

        if(this.line)
        {
            this.line.dispose?.()
            if(this.world?.line === this.line)
                this.world.line = null
            if(this.game.world?.line === this.line)
                this.game.world.line = null
            this.line = null
        }

        const ownedSet = new Set(this.ownedObjects)
        if(this.game?.objects?.list)
        {
            for(const [ key, obj ] of this.game.objects.list.entries())
            {
                if(ownedSet.has(obj))
                    this.game.objects.list.delete(key)
            }
        }

        const ownedPhysicals = new Set()
        const physicsWorld = this.game?.physics?.world

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

        if(this.terrainTexture)
        {
            this.terrainTexture.dispose()
            this.terrainTexture = null
        }

        if(this.world?.bakedShadowTexture)
        {
            this.world.bakedShadowTexture.dispose()
            this.world.bakedShadowTexture = null
            this.world.bakedShadowMeta = null
            MeshDefaultMaterial.clearBakedShadow()
        }

        for(const key of this.ownedReferenceKeys)
            this.world?.references?.delete(key)
        this.ownedReferenceKeys = []

        const cache = this.game?.resourcesLoader?.cache
        if(cache)
        {
            for(const key of this._cacheKeys())
                cache.delete(key)
        }
    }
}
