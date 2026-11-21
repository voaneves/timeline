import { Events } from '../Events.js'
import { Game } from '../Game.js'
import { Quality } from '../Quality.js'

const STORAGE_KEY = 'timeline:ui-options'

/**
 * Minimal branded HUD, top-right action bar, and options Menu `<dialog>`.
 */
export class Hud
{
    constructor(cards)
    {
        this.game = Game.getInstance()
        this.cards = cards
        this.events = new Events()

        const firstEra = this.cards?.eras?.[0]
        this.state = {
            eraName: firstEra?.name || 'Origens',
            eraVisited: 0,
            eraTotal: firstEra?.entries?.length || 3,
            signalsCount: 0,
            signalsTotal: 20,
        }

        const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        this.options = {
            quality: 'auto',
            reducedMotion: Boolean(prefersReduced),
            assistMode: false,
            sound: true,
            vibration: true,
            ...this.loadSavedOptions(),
        }

        this._restoreByPointer = false
        this._skipRestoreOnClose = false

        this.buildHud()
        this.buildMenuDialog()
        this.bindEvents()
        this.applyOptions()
        this.renderProgress()
    }

    loadSavedOptions()
    {
        try
        {
            const raw = localStorage.getItem(STORAGE_KEY)
            return raw ? JSON.parse(raw) : {}
        }
        catch
        {
            return {}
        }
    }

