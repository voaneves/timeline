import { Events } from '../Events.js'
import { Game } from '../Game.js'
import mapSvg from './map.svg?raw'

export const MAP_ZONES = [
    { id: 'origens', eraId: 'origens', name: 'Origens', years: '1994–2011', x: 50, y: 16 },
    { id: 'unicamp', eraId: 'unicamp', name: 'UNICAMP', years: '2012–2014', x: 79, y: 28 },
    { id: 'industria', eraId: 'industria', name: 'Indústria', years: '2017–2019', x: 84, y: 56 },
    { id: 'alemanha', eraId: 'alemanha', name: 'Alemanha', years: '2018', x: 68, y: 82 },
    { id: 'dados', eraId: 'dados', name: 'Dados', years: '2019–2021', x: 32, y: 82 },
    { id: 'transformacao', eraId: 'ia', name: 'Transformação Digital', years: '2021–Atual', x: 16, y: 56 },
    { id: 'hub', eraId: 'hub', name: 'Hub / Ponto Final', years: 'Contato', x: 21, y: 28 },
]

/**
 * Accessible cordel-style ring teleport map `<dialog>` (T4.2).
 * Opened via `M` key or "Mapa" button, navigable by keyboard and single-pointer tap/click.
 */
export class MapDialog
{
    constructor(cards = null)
    {
        this.game = Game.getInstance()
        this.cards = cards || this.game?.cards || null
        this.events = new Events()
        this.zones = MAP_ZONES
        this.activeZoneId = 'origens'
        this._restoreByPointer = false

        this.buildDialog()
        this.bindEvents()
    }

    buildDialog()
    {
        const root = this.game?.domElement || document.body

        this.dialog = document.createElement('dialog')
        this.dialog.className = 'vn-dialog vn-map-dialog js-map-dialog'
        this.dialog.setAttribute('aria-labelledby', 'vn-map-title')
        this.dialog.innerHTML = `
            <article class="vn-card vn-map-card">
                <header class="vn-card-header">
                    <div>
                        <span class="vn-card-badge">Anel da Linha do Tempo</span>
                        <h2 id="vn-map-title" class="vn-card-title" tabindex="-1">Mapa de Eras</h2>
                    </div>
                    <button type="button" class="vn-btn vn-icon-btn js-map-close" aria-label="Fechar mapa">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>
                <div class="vn-map-body">
                    <div class="vn-map-stage js-map-stage">
                        <div class="vn-map-art">${mapSvg}</div>
                        <nav class="vn-map-zones js-map-zones" aria-label="Zonas da linha do tempo"></nav>
                    </div>
                </div>
                <footer class="vn-card-footer">
                    <span class="vn-card-hint">Tab ou setas para escolher · Enter para ir · Esc ou M para fechar</span>
                    <button type="button" class="vn-btn vn-btn-primary js-map-done">Fechar</button>
                </footer>
            </article>
        `
        root.appendChild(this.dialog)

        this.headingEl = this.dialog.querySelector('#vn-map-title')
        this.closeBtn = this.dialog.querySelector('.js-map-close')
        this.doneBtn = this.dialog.querySelector('.js-map-done')
        this.zonesNav = this.dialog.querySelector('.js-map-zones')
        this.zoneButtons = []

        for(let i = 0; i < this.zones.length; i++)
        {
            const zone = this.zones[i]
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'vn-map-zone-btn js-map-zone'
            btn.dataset.zoneId = zone.id
            btn.dataset.eraId = zone.eraId
            btn.style.setProperty('--map-x', `${zone.x}%`)
            btn.style.setProperty('--map-y', `${zone.y}%`)
            btn.setAttribute('aria-label', `${zone.name} (${zone.years})`)
            btn.innerHTML = `
                <span class="vn-map-zone-name">${zone.name}</span>
                <span class="vn-map-zone-years">${zone.years}</span>
            `
            btn.addEventListener('click', (event) => this.selectZone(zone, event.detail > 0))
            btn.addEventListener('keydown', (event) => this.onZoneKeyDown(event, i))
            this.zonesNav.appendChild(btn)
            this.zoneButtons.push(btn)
        }

        this.syncActiveZone()
    }

    bindEvents()
    {
        this.closeBtn.addEventListener('click', (event) => this.close(event.detail > 0))
        this.doneBtn.addEventListener('click', (event) => this.close(event.detail > 0))

        this.dialog.addEventListener('click', (event) =>
        {
            if(event.target === this.dialog)
                this.close(true)
        })

        this.dialog.addEventListener('cancel', (event) =>
        {
            event.preventDefault()
            this.close(false)
        })

        this.dialog.addEventListener('close', () =>
        {
            this._restoreByPointer = false
            this.events.trigger('close')
        })

        window.addEventListener('keydown', (event) =>
        {
            if(event.code === 'Escape' && this.dialog.open)
            {
                event.preventDefault()
                this.close(false)
                return
            }

            if(event.code !== 'KeyM' || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
                return
            const target = event.target
            if(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable))
                return

            if(this.dialog.open)
            {
                event.preventDefault()
                this.close(false)
                return
            }

            if(document.querySelector('dialog[open]'))
                return

            event.preventDefault()
            this.open()
        })
    }

    onZoneKeyDown(event, index)
    {
        let delta = 0
        if(event.key === 'ArrowRight' || event.key === 'ArrowDown')
            delta = 1
        else if(event.key === 'ArrowLeft' || event.key === 'ArrowUp')
            delta = -1

        if(delta === 0)
            return

        event.preventDefault()
        const nextIndex = (index + delta + this.zoneButtons.length) % this.zoneButtons.length
        this.zoneButtons[nextIndex]?.focus()
    }

    syncActiveZone()
    {
        const current = this.game?.world?.zoneStreamer?.activeZone || this.activeZoneId
        for(const btn of this.zoneButtons)
        {
            const isActive = btn.dataset.zoneId === current || btn.dataset.eraId === current
            btn.classList.toggle('is-active', isActive)
            if(isActive)
                btn.setAttribute('aria-current', 'location')
            else
                btn.removeAttribute('aria-current')
        }
    }

    open()
    {
        this.cards?.closeOtherDialogs?.(this.dialog)
        this.cards?.releaseGameInputs?.()
        this.syncActiveZone()

        if(!this.dialog.open)
            this.dialog.showModal()

        this.headingEl.focus({ preventScroll: true })
        this.cards?.announcer?.announce('Mapa de eras aberto')
        this.events.trigger('open')
        return true
    }

    close(byPointer = false)
    {
        if(!this.dialog.open)
            return
        this._restoreByPointer = Boolean(byPointer)
        this.dialog.close()
        this.cards?.restoreCanvasFocus?.(this._restoreByPointer)
    }

    selectZone(zone, byPointer = false)
    {
        this.activeZoneId = zone.id
        this.syncActiveZone()

        this.game?.world?.zoneStreamer?.goToEra?.(zone.eraId)
        window.dispatchEvent(new CustomEvent('timeline:teleportEra', {
            detail: { id: zone.id, eraId: zone.eraId, name: zone.name },
        }))
        this.cards?.announcer?.announce(`Teletransportando para ${zone.name}`)
        this.events.trigger('teleport', [ zone ])
        this.close(byPointer)
    }
}
