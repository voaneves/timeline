import * as THREE from 'three/webgpu'
import { pass, mrt, output, emissive, renderOutput, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { Game } from './Game.js'
import { cheapDOF } from './Passes/cheapDOF.js'
import { PerfProbe } from './PerfProbe.js'
import { Quality } from './Quality.js'

export class Rendering
{
    constructor()
    {
        this.game = Game.getInstance()
        this.backendName = null
        this.renderScale = 1.0
        this.minRenderScale = 0.60
        this.maxRenderScale = 1.00
        this._lastRenderMs = null
        this._emaFrameMs = 0
        this._lastScaleAdjustMs = 0

        if(this.game.debug.active)
        {
            this.debugPanel = this.game.debug.panel.addFolder({
                title: '📸 Rendering',
                expanded: false,
            })
        }
    }

    static isQueryFlagEnabled(name)
    {
        const params = new URLSearchParams(location.search)
        const target = name.toLowerCase()
        let enabled = false
        for(const [ key, rawValue ] of params.entries())
        {
            if(key.toLowerCase() === target)
            {
                const value = rawValue.trim().toLowerCase()
                enabled = value === '' || value === '1' || value === 'true'
            }
        }
        return enabled
    }

    // `?webgl` forces the WebGL2 backend; `?webgpu` overrides the mobile WebGL2 default
    static isWebGLForced()
    {
        return Rendering.isQueryFlagEnabled('webgl')
    }

    static isWebGPUForced()
    {
        return Rendering.isQueryFlagEnabled('webgpu')
    }

    static shouldForceWebGL()
    {
        if(Rendering.isWebGLForced())
            return true
        if(Rendering.isWebGPUForced())
            return false
        return Quality.isMobile()
    }

    start()
    {
        this.setStats()

        this.game.ticker.events.on('tick', () =>
        {
            this.render()
        }, 998)

        this.game.viewport.events.on('change', () =>
        {
            this.resize()
        })
    }

    async setRenderer()
    {
        this.renderer = new THREE.WebGPURenderer({
            canvas: this.game.canvasElement,
            powerPreference: 'high-performance',
            forceWebGL: Rendering.shouldForceWebGL(),
            trackTimestamp: PerfProbe.wantsGpuTimer(), // GPU time for window.__perf (opt-in, see PerfProbe)
            antialias: this.game.viewport.pixelRatio < 2
        })
        this.renderer.setSize(this.game.viewport.width, this.game.viewport.height)
        this.applyPixelRatio()
        this.renderer.sortObjects = false

        this.renderer.domElement.classList.add('experience')
        this.renderer.shadowMap.enabled = true
        // this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
        this.renderer.setOpaqueSort((a, b) =>
        {
            return a.renderOrder - b.renderOrder
        })
        this.renderer.setTransparentSort((a, b) =>
        {
            return a.renderOrder - b.renderOrder
        })

        if(__DEV_TOOLS__ && location.hash.match(/inspector/i))
        {
            const { Inspector } = await import('three/addons/inspector/Inspector.js')
            this.renderer.inspector = new Inspector()
        }

        if(this.game.canvasElement)
        {
            this.game.canvasElement.addEventListener('webglcontextlost', (event) =>
            {
                event.preventDefault()
                console.warn('[Rendering] WebGL context lost')
                this.game.ui?.announcer?.announce?.('Contexto gráfico perdido; tentando recuperar...')
            })
            this.game.canvasElement.addEventListener('webglcontextrestored', () =>
            {
                console.info('[Rendering] WebGL context restored')
                this.game.ui?.announcer?.announce?.('Contexto gráfico restaurado')
            })
        }

        // Make the renderer control the ticker
        this.renderer.setAnimationLoop((elapsedTime) => { this.game.ticker.update(elapsedTime) })

        await this.renderer.init()
        this.backendName = this.renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2'
        return this.renderer
    }

    setPostprocessing()
    {
        this.postProcessing = new THREE.RenderPipeline(this.renderer)

        const scenePass = pass(this.game.scene, this.game.view.camera)
        const scenePassColor = scenePass.getTextureNode('output')

        this.bloomPass = bloom(scenePassColor)
        this.bloomPass._nMips = this.game.quality.level === 0 ? 5 : 2
        this.bloomPass.threshold.value = 1
        this.bloomPass.strength.value = 0.25
        this.bloomPass.smoothWidth.value = 1

        this.cheapDOFPass = cheapDOF(renderOutput(scenePass))

        // Quality
        const qualityChange = (level) =>
        {
            this.bloomPass._nMips = level === 0 ? 5 : 2

            if(level === 0)
            {
                this.postProcessing.outputNode = this.cheapDOFPass.add(this.bloomPass)
                if(!Quality.isMobile())
                    this.renderScale = 1.0
            }
            else if(level === 1)
            {
                this.postProcessing.outputNode = scenePassColor.add(this.bloomPass)
            }
            else // Q2: no bloom, lower max render scale
            {
                this.postProcessing.outputNode = scenePassColor
                this.renderScale = Math.min(this.renderScale, 0.85)
            }

            this.applyPixelRatio()
            this.postProcessing.needsUpdate = true
        }
        qualityChange(this.game.quality.level)
        this.game.quality.events.on('change', qualityChange)

        // Debug
        if(this.game.debug.active)
        {
            const bloomPanel = this.debugPanel.addFolder({
                title: 'bloom',
                expanded: false,
            })

            bloomPanel.addBinding(this.bloomPass.threshold, 'value', { label: 'threshold', min: 0, max: 2, step: 0.01 })
            bloomPanel.addBinding(this.bloomPass.strength, 'value', { label: 'strength', min: 0, max: 3, step: 0.01 })
            bloomPanel.addBinding(this.bloomPass.radius, 'value', { label: 'radius', min: 0, max: 1, step: 0.01 })
            bloomPanel.addBinding(this.bloomPass.smoothWidth, 'value', { label: 'smoothWidth', min: 0, max: 1, step: 0.01 })

            const blurPanel = this.debugPanel.addFolder({
                title: 'blur',
                expanded: true,
            })

            blurPanel.addBinding(this.cheapDOFPass.start, 'value', { label: 'start', min: 0, max: 0.5, step: 0.001 })
            blurPanel.addBinding(this.cheapDOFPass.end, 'value', { label: 'end', min: 0, max: 0.5, step: 0.001 })
            // blurPanel.addBinding(this.cheapDOFPass.size, 'value', { label: 'size', min: 1, max: 5, step: 1 })
            // blurPanel.addBinding(this.cheapDOFPass.separation, 'value', { label: 'separation', min: 0, max: 5, step: 0.001 })
            blurPanel.addBinding(this.cheapDOFPass.repeats, 'value', { label: 'repeats', min: 1, max: 100, step: 1 })
            blurPanel.addBinding(this.cheapDOFPass.amount, 'value', { label: 'amount', min: 0, max: 0.02, step: 0.0001 })
        }
    }

    setStats()
    {
        if(!location.hash.match(/stats/i))
            return
            
        this.stats = {}
        this.stats.feed = {}
        this.stats.update = () =>
        {
            this.stats.feed.drawCalls = this.renderer.info.render.drawCalls.toLocaleString()
            this.stats.feed.triangles = this.renderer.info.render.triangles.toLocaleString()
            this.stats.feed.geometries = this.renderer.info.memory.geometries.toLocaleString()
            this.stats.feed.textures = this.renderer.info.memory.textures.toLocaleString()
        }

        this.stats.update()

        // Debug
        if(this.game.debug.active)
        {
             const debugPanel = this.debugPanel.addFolder({
                title: 'Stats',
                expanded: true,
            })

            for(const feedName in this.stats.feed)
            {
                debugPanel.addBinding(this.stats.feed, feedName, { readonly: true })
            }
        }
    }

    getEffectivePixelRatio()
    {
        const baseDpr = this.game.viewport?.pixelRatio || 1
        return Math.max(0.5, Number((baseDpr * this.renderScale).toFixed(3)))
    }

    applyPixelRatio()
    {
        if(!this.renderer || !this.game.viewport)
            return
        this.renderer.setPixelRatio(this.getEffectivePixelRatio())
    }

    updateDynamicResolution(dtMs, nowMs)
    {
        const level = this.game.quality?.level ?? 0
        const allowDynamic = Quality.isMobile() || level >= 1
        if(!allowDynamic || !this.game.ready || this.game.paused)
            return
        if(typeof dtMs !== 'number' || !Number.isFinite(dtMs) || dtMs <= 0)
            return

        const clampedDt = Math.min(dtMs, 100)
        const effectiveDt = this.game.quality?.syntheticFrameMs !== null && this.game.quality?.syntheticFrameMs !== undefined
            ? this.game.quality.syntheticFrameMs
            : clampedDt
        this._emaFrameMs = this._emaFrameMs ? (this._emaFrameMs * 0.9 + effectiveDt * 0.1) : effectiveDt

        if(nowMs - this._lastScaleAdjustMs < 500)
            return

        const maxScale = level >= 2 ? 0.85 : this.maxRenderScale
        let nextScale = this.renderScale
        if(this._emaFrameMs > 15.5)
            nextScale = Math.max(this.minRenderScale, Number((this.renderScale - 0.05).toFixed(2)))
        else if(this._emaFrameMs < 12.5 && this.renderScale < maxScale)
            nextScale = Math.min(maxScale, Number((this.renderScale + 0.05).toFixed(2)))

        if(Math.abs(nextScale - this.renderScale) >= 0.01)
        {
            this.renderScale = nextScale
            this._lastScaleAdjustMs = nowMs
            this.applyPixelRatio()
        }
    }

    resize()
    {
        if(this.game.viewport.width <= 0 || this.game.viewport.height <= 0)
            return

        this.renderer.setSize(this.game.viewport.width, this.game.viewport.height)
        this.applyPixelRatio()
    }

    async render()
    {
        const now = performance.now()
        if(this._lastRenderMs !== null)
        {
            const dtMs = now - this._lastRenderMs
            this.game.quality?.recordFrame(dtMs)
            this.updateDynamicResolution(dtMs, now)
        }
        this._lastRenderMs = now

        // this.renderer.render(this.game.scene, this.game.view.camera)
        this.postProcessing.render()

        if(this.stats)
            this.stats.update()

    }
}