    saveOptions()
    {
        try
        {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.options))
        }
        catch {}
    }

    buildHud()
    {
        const root = this.game?.domElement || document.body

        this.header = document.createElement('header')
        this.header.className = 'vn-hud js-hud'
        this.header.setAttribute('aria-label', 'Controles e progresso da linha do tempo')
        this.header.innerHTML = `
            <div class="vn-hud-chip" aria-live="off">
                <span class="vn-hud-dot" aria-hidden="true"></span>
                <span class="vn-hud-era js-hud-era"></span>
                <span class="vn-hud-sep" aria-hidden="true">·</span>
                <span class="vn-hud-signals js-hud-signals"></span>
            </div>
            <nav class="vn-hud-actions" aria-label="Ações rápidas">
                <button type="button" class="vn-hud-btn js-hud-menu" aria-haspopup="dialog">Menu</button>
                <button type="button" class="vn-hud-btn js-hud-sound" aria-pressed="true">Som: Ligado</button>
                <button type="button" class="vn-hud-btn js-hud-list" aria-haspopup="dialog">Lista de marcos</button>
                <a class="vn-hud-btn vn-hud-link js-hud-accessible" href="../#carreira">Versão acessível</a>
            </nav>
        `
        root.appendChild(this.header)

        this.eraEl = this.header.querySelector('.js-hud-era')
        this.signalsEl = this.header.querySelector('.js-hud-signals')
        this.menuBtn = this.header.querySelector('.js-hud-menu')
        this.soundBtn = this.header.querySelector('.js-hud-sound')
        this.listBtn = this.header.querySelector('.js-hud-list')
    }

    buildMenuDialog()
    {
        const root = this.game?.domElement || document.body

        this.menuDialog = document.createElement('dialog')
        this.menuDialog.className = 'vn-dialog vn-menu-dialog js-menu-dialog'
        this.menuDialog.setAttribute('aria-labelledby', 'vn-menu-title')
        this.menuDialog.innerHTML = `
            <article class="vn-card vn-menu-card">
                <header class="vn-card-header">
                    <h2 id="vn-menu-title" class="vn-card-title" tabindex="-1">Menu e opções</h2>
                    <button type="button" class="vn-btn vn-icon-btn js-menu-close" aria-label="Fechar menu">
                        <span aria-hidden="true">×</span>
                    </button>
                </header>
                <div class="vn-menu-body">
                    <div class="vn-menu-cta-row">
                        <button type="button" class="vn-btn vn-btn-signal js-menu-contact">Contato</button>
                        <button type="button" class="vn-btn vn-btn-secondary js-menu-list">Lista de marcos</button>
                    </div>

                    <div class="vn-menu-field">
                        <label class="vn-menu-label" for="vn-quality-select">Qualidade gráfica</label>
                        <select id="vn-quality-select" class="vn-select js-menu-quality">
                            <option value="auto">Auto</option>
                            <option value="0">Alta (Q0)</option>
                            <option value="1">Média (Q1)</option>
                            <option value="2">Baixa (Q2)</option>
                        </select>
                    </div>

                    <label class="vn-toggle-row">
                        <span class="vn-toggle-text">
                            <strong>Movimento reduzido</strong>
                            <small>Suaviza transições e efeitos de câmera</small>
                        </span>
                        <input type="checkbox" class="vn-toggle-input js-opt-reduced-motion">
                    </label>

                    <label class="vn-toggle-row">
                        <span class="vn-toggle-text">
                            <strong>Modo assistência</strong>
                            <small>Pulo infinito e abrir marcos por interação simples</small>
                        </span>
                        <input type="checkbox" class="vn-toggle-input js-opt-assist">
                    </label>

                    <label class="vn-toggle-row">
                        <span class="vn-toggle-text">
                            <strong>Som</strong>
                            <small>Áudio ambiente e efeitos</small>
                        </span>
                        <input type="checkbox" class="vn-toggle-input js-opt-sound">
                    </label>

                    <label class="vn-toggle-row">
                        <span class="vn-toggle-text">
                            <strong>Vibração</strong>
                            <small>Resposta tátil em dispositivos compatíveis</small>
                        </span>
                        <input type="checkbox" class="vn-toggle-input js-opt-vibration">
                    </label>
                </div>
                <footer class="vn-card-footer">
                    <span class="vn-card-hint">Esc para voltar ao mundo 3D</span>
                    <button type="button" class="vn-btn vn-btn-primary js-menu-done">Continuar</button>
                </footer>
            </article>
        `
        root.appendChild(this.menuDialog)

        this.menuHeadingEl = this.menuDialog.querySelector('#vn-menu-title')
        this.menuCloseBtn = this.menuDialog.querySelector('.js-menu-close')
        this.menuDoneBtn = this.menuDialog.querySelector('.js-menu-done')
        this.menuContactBtn = this.menuDialog.querySelector('.js-menu-contact')
        this.menuListBtn = this.menuDialog.querySelector('.js-menu-list')
        this.qualitySelect = this.menuDialog.querySelector('.js-menu-quality')
        this.reducedMotionInput = this.menuDialog.querySelector('.js-opt-reduced-motion')
        this.assistInput = this.menuDialog.querySelector('.js-opt-assist')
        this.soundInput = this.menuDialog.querySelector('.js-opt-sound')
        this.vibrationInput = this.menuDialog.querySelector('.js-opt-vibration')
    }

    bindEvents()
    {
        this.menuBtn.addEventListener('click', () => this.openMenu())
        this.listBtn.addEventListener('click', () => this.cards?.openList())
        this.soundBtn.addEventListener('click', () =>
        {
            this.setOption('sound', !this.options.sound)
            this.cards?.announcer?.announce(this.options.sound ? 'Som ligado' : 'Som desligado')
        })

        this.menuCloseBtn.addEventListener('click', (event) => this.closeMenu(event.detail > 0))
        this.menuDoneBtn.addEventListener('click', (event) => this.closeMenu(event.detail > 0))

        this.menuDialog.addEventListener('click', (event) =>
        {
            if(event.target === this.menuDialog)
                this.closeMenu(true)
        })

        this.menuDialog.addEventListener('cancel', (event) =>
        {
            event.preventDefault()
            this.closeMenu(false)
        })

        this.menuDialog.addEventListener('close', () =>
        {
            const byPointer = this._restoreByPointer
            const skipRestore = this._skipRestoreOnClose
            this._restoreByPointer = false
            this._skipRestoreOnClose = false
            if(!skipRestore)
                this.cards?.restoreCanvasFocus(byPointer)
            this.events.trigger('menuClose')
        })

        this.menuContactBtn.addEventListener('click', () =>
        {
            this._skipRestoreOnClose = true
            if(this.menuDialog.open)
                this.menuDialog.close()
            this.cards?.openContact()
        })

        this.menuListBtn.addEventListener('click', () =>
        {
            this._skipRestoreOnClose = true
            if(this.menuDialog.open)
                this.menuDialog.close()
            this.cards?.openList()
        })

        this.qualitySelect.addEventListener('change', () =>
        {
            this.setOption('quality', this.qualitySelect.value)
        })

        this.reducedMotionInput.addEventListener('change', () =>
        {
            this.setOption('reducedMotion', this.reducedMotionInput.checked)
        })

        this.assistInput.addEventListener('change', () =>
        {
            this.setOption('assistMode', this.assistInput.checked)
        })

        this.soundInput.addEventListener('change', () =>
        {
            this.setOption('sound', this.soundInput.checked)
        })

        this.vibrationInput.addEventListener('change', () =>
        {
            this.setOption('vibration', this.vibrationInput.checked)
        })

        // Update milestone progress automatically when cards are visited
        this.cards?.events?.on('visit', (milestone) =>
        {
            const era = milestone?.era
            if(!era)
                return
            const total = era.entries?.length || 0
            const visited = (era.entries || []).filter((e) => this.cards.visited.has(e.id)).length
            this.setEraProgress(era.name, visited, total)
        })
    }

    openMenu()
    {
        this.cards?.closeOtherDialogs(this.menuDialog)
        this.cards?.releaseGameInputs()
        this.syncMenuControls()

        if(!this.menuDialog.open)
            this.menuDialog.showModal()

        this.menuHeadingEl.focus({ preventScroll: true })
        this.cards?.announcer?.announce('Menu aberto')
        this.events.trigger('menuOpen')
        return true
    }

    closeMenu(byPointer = false)
    {
        if(!this.menuDialog.open)
            return
        this._restoreByPointer = Boolean(byPointer)
        this.menuDialog.close()
    }

    setOption(key, value)
    {
        this.options[key] = value
        this.saveOptions()
        this.applyOptions()
        this.events.trigger('optionChange', [ key, value, { ...this.options } ])
        window.dispatchEvent(new CustomEvent('timeline:option', { detail: { key, value, options: { ...this.options } } }))
    }

    applyOptions()
    {
        document.documentElement.classList.toggle('is-reduced-motion', Boolean(this.options.reducedMotion))
        document.documentElement.classList.toggle('is-assist-mode', Boolean(this.options.assistMode))
        document.documentElement.classList.toggle('is-muted', !this.options.sound)

        this.soundBtn.setAttribute('aria-pressed', String(Boolean(this.options.sound)))
        this.soundBtn.textContent = this.options.sound ? 'Som: Ligado' : 'Som: Mudo'
        this.soundBtn.classList.toggle('is-muted', !this.options.sound)

        if(this.game?.quality)
        {
            const targetLevel = this.options.quality === 'auto'
                ? (Quality.getForcedLevel() ?? (Quality.isMobile() ? 1 : 0))
                : Number(this.options.quality)

            if(Number.isInteger(targetLevel))
                this.game.quality.changeLevel(targetLevel)
        }

        this.syncMenuControls()
    }

    syncMenuControls()
    {
        this.qualitySelect.value = String(this.options.quality)
        this.reducedMotionInput.checked = Boolean(this.options.reducedMotion)
        this.assistInput.checked = Boolean(this.options.assistMode)
        this.soundInput.checked = Boolean(this.options.sound)
        this.vibrationInput.checked = Boolean(this.options.vibration)
    }

    setEraProgress(eraName, visited, total)
    {
        if(eraName !== undefined)
            this.state.eraName = eraName
        if(visited !== undefined)
            this.state.eraVisited = visited
        if(total !== undefined)
            this.state.eraTotal = total
        this.renderProgress()
    }

    setSignalsCount(count, total = this.state.signalsTotal)
    {
        this.state.signalsCount = count
        this.state.signalsTotal = total
        this.renderProgress()
    }

    renderProgress()
    {
        this.eraEl.textContent = `${this.state.eraName} · ${this.state.eraVisited}/${this.state.eraTotal}`
        this.signalsEl.textContent = `Sinais ${this.state.signalsCount}/${this.state.signalsTotal}`
    }
}
