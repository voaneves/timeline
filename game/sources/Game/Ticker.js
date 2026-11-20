import { uniform } from 'three/tsl'
import { Events } from './Events.js'
import { Game } from './Game.js'
import gsap from 'gsap'

export class Ticker
{
    static FIXED_DELTA = 1 / 120

    constructor()
    {
        this.game = Game.getInstance()

        this.elapsed = 0
        this.delta = 1 / 60
        this.maxDelta = 1 / 30
        this.scale = 2
        this.deltaScaled = this.delta * this.scale
        this.elapsedScaled = 0
        this.waits = []
        this.lastDeltas = []

        // Fixed step (plan T0.16): physics and gameplay run on 'fixedTick' at a constant 1/120 s of real time
        // (1/60 s of scaled/world time at scale 2), independent of the display frame rate. 'tick' stays per frame
        // (rendering, camera, visuals). `fixedSteps` counts completed fixed steps since boot.
        this.fixedDelta = Ticker.FIXED_DELTA
        this.fixedSteps = 0
        this.accumulator = 0
        this.inFixedStep = false // true while 'fixedTick' listeners run (reset in a finally, even if a listener throws)
        this.alpha = 0 // accumulator / fixedDelta after the steps of the frame: render interpolation factor (0..1)

        this.elapsedUniform = uniform(this.elapsed)
        this.deltaUniform = uniform(this.delta)
        this.elapsedScaledUniform = uniform(this.elapsedScaled)
        this.deltaScaledUniform = uniform(this.deltaScaled)

        this.events = new Events()
    }

    update(elapsed)
    {
        const elapsedSeconds = elapsed / 1000
        this.delta = Math.min(elapsedSeconds - this.elapsed, this.maxDelta)
        this.elapsed = elapsedSeconds
        this.deltaScaled = this.delta * this.scale
        this.elapsedScaled += this.deltaScaled

        this.lastDeltas.unshift(this.delta)
        const arrayLength = this.lastDeltas.length
        const count = 30
        if(arrayLength > count)
        {
            this.lastDeltas.splice(count, arrayLength - count)
        }
        this.deltaAverage = this.lastDeltas.reduce((total, value) => total + value) / arrayLength


        this.elapsedUniform.value = this.elapsed
        this.deltaUniform.value = this.delta
        this.elapsedScaledUniform.value = this.elapsedScaled
        this.deltaScaledUniform.value = this.deltaScaled

        // Fixed steps: delta is capped at maxDelta (1/30), so at most 4-5 steps per frame, never a spiral of death.
        // The step sequence (not the number of steps per frame) is what matters, hence the frame-rate independence.
        this.accumulator += this.delta
        while(this.accumulator >= this.fixedDelta - 1e-9)
        {
            this.inFixedStep = true
            try
            {
                this.events.trigger('fixedTick')
            }
            finally
            {
                this.inFixedStep = false
            }
            this.fixedSteps++
            this.accumulator -= this.fixedDelta
        }
        // Slightly negative after the 1e-9 tolerance: clamp. Render-only, never read by the simulation.
        this.alpha = Math.min(Math.max(this.accumulator / this.fixedDelta, 0), 1)

        for(let i = 0; i < this.waits.length; i++)
        {
            const wait = this.waits[i]
            wait[0]--

            if(wait[0] === 0)
            {
                wait[1]()
                this.waits.splice(i, 1)
                i--
            }
        }
        
        this.events.trigger('tick')
    }

    // Read by Physics inside 'fixedTick', after Time has updated `scale` for this step (Time, order 0).
    get fixedDeltaScaled()
    {
        return this.fixedDelta * this.scale
    }

    wait(frames, callback)
    {
        this.waits.push([ frames, callback ])
    }
}