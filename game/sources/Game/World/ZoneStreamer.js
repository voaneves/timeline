import { Game } from '../Game.js'
import { EraSection } from './Eras/EraSection.js'
import { OrigensEra } from './Eras/OrigensEra.js'

const ZONE_DEFINITIONS = [
    { name: 'origens', index: 0, center: { x: 0, y: 0, z: -18 }, radius: 45, create: (world) => new OrigensEra(world) },
    { name: 'unicamp', index: 1, center: { x: 0, y: 0, z: -90 }, radius: 45, create: (world) => new EraSection(world, 'unicamp') },
    { name: 'industria', index: 2, center: { x: 0, y: 0, z: -165 }, radius: 42, create: (world) => new EraSection(world, 'industria') },
    { name: 'alemanha', index: 3, center: { x: 0, y: 0, z: -240 }, radius: 36, create: (world) => new EraSection(world, 'alemanha') },
    { name: 'dados', index: 4, center: { x: 0, y: 0, z: -315 }, radius: 42, create: (world) => new EraSection(world, 'dados') },
    { name: 'transformacao', index: 5, center: { x: 0, y: 0, z: -390 }, radius: 38, create: (world) => new EraSection(world, 'transformacao') },
    { name: 'hub', index: 6, center: { x: 0, y: 0, z: -465 }, radius: 40, create: (world) => new EraSection(world, 'hub') },
]

/**
 * Full-ring era zone streamer (T2.28 + T3.X2):
 * Registers all 7 zones (`origens`, `unicamp`, `industria`, `alemanha`, `dados`, `transformacao`, `hub`),
 * preloads the active era's next neighbor in `requestIdleCallback`, disposes eras `>= 2` away,
 * and exposes `window.__streamer` + `window.__ring` for deterministic verification.
 */
export class ZoneStreamer
{
    constructor(world = null, options = {})
    {
        this.game = Game.getInstance()
        this.world = world || this.game?.world || null
        this.zones = new Map(ZONE_DEFINITIONS.map((z) => [ z.name, z ]))
        this.zoneOrder = ZONE_DEFINITIONS.map((z) => z.name)
        this.loaded = new Map()
        this.loading = new Map()
        this.cycleCount = 0
        this.activeZone = 'origens'
        this.autoStream = Boolean(options.autoStream)
        this._tickCounter = 0
        this._navSeq = 0
        this._idleHandle = null
        this._idleUsesTimeout = false

        this._onTick = () => this.update()
        this.game?.ticker?.events?.on('tick', this._onTick, 9)

        this.exposeDebugApi()
    }

    normalizeName(name)
    {
        const key = String(name || '').trim().toLowerCase()
        if(key === 'ia')
            return 'transformacao'
        return key
    }

    ringDistance(nameA, nameB)
    {
        const a = this.zones.get(this.normalizeName(nameA))
        const b = this.zones.get(this.normalizeName(nameB))
        if(!a || !b)
            return Infinity
        const total = this.zoneOrder.length
        const diff = Math.abs(a.index - b.index)
        return Math.min(diff, total - diff)
    }

    getNextEraName(name)
    {
        const def = this.zones.get(this.normalizeName(name))
        if(!def)
            return null
        const nextIdx = (def.index + 1) % this.zoneOrder.length
        return this.zoneOrder[nextIdx]
    }

    _cancelIdlePreload()
    {
        if(this._idleHandle === null)
            return
        if(this._idleUsesTimeout)
            clearTimeout(this._idleHandle)
        else if(typeof cancelIdleCallback === 'function')
            cancelIdleCallback(this._idleHandle)
        this._idleHandle = null
    }

    scheduleNeighborPreload(activeName = this.activeZone)
    {
        this._cancelIdlePreload()
        const nextName = this.getNextEraName(activeName)
        if(!nextName || this.loaded.has(nextName) || this.loading.has(nextName))
            return

        const run = () =>
        {
            this._idleHandle = null
            if(this.activeZone === activeName && !this.loaded.has(nextName) && !this.loading.has(nextName))
                this.loadEra(nextName, { activate: false })
        }

        if(typeof requestIdleCallback === 'function')
        {
            this._idleUsesTimeout = false
            this._idleHandle = requestIdleCallback(run, { timeout: 1200 })
        }
        else
        {
            this._idleUsesTimeout = true
            this._idleHandle = setTimeout(run, 150)
        }
    }

    async loadEra(name, options = {})
    {
        const activate = options.activate !== false
        const key = this.normalizeName(name)
        if(this.loaded.has(key))
        {
            const existing = this.loaded.get(key)
            if(activate)
                await existing.activate?.()
            return existing
        }

        if(this.loading.has(key))
        {
            const existing = await this.loading.get(key)
            if(activate && existing && !existing._disposed)
                await existing.activate?.()
            return existing
        }

        const def = this.zones.get(key)
        if(!def || typeof def.create !== 'function')
            return null

        const promise = (async () =>
        {
            const era = def.create(this.world)
            await era.load()
            if(era._disposed)
                return null
            this.loaded.set(key, era)

            if(key === 'origens' && this.world)
                this.world.origensEra = era

            if(this.world?.player)
                this._restorePlayerController()

            if(activate)
                await era.activate?.()

            return era
        })()

        this.loading.set(key, promise)
        try
        {
            return await promise
        }
        finally
        {
            this.loading.delete(key)
        }
    }

