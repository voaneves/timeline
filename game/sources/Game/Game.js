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
import { MapDialog } from './UI/Map.js'
import { Achievements } from './Achievements.js'
import { Audio } from './Audio.js'

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

        // Default to Era 1 ("Origens") unless greybox, demo, palette, or Phase 1 greybox ghosts are requested
        const eraParam = Debug.getParam('era')
        const greyboxGhosts = new Set([ 'skid', 'jumpArc', 'stamp', 'platform', 'greybox-keyboard', 'vehicle' ])
        if(eraParam === null && Debug.getParam('demo') === null && Debug.getParam('debug') !== 'palette' && !greyboxGhosts.has(ghostMode))
        {
            const url = new URL(location.href)
            url.searchParams.set('era', 'origens')
            history.replaceState(history.state, '', url.toString())
        }

        this.paused = false
        this.viewport = new Viewport(this.domElement)
        this.cards = new Cards()
        this.hud = new Hud(this.cards)
        this.map = new MapDialog(this.cards)
        this.achievements = new Achievements(this.cards)
        this.hud.setMap(this.map)
        this.hud.setAchievements(this.achievements)
        if(this.hud.options.quality !== 'auto')
            this.quality.setManualLevel(Number(this.hud.options.quality))
        this.installPauseControl()
        this.ui = {
            cards: this.cards,
            hud: this.hud,
            map: this.map,
            achievements: this.achievements,
            announcer: this.cards.announcer,
            openMilestone: (id) => this.cards.openMilestone(id),
            openProject: (id) => this.cards.openProject(id),
            openProjects: () => this.cards.openProjects(),
            openContact: () => this.cards.openContact(),
            openList: () => this.cards.openList(),
            openMenu: () => this.hud.openMenu(),
            openMap: () => this.map.open(),
            closeCard: (byPointer) => this.cards.close(byPointer),
            setEraProgress: (eraName, visited, total) => this.hud.setEraProgress(eraName, visited, total),
            setSignalsCount: (count, total) => this.hud.setSignalsCount(count, total),
            setPaused: (paused) => this.setPaused(paused),
            options: this.hud.options,
        }
        this.rendering = new Rendering()
        await this.rendering.setRenderer()

        // No file resources in the empty engine (textures are generated in code)
        this.resources = {}

        this.respawns = new Respawns()
        this.view = new View()
        this.rendering.setPostprocessing()
        this.applyReducedMotion(this.hud.options.reducedMotion)
        this.hud.events.on('optionChange', (key, value) =>
        {
            if(key === 'reducedMotion')
                this.applyReducedMotion(Boolean(value))
            else if(key === 'quality')
                this.quality.setManualLevel(value === 'auto' ? null : Number(value))
        })
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

        const activeEra = (Debug.getParam('era') || '').trim().toLowerCase()
        if(Debug.getParam('demo') === null && Debug.getParam('debug') !== 'palette')
        {
            const criticalFiles = [ 'palette.png' ]
            if(Debug.getParam('loco') !== 'vehicle')
                criticalFiles.push('character/victor_core.glb')
            if(activeEra === 'origens')
            {
                criticalFiles.push(
                    'eras/origens/origensVisual.glb',
                    'eras/origens/origensPhysical.glb',
                    'eras/origens/origensObjects.glb',
                    'eras/origens/origensReferences.glb',
                    'eras/origens/origens_terrain.png',
                )
            }
            else
            {
                criticalFiles.push('eras/greybox/greybox.glb')
            }
            try { await this.resourcesLoader.prepareCritical(criticalFiles) } catch {}
        }

        if(Debug.getParam('demo') === null && Debug.getParam('debug') !== 'palette' && Debug.getParam('loco') !== 'vehicle')
        {
            const characterResources = await this.resourcesLoader.load([
                [ 'victorCore', 'character/victor_core.glb', 'gltf' ],
                [ 'palette', 'palette.png', 'texture' ],
            ])
            Object.assign(this.resources, characterResources)
        }

        this.terrain = new Terrain()
        this.physics = new Physics()
        this.wireframe = new PhysicsWireframe()
        this.world = new World()
        await this.world.ready // greybox glb (the `?demo` world is synchronous)
        this.applyReducedMotion(this.ui.options.reducedMotion)
        this.resourcesLoader.finishCritical()

        this.audio = new Audio(this)

        if(this.rendering?.renderer?.compileAsync)
        {
            try { await this.rendering.renderer.compileAsync(this.scene, this.view.camera) } catch {}
        }

        // `?debug=physics`: Rapier smoke test (T0.7), separate chunk, results in window.__physicsSmoke
        if(__DEV_TOOLS__ && Debug.getParam('debug') === 'physics')
            this.physicsSmoke = import('./Physics/PhysicsSmoke.js').then(({ runPhysicsSmoke }) => runPhysicsSmoke(this.RAPIER))

        // Ghost starts counting fixed steps here: nothing has stepped the physics yet and nothing awaits until `ready`
        this.ghost?.begin()

        this.ready = true
        this.reveal.start({
            instant: Boolean(Debug.getParam('demo') !== null || Debug.getParam('debug') === 'palette'),
        })

        if(activeEra === 'origens')
        {
            this.ui.announcer.announceEra('Origens', 3)
            this.bindProximityAnnouncer()
        }

        // Lazy-load extra animation clips & audio bank post-reveal
        this.world?.player?.visual?.loadExtras()
        this.audio?.loadBank()
    }

    installPauseControl()
    {
        const origTickerUpdate = this.ticker.update.bind(this.ticker)
        this.ticker.update = (elapsed) =>
        {
            if(this.paused)
            {
                this.ticker.elapsed = elapsed / 1000
                this.rendering?.render()
                return
            }
            origTickerUpdate(elapsed)
        }

        const actionsEl = this.hud?.header?.querySelector('.vn-hud-actions')
        if(actionsEl)
        {
            this.pauseBtn = document.createElement('button')
            this.pauseBtn.type = 'button'
            this.pauseBtn.className = 'vn-hud-btn js-hud-pause'
            this.pauseBtn.setAttribute('aria-pressed', 'false')
            this.pauseBtn.textContent = 'Pausar'
            this.pauseBtn.addEventListener('click', () => this.setPaused(!this.paused))

            const menuBtn = actionsEl.querySelector('.js-hud-menu')
            if(menuBtn)
                actionsEl.insertBefore(this.pauseBtn, menuBtn.nextSibling)
            else
                actionsEl.appendChild(this.pauseBtn)
        }

        window.addEventListener('keydown', (event) =>
        {
            if(event.code !== 'KeyP' || event.repeat)
                return
            const target = event.target
            if(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable))
                return
            if(document.querySelector('dialog[open]'))
                return
            event.preventDefault()
            this.setPaused(!this.paused)
        })
    }

    setPaused(paused)
    {
        const next = Boolean(paused)
        if(this.paused === next)
            return

        this.paused = next
        document.documentElement.classList.toggle('is-paused', next)

        if(this.pauseBtn)
        {
            this.pauseBtn.setAttribute('aria-pressed', String(next))
            this.pauseBtn.textContent = next ? 'Retomar' : 'Pausar'
            this.pauseBtn.classList.toggle('is-paused', next)
        }

        if(next)
            this.cards?.releaseGameInputs?.()

        this.world?.origensEra?.ambientLife?.setPaused?.(next)

        if(this.audio?.ctx)
        {
            if(next && this.audio.ctx.state === 'running')
                this.audio.ctx.suspend().catch(() => {})
            else if(!next && !this.audio.muted && this.audio.ctx.state === 'suspended')
                this.audio.ctx.resume().catch(() => {})
        }

        this.ui?.announcer?.announce(next ? 'Jogo pausado' : 'Jogo retomado')
    }

    applyReducedMotion(enabled)
    {
        if(this.rendering?.cheapDOFPass)
            this.rendering.cheapDOFPass.amount.value = enabled ? 0 : 0.003

        if(this.view?.roll)
        {
            this.view.roll.kickStrength = enabled ? 0 : 1
            if(enabled)
            {
                this.view.roll.value = 0
                this.view.roll.speed = 0
                this.view.roll.velocity = 0
            }
        }

        if(enabled && this.view?.speedLines)
        {
            this.view.speedLines.strength = 0
            if(this.view.speedLines.smoothedStrength)
                this.view.speedLines.smoothedStrength.value = 0
        }

        this.world?.origensEra?.ambientLife?.setPaused?.(Boolean(enabled || this.paused))
    }

    bindProximityAnnouncer()
    {
        this.ticker.events.on('tick', () =>
        {
            if(!this.ready || this.paused || document.querySelector('dialog[open]'))
                return
            const playerPos = this.world?.player?.controller?.body?.translation?.()
            const era = this.world?.origensEra
            const setPieces = era?.setPieces
            if(!playerPos || !era || !setPieces)
                return

            if(!setPieces.housePopped)
            {
                const ref1994 = this.world.references.get('refMilestone1994')?.position
                if(ref1994 && Math.hypot(playerPos.x - ref1994.x, playerPos.z - ref1994.z) <= 3.0)
                    this.ui.announcer.announceThrottled('prox-1994', 'Bloco 1994: pressione F', 1500)
            }

            if(!setPieces.crtLit)
            {
                const ref2005 = this.world.references.get('refMilestone2005')?.position
                if(ref2005 && Math.hypot(playerPos.x - ref2005.x, playerPos.z - ref2005.z) <= 3.0)
                    this.ui.announcer.announceThrottled('prox-2005', 'Bloco 2005: pressione F ou carimbe', 1500)
            }

            if(!setPieces.capeloAttached)
            {
                const ref2011 = this.world.references.get('refMilestone2011')?.position
                if(ref2011 && Math.hypot(playerPos.x - ref2011.x, playerPos.z - ref2011.z) <= 3.0)
                    this.ui.announcer.announceThrottled('prox-2011', 'Bloco 2011: pressione F', 1500)
            }
        }, 25)
    }

    reset()
    {
        this.objects.resetAll()
        this.world?.reset?.()
    }
}
