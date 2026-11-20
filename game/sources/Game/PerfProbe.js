// window.__perf (plan T0.9): frame stats + renderer info, read by perf gates, the capture tool and the debug HUD.
// Cheap enough to be always on (one array write per frame). GPU time needs timestamp queries, which are opt-in
// (`?debug` or `?perf=gpu`) because the backend then allocates a query pool and reads it back asynchronously.
import { Game } from './Game.js'

const WINDOW = 240 // frames kept for percentiles
const GPU_RESOLVE_EVERY = 30 // frames between async timestamp reads

export class PerfProbe
{
    // Read before the renderer is created: it has to be passed to the WebGPURenderer constructor.
    static wantsGpuTimer()
    {
        return !!(location.hash.match(/debug/i) || location.search.match(/[?&](?:debug|perf=gpu)/i))
    }

    constructor()
    {
        this.game = Game.getInstance()
        this.frames = new Float32Array(WINDOW)
        this.count = 0
        this.last = 0
        this.gpu = { ms: null, source: PerfProbe.wantsGpuTimer() ? 'pending' : 'off' }
        this.resolving = false

        // Before the render (998) to measure the frame interval, after it to read info
        this.game.ticker.events.on('tick', () => this.begin(), 0)
        this.game.ticker.events.on('tick', () => this.end(), 999)

        Object.defineProperty(window, '__perf', { value: this, configurable: true })
    }

    begin()
    {
        const now = performance.now()
        if(this.last)
        {
            this.frames[this.count % WINDOW] = now - this.last
            this.count++
        }
        this.last = now
    }

    end()
    {
        const renderer = this.game.rendering.renderer
        const info = renderer.info

        this.drawCalls = info.render.drawCalls
        this.triangles = info.render.triangles
        this.programs = info.memory.programs ?? 0

        if(this.gpu.source !== 'off' && !this.resolving && this.count % GPU_RESOLVE_EVERY === 0)
            this.resolveGpu(renderer)
    }

    async resolveGpu(renderer)
    {
        this.resolving = true
        try
        {
            const backend = renderer.backend
            if(!backend.trackTimestamp)
            {
                this.gpu = { ms: null, source: 'unavailable' }
                return
            }
            const ms = await renderer.resolveTimestampsAsync('render')
            if(typeof ms === 'number' && Number.isFinite(ms))
                this.gpu = { ms, source: backend.isWebGPUBackend ? 'webgpu-timestamp-query' : 'EXT_disjoint_timer_query_webgl2' }
        }
        catch(error)
        {
            this.gpu = { ms: null, source: 'unavailable' }
        }
        finally
        {
            this.resolving = false
        }
    }

    // Percentile over the last frames, ms
    percentile(p)
    {
        const n = Math.min(this.count, WINDOW)
        if(n === 0)
            return 0
        const sorted = Array.from(this.frames.subarray(0, n)).sort((a, b) => a - b)
        return sorted[Math.min(n - 1, Math.floor(p * n))]
    }

    get frameMsP50() { return this.percentile(0.5) }
    get frameMsP95() { return this.percentile(0.95) }
    get fps() { const p50 = this.frameMsP50; return p50 ? 1000 / p50 : 0 }
    get backend() { return this.game.rendering.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2' }

    get gpuMs() { return this.gpu.ms === null ? 'unavailable' : this.gpu.ms }

    snapshot()
    {
        return {
            backend: this.backend,
            fps: this.fps,
            frameMsP50: this.frameMsP50,
            frameMsP95: this.frameMsP95,
            drawCalls: this.drawCalls,
            triangles: this.triangles,
            programs: this.programs,
            gpuMs: this.gpuMs,
            gpuSource: this.gpu.source,
            frames: Math.min(this.count, WINDOW),
        }
    }

    toJSON() { return this.snapshot() }
}
