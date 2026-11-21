// Reduced to the uniforms read by MeshDefaultMaterial (and Grid later) + update().
// Upstream also drove the intro reveal steps (intro, grid, audio, server, menu): removed.
// `distance` starts huge so nothing is discarded; Phase 2 reintroduces a reveal animation.
import gsap from 'gsap'
import { color, uniform, vec2 } from 'three/tsl'
import { Game } from './Game.js'

export class Reveal
{
    constructor()
    {
        this.game = Game.getInstance()

        const respawn = this.game.respawns.getDefault()
        this.position = respawn.position.clone()
        this.position2Uniform = uniform(vec2(this.position.x, this.position.z))
        this.distance = uniform(0)
        this.thickness = uniform(0.12)
        this.color = uniform(color('#f50000'))
        this.intensity = uniform(5.5)
        this.intensityMultiplier = 1

        this.startedAtMs = null
        this.completedAtMs = null
        this.controlReadyAtMs = null
        this.waveCancelled = false
        this.mode = 'radial'
        this._tween = null
        this._waveCancelBound = false

        if(this.game.debug.active)
        {
            this.debugPanel = this.game.debug.panel.addFolder({
                title: '📜 Reveal',
                expanded: false,
            })

            this.debugPanel.addBinding(this.distance, 'value', { label: 'distance', min: 0, max: 120, step: 0.01 })
            this.debugPanel.addBinding(this.thickness, 'value', { label: 'thickness', min: 0, max: 1, step: 0.001 })
            this.debugPanel.addBinding(this.intensity, 'value', { label: 'intensity', min: 1, max: 20, step: 0.001 })
        }

        this.update = this.update.bind(this)
        this.game.ticker.events.on('tick', this.update, 10)
        this.exposeState()
    }

    exposeState()
    {
        if(typeof window === 'undefined')
            return
        window.__reveal = {
            startedAtMs: this.startedAtMs,
            completedAtMs: this.completedAtMs,
            controlReadyAtMs: this.controlReadyAtMs,
            mode: this.mode,
            waveCancelled: this.waveCancelled,
        }
    }

    dismissLoader(reducedMotion)
    {
        if(typeof document === 'undefined')
            return
        const loader = document.querySelector('.js-loader')
        if(!loader)
            return

        loader.classList.add('is-complete')
        loader.classList.add('is-fading')
        const delay = reducedMotion ? 20 : 320
        setTimeout(() =>
        {
            loader.classList.add('is-done')
            loader.setAttribute('aria-hidden', 'true')
        }, delay)
    }

    bindCancelableWave()
    {
        if(this._waveCancelBound)
            return
        this._waveCancelBound = true

        const cancelWave = () =>
        {
            const visual = this.game.world?.player?.visual
            if(visual && visual.overrideState === 'wave')
            {
                visual.overrideState = null
                visual.overrideTimer = 0
                this.waveCancelled = true
                this.exposeState()
            }
        }

        this.game.inputs?.events?.on('action', cancelWave)
        if(typeof window !== 'undefined')
        {
            window.addEventListener('keydown', cancelWave, { passive: true })
            this.game.canvasElement?.addEventListener('pointerdown', cancelWave, { passive: true })
        }
    }

    start({ instant = false } = {})
    {
        const reducedMotion = Boolean(this.game.ui?.options?.reducedMotion)
        this.mode = (instant || reducedMotion) ? 'fade' : 'radial'

        const respawn = this.game.respawns?.getDefault?.()
        const playerPos = this.game.world?.player?.controller?.body?.translation?.() || respawn?.position
        if(playerPos)
        {
            this.position.set(playerPos.x, playerPos.y, playerPos.z)
            this.position2Uniform.value.set(playerPos.x, playerPos.z)
        }

        this.startedAtMs = Math.round(performance.now())
        this.controlReadyAtMs = this.startedAtMs
        this.dismissLoader(reducedMotion || instant)

        // Trigger cancelable welcome wave on Victor (unless reducedMotion or instant)
        const visual = this.game.world?.player?.visual
        if(visual && !reducedMotion && !instant)
        {
            visual.trigger('wave', 1.2)
            this.bindCancelableWave()
        }

        if(this._tween)
        {
            this._tween.kill()
            this._tween = null
        }

        if(instant || reducedMotion)
        {
            this.distance.value = 99999
            this.completedAtMs = Math.round(performance.now())
            this.exposeState()
            return
        }

        this.distance.value = 0
        this._tween = gsap.to(this.distance, {
            value: 95,
            duration: 0.72,
            ease: 'power2.out',
            onComplete: () =>
            {
                this.distance.value = 99999
                this.completedAtMs = Math.round(performance.now())
                this._tween = null
                this.exposeState()
            },
        })

        this.exposeState()
    }

    update()
    {
        this.color.value.copy(this.game.dayCycles.properties.revealColor.value)
        this.intensity.value = this.game.dayCycles.properties.revealIntensity.value * this.intensityMultiplier
    }
}
