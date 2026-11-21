import { Game } from '../Game.js'
import { Events } from '../Events.js'

const TRANSITION_DURATION_MS = 3200
const REDUCED_MOTION_DURATION_MS = 280
const STYLE_ID = 'vn-era-transition-style'

const ERA_LABELS = {
    origens: { title: 'Origens', years: '1994–2011', subtitle: 'Araguaína / TO' },
    unicamp: { title: 'UNICAMP', years: '2012–2014', subtitle: 'Campinas / SP' },
    industria: { title: 'Indústria', years: '2017–2019', subtitle: 'Coca-Cola FEMSA' },
    alemanha: { title: 'Alemanha', years: '2018', subtitle: 'Estágio KRONES AG' },
    dados: { title: 'Dados', years: '2019–2021', subtitle: 'Tocantins & IBM' },
    transformacao: { title: 'Transformação Digital', years: '2022–hoje', subtitle: 'Projetos & SEBRAE' },
    hub: { title: 'Ponto Final', years: 'Hub', subtitle: 'Vamos conversar' },
}

function ensureTransitionStyles()
{
    if(typeof document === 'undefined' || document.getElementById(STYLE_ID))
        return

    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
        .vn-era-transition {
            position: fixed;
            inset: 0;
            z-index: 55;
            display: grid;
            place-items: center;
            background: rgba(246, 241, 231, 0.96);
            color: #0a0a0a;
            opacity: 0;
            pointer-events: none;
            transition: opacity 240ms ease-out;
        }
        .vn-era-transition.is-visible {
            opacity: 1;
            pointer-events: auto;
        }
        .is-reduced-motion .vn-era-transition {
            transition: none;
        }
        .vn-era-transition-card {
            text-align: center;
            padding: 28px 36px;
            border: 3px solid #0a0a0a;
            background: #fffdf8;
            box-shadow: 6px 6px 0 #f50000;
            max-width: min(420px, 88vw);
        }
        .vn-era-transition-years {
            display: block;
            font-size: 0.8rem;
            font-weight: 700;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            color: #f50000;
        }
        .vn-era-transition-title {
            margin: 6px 0 4px;
            font-size: 1.75rem;
            font-weight: 800;
        }
        .vn-era-transition-sub {
            margin: 0;
            font-size: 0.95rem;
            opacity: 0.78;
        }
        .vn-era-transition-hint {
            display: block;
            margin-top: 14px;
            font-size: 0.75rem;
            opacity: 0.6;
        }
    `
    document.head.appendChild(style)
}

/**
 * Full-ring era transition controller (T3.X1).
 * Plays a ~3.2s skippable (Space/Esc/click) transition while ZoneStreamer
 * loads the target era, disposes distant zones, and updates EraCycles.
 */
export class Transitions
{
    constructor(world = null)
    {
        this.game = Game.getInstance()
        this.world = world || this.game?.world || null
        this.events = new Events()

        this.active = false
        this.targetEra = null
        this._skipResolve = null
        this._timer = null
        this._overlay = null
        this._disposed = false

        this._onKeyDown = (event) =>
        {
            if(!this.active)
                return
            if(event.code === 'Space' || event.code === 'Escape')
            {
                event.preventDefault()
                this.skip()
            }
        }
        this._onPointerDown = () =>
        {
            if(this.active)
                this.skip()
        }

        if(typeof window !== 'undefined')
        {
            window.addEventListener('keydown', this._onKeyDown)
            window.addEventListener('pointerdown', this._onPointerDown)
        }
    }

    _ensureOverlay()
    {
        if(typeof document === 'undefined')
            return null

        ensureTransitionStyles()
        if(!this._overlay)
        {
            const el = document.createElement('div')
            el.className = 'vn-era-transition'
            el.setAttribute('role', 'status')
            el.setAttribute('aria-live', 'polite')
            el.innerHTML = `
                <div class="vn-era-transition-card">
                    <span class="vn-era-transition-years js-tr-years"></span>
                    <h2 class="vn-era-transition-title js-tr-title"></h2>
                    <p class="vn-era-transition-sub js-tr-sub"></p>
                    <span class="vn-era-transition-hint">Espaço, Esc ou clique para pular</span>
                </div>
            `
            document.body.appendChild(el)
            this._overlay = el
        }
        return this._overlay
    }

    skip()
    {
        if(this._timer)
        {
            clearTimeout(this._timer)
            this._timer = null
        }
        if(this._skipResolve)
        {
            const resolve = this._skipResolve
            this._skipResolve = null
            resolve()
        }
    }

    async transitionTo(targetName, options = {})
    {
        const key = String(targetName || '').trim().toLowerCase()
        const streamer = this.world?.zoneStreamer
        if(!streamer || !streamer.zones.has(key))
            return null

        if(this.active)
            this.skip()

        this.active = true
        this.targetEra = key
        this.events.trigger('start', [ key ])

        const immediate = Boolean(options.immediate)
        const reduced = Boolean(this.game?.reducedMotion || this.game?.ui?.options?.reducedMotion)
        const durationMs = immediate ? 0 : (reduced ? REDUCED_MOTION_DURATION_MS : TRANSITION_DURATION_MS)

        const overlay = !immediate ? this._ensureOverlay() : null
        if(overlay)
        {
            const meta = ERA_LABELS[key] || { title: key, years: '', subtitle: '' }
            overlay.querySelector('.js-tr-years').textContent = meta.years
            overlay.querySelector('.js-tr-title').textContent = meta.title
            overlay.querySelector('.js-tr-sub').textContent = meta.subtitle
            overlay.classList.add('is-visible')
        }

        const waitPromise = durationMs > 0
            ? new Promise((resolve) =>
            {
                this._skipResolve = resolve
                this._timer = setTimeout(() =>
                {
                    this._timer = null
                    this._skipResolve = null
                    resolve()
                }, durationMs)
            })
            : Promise.resolve()

        const loadPromise = streamer.goToEra(key)

        const [ era ] = await Promise.all([ loadPromise, waitPromise ])

        if(overlay)
            overlay.classList.remove('is-visible')

        this.active = false
        this.targetEra = null
        this.events.trigger('complete', [ key, era ])
        return era
    }

    dispose()
    {
        if(this._disposed)
            return
        this._disposed = true
        this.skip()

        if(typeof window !== 'undefined')
        {
            window.removeEventListener('keydown', this._onKeyDown)
            window.removeEventListener('pointerdown', this._onPointerDown)
        }
        if(this._overlay)
        {
            this._overlay.remove()
            this._overlay = null
        }
    }
}
