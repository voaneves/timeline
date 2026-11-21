import { Game } from '../Game.js'
import { OrigensEra } from './Eras/OrigensEra.js'

const ZONE_DEFINITIONS = [
    { name: 'origens', index: 0, center: { x: 0, y: 0, z: -18 }, radius: 45, create: (world) => new OrigensEra(world) },
    { name: 'unicamp', index: 1, center: { x: 0, y: 0, z: -90 }, radius: 45, create: null },
    { name: 'industria', index: 2, center: { x: 0, y: 0, z: -165 }, radius: 45, create: null },
    { name: 'dados', index: 3, center: { x: 0, y: 0, z: -240 }, radius: 45, create: null },
    { name: 'ia', index: 4, center: { x: 0, y: 0, z: -315 }, radius: 45, create: null },
]

/**
 * Era zone streamer (T2.28):
 * Keeps the active era + immediate neighbor (`|deltaIndex| <= 1`) loaded,
 * disposes eras `>= 2` zones away, and exposes `window.__streamer` for deterministic cycle/leak verification.
 */
export class ZoneStreamer
{
    constructor(world = null, options = {})
    {
        this.game = Game.getInstance()
        this.world = world || this.game?.world || null
        this.zones = new Map(ZONE_DEFINITIONS.map((z) => [ z.name, z ]))
        this.loaded = new Map()
        this.loading = new Map()
        this.cycleCount = 0
        this.activeZone = 'origens'
        this.autoStream = Boolean(options.autoStream)
        this._tickCounter = 0

        this._onTick = () => this.update()
        this.game?.ticker?.events?.on('tick', this._onTick, 9)

        this.exposeDebugApi()
    }

    normalizeName(name)
    {
        return String(name || '').trim().toLowerCase()
    }

    async loadEra(name)
    {
        const key = this.normalizeName(name)
        if(this.loaded.has(key))
            return this.loaded.get(key)

        if(this.loading.has(key))
            return this.loading.get(key)

        const def = this.zones.get(key)
        if(!def || typeof def.create !== 'function')
            return null

        const promise = (async () =>
        {
            const era = def.create(this.world)
            await era.load()
            this.loaded.set(key, era)

            if(key === 'origens' && this.world)
                this.world.origensEra = era

            if(this.world?.player)
            {
                this._restorePlayerController()
                era.attachPlayer?.(this.world.player)
            }

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
            const zoneDist = Math.abs(zone.index - active.index)
            if(zoneDist <= 1)
            {
                if(zone.create && !this.loaded.has(zone.name) && !this.loading.has(zone.name))
                    this.loadEra(zone.name)
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
            get loadedEras() { return Array.from(self.loaded.keys()) },
            get cycleCount() { return self.cycleCount },
            stats: () => self.stats(),
        }
    }

    dispose()
    {
        if(this._onTick)
            this.game?.ticker?.events?.off('tick', this._onTick)

        for(const key of Array.from(this.loaded.keys()))
            this.unloadEra(key)

        if(typeof window !== 'undefined' && window.__streamer)
            delete window.__streamer
    }
}