    unloadEra(name)
    {
        const key = this.normalizeName(name)
        const era = this.loaded.get(key)
        if(!era)
            return false

        era.dispose?.()
        this.loaded.delete(key)

        if(key === 'origens' && this.world?.origensEra === era)
            this.world.origensEra = null

        if(this.loaded.size === 0)
            this._suspendPlayerController()

        this.cycleCount++
        return true
    }

    unloadDistant(centerName)
    {
        for(const loadedName of Array.from(this.loaded.keys()))
        {
            if(this.ringDistance(loadedName, centerName) >= 2)
                this.unloadEra(loadedName)
        }
    }

    async goToEra(name, options = {})
    {
        const key = this.normalizeName(name)
        if(!this.zones.has(key))
            return null

        const seq = ++this._navSeq
        this._cancelIdlePreload()

        // Dispose eras >= 2 zones away first so Rapier/GPU stay bounded
        this.unloadDistant(key)

        const era = await this.loadEra(key, { activate: false })
        if(seq !== this._navSeq)
        {
            this.unloadDistant(this.activeZone)
            return null
        }

        this.activeZone = key
        await era?.activate?.()
        if(seq !== this._navSeq)
        {
            this.unloadDistant(this.activeZone)
            return null
        }

        if(this.world?.player?.controller)
        {
            this.world.player.clearWalkTarget?.()
            this.world.player.controller.respawn?.()
        }
        this.game?.physics?.world?.propagateModifiedBodyPositionsToColliders?.()

        if(options.preloadNeighbor !== false)
            this.scheduleNeighborPreload(key)

        return era
    }

    _suspendPlayerController()
    {
        const controller = this.world?.player?.controller
        if(controller && !this._savedControllerStep)
        {
            this._savedControllerStep = controller.step
            controller.step = () => {}
        }
        const physics = this.game?.physics
        if(physics && !this._savedPhysicsUpdate)
        {
            this._savedPhysicsUpdate = physics.update
            physics.update = () => {}
        }
    }

    _restorePlayerController()
    {
        const controller = this.world?.player?.controller
        if(controller && this._savedControllerStep)
        {
            controller.step = this._savedControllerStep
            this._savedControllerStep = null
        }
        const physics = this.game?.physics
        if(physics && this._savedPhysicsUpdate)
        {
            physics.update = this._savedPhysicsUpdate
            this._savedPhysicsUpdate = null
        }
    }

    findActiveZone(pos)
    {
        let best = null
        let bestDist = Infinity
        for(const zone of this.zones.values())
        {
            const d = Math.hypot(pos.x - zone.center.x, pos.z - zone.center.z)
            if(d < bestDist)
            {
                bestDist = d
                best = zone
            }
        }
        return best
    }

    update()
    {
        if(!this.autoStream)
            return

        this._tickCounter++
        if(this._tickCounter % 15 !== 0)
            return

        const player = this.world?.player
        const pos = player?.controller?.body?.translation?.() || player?.model?.position
        if(!pos)
            return

        const active = this.findActiveZone(pos)
        if(!active)
            return

        this.activeZone = active.name

        for(const zone of this.zones.values())
        {
            const zoneDist = this.ringDistance(zone.name, active.name)
            if(zoneDist <= 1)
            {
                if(zone.create && !this.loaded.has(zone.name) && !this.loading.has(zone.name))
                    this.loadEra(zone.name, { activate: false })
            }
            else if(zoneDist >= 2)
            {
                if(this.loaded.has(zone.name))
                    this.unloadEra(zone.name)
            }
        }
    }

    stats()
    {
        const rWorld = this.game?.physics?.world
        const info = this.game?.rendering?.renderer?.info
        const mem = info?.memory
        const programs = info?.programs
        const jsHeapMB = (typeof performance !== 'undefined' && performance.memory)
            ? +(performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2)
            : null

        return {
            bodies: rWorld ? rWorld.bodies.len() : 0,
            colliders: rWorld ? rWorld.colliders.len() : 0,
            geometries: mem ? mem.geometries : 0,
            textures: mem ? mem.textures : 0,
            programs: Array.isArray(programs) ? programs.length : 0,
            jsHeapMB,
        }
    }

    exposeDebugApi()
    {
        if(typeof window === 'undefined')
            return

        const self = this
        window.__streamer = {
            loadEra: (name) => self.loadEra(name),
            unloadEra: (name) => self.unloadEra(name),
            goToEra: (name, options) => self.goToEra(name, options),
            get loadedEras() { return Array.from(self.loaded.keys()) },
            get cycleCount() { return self.cycleCount },
            stats: () => self.stats(),
        }

        window.__ring = {
            get eras() { return [ ...self.zoneOrder ] },
            get currentEra() { return self.activeZone },
            goToEra: (name, options = {}) =>
            {
                if(options.transition && self.world?.transitions)
                    return self.world.transitions.transitionTo(name, options)
                return self.goToEra(name, options)
            },
            triggerSetPiece: (action, arg = null) =>
            {
                const era = self.loaded.get(self.activeZone)
                if(!era)
                    return false
                if(typeof era.triggerSetPiece === 'function')
                    return era.triggerSetPiece(action, arg)
                return false
            },
            stats: () => self.stats(),
        }
    }

    dispose()
    {
        this._cancelIdlePreload()

        if(this._onTick)
            this.game?.ticker?.events?.off('tick', this._onTick)

        for(const key of Array.from(this.loaded.keys()))
            this.unloadEra(key)

        if(typeof window !== 'undefined')
        {
            if(window.__streamer)
                delete window.__streamer
            if(window.__ring)
                delete window.__ring
        }
    }
}
