
import { Game } from './Game.js'
import gsap from 'gsap'
import { clamp, remap } from './utilities/maths.js'

export class Time
{
    constructor()
    {
        this.game = Game.getInstance()

        this.defaultScale = 2
        this._scale = this.defaultScale
        this.game.ticker.scale = this.scale
        gsap.globalTimeline.timeScale(this.scale)

        this.setBulletTime()

        // Time scale is part of the simulation (Physics reads it every step), so it is driven by fixed steps, never by
        // the frame delta or the wall clock: same step sequence => same scale sequence at any display frame rate.
        // Order 0: before Physics (3) so the step that is about to run already uses this step's scale.
        this.game.ticker.events.on('fixedTick', () =>
        {
            this.update()
        }, 0)

        // Debug
        if(this.game.debug.active)
        {
            this.debugPanel = this.game.debug.panel.addFolder({
                title: '⏱️ Time',
                expanded: false,
            })
            this.debugPanel.addBinding(this, 'defaultScale', { min: 0, max: 5, step: 0.01 })
            this.debugPanel.addButton({ title: 'bullet time' }).on('click', () => { this.bulletTime.activate() })
        }
    }

    // Bullet time lasts `duration` seconds of REAL time, counted in fixed steps (1 step = Ticker.FIXED_DELTA s)
    // Disabled while a ghost is active (record or replay): activation then depends on wall-clock/DOM timing
    setBulletTime()
    {
        this.bulletTime = {}
        this.bulletTime.active = false
        this.bulletTime.endStep = 0 // ticker.fixedSteps value at which it ends
        this.bulletTime.scale = 0.5
        this.bulletTime.progress = 0
        this.bulletTime.inSpeed = 3
        this.bulletTime.outSpeed = 0.3
        this.bulletTime.activate = (duration = 1.5) =>
        {
            if(this.game.ghost)
                return

            const ticker = this.game.ticker
            const endStep = ticker.fixedSteps + Math.max(1, Math.round(duration / ticker.fixedDelta))
            this.bulletTime.endStep = this.bulletTime.active ? Math.max(this.bulletTime.endStep, endStep) : endStep
            this.bulletTime.active = true
        }
    }

    // Runs once per fixed step, before the physics step
    update()
    {
        const ticker = this.game.ticker

        if(this.bulletTime.active && ticker.fixedSteps >= this.bulletTime.endStep)
            this.bulletTime.active = false

        const speed = this.bulletTime.active ? this.bulletTime.inSpeed : this.bulletTime.outSpeed
        this.bulletTime.progress += (this.bulletTime.active ? 1 : - 1) * ticker.fixedDelta * speed
        this.bulletTime.progress = clamp(this.bulletTime.progress, 0, 1)

        const scale = remap(this.bulletTime.progress, 0, 1, this.defaultScale, this.bulletTime.scale)
        if(scale !== this._scale)
            this.scale = scale
    }

    set scale(value)
    {
        this._scale = value
        this.game.ticker.scale = this.scale
        gsap.globalTimeline.timeScale(value)
    }

    get scale()
    {
        return this._scale
    }
}