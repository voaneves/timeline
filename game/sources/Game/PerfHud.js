// Perf HUD (plan T0.9). Only imported from Game.js behind `Debug.isRequested()`, so it is a separate chunk
// that normal visitors never fetch. Plain DOM (no Tweakpane) so it also works when the panel is hidden.
export class PerfHud
{
    constructor(perf)
    {
        this.perf = perf
        this.element = document.createElement('pre')
        this.element.className = 'perf-hud'
        this.element.style.cssText = 'position:fixed;left:8px;bottom:8px;margin:0;padding:6px 8px;font:11px/1.4 ui-monospace,monospace;'
            + 'color:#fff;background:rgba(0,0,0,.6);border-radius:4px;pointer-events:none;z-index:9999;white-space:pre'
        document.body.appendChild(this.element)

        this.timer = setInterval(() => this.update(), 250)
        addEventListener('keydown', (event) =>
        {
            const target = event.target
            if(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable))
                return
            if(event.code === 'KeyH')
                this.element.hidden = !this.element.hidden
        })
    }

    update()
    {
        const s = this.perf.snapshot()
        const gpu = s.gpuMs === 'unavailable' ? 'unavailable' : `${s.gpuMs.toFixed(2)} ms`
        this.element.textContent =
            `${s.backend}  ${s.fps.toFixed(0)} fps\n` +
            `frame p50 ${s.frameMsP50.toFixed(1)}  p95 ${s.frameMsP95.toFixed(1)} ms\n` +
            `draws ${s.drawCalls}  tris ${s.triangles}  progs ${s.programs}\n` +
            `gpu ${gpu}`
    }
}
