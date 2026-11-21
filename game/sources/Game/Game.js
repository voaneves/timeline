// Rewritten for the empty engine (plan T0.6): no Server, Audio, Player, Menu, Areas, Weather cycles,
// no resources to load. Construction order follows ENGINE-INVENTORY.md 3.3.
import * as THREE from 'three/webgpu'

import { Debug } from './Debug.js'
import { Inputs } from './Inputs/Inputs.js'
import { Physics } from './Physics/Physics.js'
import { PhysicsWireframe } from './Physics/PhysicsWireframe.js'
import { Rendering } from './Rendering.js'
import { ResourcesLoader } from './ResourcesLoader.js'
import { Ticker } from './Ticker.js'
import { Time } from './Time.js'
import { View } from './View.js'
import { Viewport } from './Viewport.js'
import { World } from './World/World.js'
import { Tracks } from './Tracks.js'
import { Lighting } from './Ligthing.js'
import { Materials } from './Materials.js'
import { Objects } from './Objects.js'
import { Fog } from './Fog.js'
import { DayCycles } from './Cycles/DayCycles.js'
import { Weather } from './Weather.js'
import { Terrain } from './Terrain.js'
import { Respawns } from './Respawns.js'
import { Water } from './Water.js'
import { Reveal } from './Reveal.js'
import { Quality } from './Quality.js'
import { PerfProbe } from './PerfProbe.js'
import { Cards } from './UI/Cards.js'
import { Hud } from './UI/Hud.js'

export class Game
{
    static getInstance()
    {
        return Game.instance
    }

    constructor()
    {
        // Singleton
        if(Game.instance)
            return Game.instance

        Game.instance = this

        this.init()
    }

    async init()
    {
        // Setup
        this.domElement = document.querySelector('.game')
        this.canvasElement = this.domElement.querySelector('.js-canvas')
        document.documentElement.classList.add('is-started')

        // Debug panel (tweakpane) is a separate chunk, fetched only when requested
        await Debug.load()

        // Load RAPIER (wasm) in parallel with the rest of the boot
        const rapierPromise = import('@dimforge/rapier3d')

        this.scene = new THREE.Scene()
        this.debug = new Debug()
        this.resourcesLoader = new ResourcesLoader()
        this.quality = new Quality()
        this.ticker = new Ticker()
        this.time = new Time()
        this.dayCycles = new DayCycles()
        this.inputs = new Inputs([], [])

        // `?ghost=rec|<name>` (T0.16): input recorder / replayer, separate chunk, only fetched when requested
        const ghostMode = Debug.getParam('ghost')
        if(ghostMode)
        {
            const { Ghost } = await import('./Ghost.js')
            this.ghost = new Ghost(ghostMode)
            await this.ghost.load()
        }

        this.viewport = new Viewport(this.domElement)
        this.cards = new Cards()
        this.hud = new Hud(this.cards)
        this.ui = {
            cards: this.cards,
            hud: this.hud,
            announcer: this.cards.announcer,
            openMilestone: (id) => this.cards.openMilestone(id),
            openProject: (id) => this.cards.openProject(id),
            openProjects: () => this.cards.openProjects(),
            openContact: () => this.cards.openContact(),
            openList: () => this.cards.openList(),
            openMenu: () => this.hud.openMenu(),
            closeCard: (byPointer) => this.cards.close(byPointer),
            setEraProgress: (eraName, visited, total) => this.hud.setEraProgress(eraName, visited, total),
            setSignalsCount: (count, total) => this.hud.setSignalsCount(count, total),
            options: this.hud.options,
        }
        this.rendering = new Rendering()
        await this.rendering.setRenderer()

        // No file resources in the empty engine (textures are generated in code)
        this.resources = {}

        this.respawns = new Respawns()
        this.view = new View()
        this.rendering.setPostprocessing()
        this.rendering.start()
        this.perf = new PerfProbe() // window.__perf
        if(__DEV_TOOLS__ && Debug.isRequested())
            import('./PerfHud.js').then(({ PerfHud }) => { this.perfHud = new PerfHud(this.perf) })
        this.reveal = new Reveal()
        this.weather = new Weather()
        this.tracks = new Tracks()
        this.lighting = new Lighting()
        this.fog = new Fog()
        this.water = new Water()
        this.materials = new Materials()
        this.objects = new Objects()

        this.RAPIER = await rapierPromise

        this.terrain = new Terrain()
        this.physics = new Physics()
        this.wireframe = new PhysicsWireframe()
        this.world = new World()
        await this.world.ready // greybox glb (the `?demo` world is synchronous)

        // `?debug=physics`: Rapier smoke test (T0.7), separate chunk, results in window.__physicsSmoke
        if(__DEV_TOOLS__ && Debug.getParam('debug') === 'physics')
            this.physicsSmoke = import('./Physics/PhysicsSmoke.js').then(({ runPhysicsSmoke }) => runPhysicsSmoke(this.RAPIER))

        // Ghost starts counting fixed steps here: nothing has stepped the physics yet and nothing awaits until `ready`
        this.ghost?.begin()

        this.ready = true
    }

    reset()
    {
        this.objects.resetAll()
        this.world?.reset?.()
    }
}
