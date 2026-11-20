// Ghost recorder / replayer (plan T0.16). Lazy chunk: only fetched when `?ghost=...` is present.
//
//   ?ghost=rec      records every Inputs action (start / end / change) with the fixed-step index it happened at.
//                   window.__ghost.export() returns the ghost object, .download() saves it as a .json file.
//   ?ghost=<name>   replays game/tools/capture/ghosts/<name>.json: live input is locked, the recorded actions are
//                   injected into Inputs.applyAction() at the START of the matching fixed step (same code path as
//                   the keyboard/gamepad/pointer, not DOM events). Needs `?expose` only to read window.game.
//
// Determinism contract (see docs/PLAN-3D.md 7.2):
// - Physics and gameplay run on Ticker 'fixedTick' (1/120 s, accumulator in Ticker.js), so the step sequence does
//   not depend on the display frame rate. Ghost time is the fixed-step index: t = step / 120.
// - Math.random is replaced while a ghost is active. Calls made INSIDE a fixed step draw from a stream re-seeded
//   per step (seedrandom(SEED + ':' + step)), so gameplay randomness is frame-rate independent. Calls outside a
//   fixed step (render, DOM handlers) use a separate stream. Gameplay must therefore only use Math.random from
//   'fixedTick' listeners (not from DOM event handlers) and must not use wall-clock time (Date.now, performance.now).
// - Rapier is deterministic for the same wasm and the same sequence of calls.
//
// Ghost file: { v: 1, dt: 0.008333.., seed, steps, events: [ { t, action, value, trigger, toggle? } ] }
// (a bare array of events is accepted too; then `steps` = last event step + 120). `trigger` defaults as in
// Inputs.applyAction. `t` is in seconds and must be a multiple of 1/120.
import seedrandom from 'seedrandom'
import { Game } from './Game.js'
import { Ticker } from './Ticker.js'

const DT = Ticker.FIXED_DELTA
const SEED = 'timeline-ghost-v1'

// Ghost JSON files are bundled lazily outside production only (`__DEBUG_PANEL__`); gates use the debug build.
const bundled = __DEBUG_PANEL__ ? import.meta.glob('../../tools/capture/ghosts/*.json', { import: 'default' }) : {}

const round6 = (value) => Math.round(value * 1e6) / 1e6

export class Ghost
{
    constructor(mode)
    {
        this.game = Game.getInstance()
        this.mode = mode === 'rec' ? 'rec' : 'play'
        this.name = this.mode === 'rec' ? null : mode
        this.step = 0 // completed fixed steps since begin()
        this.running = false
        this.finished = false
        this.error = null
        this.data = null
        this.cursor = 0
        this.recorded = []
        this.result = null // snapshot of every dynamic body after the last replayed step

        this.frameRandom = seedrandom(SEED + ':frame')
        this.stepRandom = seedrandom(SEED + ':0')
        this.inStep = false
        this.nativeRandom = Math.random
        Math.random = () => (this.inStep ? this.stepRandom() : this.frameRandom())

        // Live input is ignored while replaying (also before the ghost JSON has loaded)
        if(this.mode === 'play')
            this.game.inputs.locked = true

        this.game.ticker.events.on('fixedTick', () => this.beforeStep(), 0)
        this.game.ticker.events.on('fixedTick', () => this.afterStep(), 1000)

        Object.defineProperty(window, '__ghost', { value: this, configurable: true })
    }

    async load()
    {
        if(this.mode !== 'play')
            return

        try
        {
            const key = `../../tools/capture/ghosts/${this.name}.json`
            let raw
            if(bundled[key])
                raw = await bundled[key]()
            else
            {
                const response = await fetch(`./ghosts/${this.name}.json`)
                if(!response.ok)
                    throw new Error(`ghost "${this.name}" not found`)
                raw = await response.json()
            }
            this.data = Ghost.normalize(raw)
        }
        catch(error)
        {
            this.error = String(error?.message ?? error)
            this.game.inputs.locked = false
            console.error('[ghost]', this.error)
        }
    }

    static normalize(raw)
    {
        const source = Array.isArray(raw) ? { events: raw } : raw
        const events = source.events
            .map((event) => ({ ...event, step: Math.round(event.t / DT) }))
            .sort((a, b) => a.step - b.step) // stable: keeps same-step order
        const last = events.length ? events[events.length - 1].step : 0
        return { v: 1, steps: source.steps ?? last + Math.round(1 / DT), events }
    }

    // Called synchronously at the end of Game.init, right before `ready`: the first physics step comes after this.
    begin()
    {
        this.step = 0
        this.cursor = 0
        this.finished = false
        this.result = null
        this.frameRandom = seedrandom(SEED + ':frame')

        if(this.mode === 'rec')
        {
            this.recorded = []
            this.game.inputs.onAction = (action, trigger, value, toggle) =>
            {
                const event = { t: round6(this.step * DT), action, value: typeof value === 'object' && value ? { ...value } : value, trigger }
                if(!toggle)
                    event.toggle = false
                this.recorded.push(event)
            }
            this.running = true
        }
        else if(this.data)
            this.running = true
    }

    beforeStep()
    {
        if(!this.running)
            return

        this.inStep = true
        this.stepRandom = seedrandom(`${SEED}:${this.step}`)

        if(this.mode !== 'play')
            return

        // Inject the events of this step, then (once everything has been played) take the final snapshot
        const events = this.data.events
        while(this.cursor < events.length && events[this.cursor].step <= this.step)
        {
            const event = events[this.cursor++]
            if(!this.game.inputs.applyAction(event.action, event.trigger, event.value, event.toggle !== false))
                console.warn('[ghost] unknown action', event.action)
        }

        if(this.step >= this.data.steps)
        {
            this.result = this.snapshot()
            this.finished = true
            this.running = false
            this.inStep = false
            this.game.inputs.locked = false
        }
    }

    afterStep()
    {
        if(!this.running)
            return

        this.inStep = false
        this.step++
    }

    // Every non-fixed body, in creation order: positions in metres, rotation as a quaternion
    snapshot()
    {
        const bodies = []
        for(const physical of this.game.physics.physicals)
        {
            if(physical.type === 'fixed')
                continue
            const p = physical.body.translation()
            const q = physical.body.rotation()
            bodies.push({ p: [ p.x, p.y, p.z ], q: [ q.x, q.y, q.z, q.w ] })
        }
        return { step: this.step, bodies }
    }

    export()
    {
        return { v: 1, dt: DT, seed: SEED, steps: this.step, events: this.recorded.map((event) => ({ ...event })) }
    }

    stop()
    {
        this.running = false
        this.game.inputs.onAction = null
        return this.export()
    }

    download(name = 'ghost')
    {
        const blob = new Blob([ JSON.stringify(this.export(), null, 1) ], { type: 'application/json' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `${name}.json`
        link.click()
        setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    }
}
