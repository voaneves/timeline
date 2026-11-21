import {
    ACHIEVEMENTS,
    ACHIEVEMENTS_BY_ID,
    ACHIEVEMENTS_STORAGE_KEY,
    CORE_ERA_IDS,
    ORIGENS_MILESTONE_IDS,
} from '../data/achievements.js'
import { Events } from './Events.js'
import { Game } from './Game.js'

const TOAST_DURATION_MS = 3600

function normalizeEraId(raw)
{
    const id = String(raw || '').trim().toLowerCase()
    if(!id)
        return ''
    if(id === 'era-1' || id === 'origens')
        return 'origens'
    if(id === 'era-2' || id === 'unicamp')
        return 'unicamp'
    if(id === 'era-3' || id === 'industria' || id === 'indústria' || id === 'alemanha')
        return 'industria'
    if(id === 'era-4' || id === 'dados')
        return 'dados'
    if(id === 'era-5' || id === 'ia' || id === 'transformacao' || id === 'transformação digital')
        return 'ia'
    return id
}

/**
 * Local-only achievement tracker (T4.1).
 * Persists unlocked badges in localStorage (`vn-timeline-achievements`) and never locks any content.
 */
export class Achievements
{
    constructor(cards = null)
    {
        this.game = Game.getInstance()
        this.cards = cards || this.game?.cards || null
        this.events = new Events()

        this.unlocked = new Map()
        this.visitedEras = new Set()
        this._toastQueue = []
        this._toastTimer = null
        this._activeToast = false
        this._boundController = null
        this._boundGameplay = null
        this._spawnOrigin = null

        this.load()
        this.buildToast()
        this.bindEvents()
    }

    load()
    {
        try
        {
            const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY)
            if(!raw)
                return
            const data = JSON.parse(raw)
            if(data && typeof data === 'object')
            {
                const unlockedObj = data.unlocked && typeof data.unlocked === 'object' ? data.unlocked : data
                for(const [ id, value ] of Object.entries(unlockedObj))
                {
                    if(ACHIEVEMENTS_BY_ID.has(id) && value)
                        this.unlocked.set(id, typeof value === 'number' ? value : Date.now())
                }
                if(Array.isArray(data.visitedEras))
                {
                    for(const era of data.visitedEras)
                    {
                        const norm = normalizeEraId(era)
                        if(norm)
                            this.visitedEras.add(norm)
                    }
                }
            }
        }
        catch {}
    }

    save()
    {
        try
        {
            const unlocked = {}
            for(const [ id, ts ] of this.unlocked.entries())
                unlocked[id] = ts

            localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify({
                unlocked,
                visitedEras: Array.from(this.visitedEras),
            }))
        }
        catch {}
    }

    isUnlocked(id)
    {
        return this.unlocked.has(id)
    }

    getCount()
    {
        return this.unlocked.size
    }

    getTotal()
    {
        return ACHIEVEMENTS.length
    }

    getAll()
    {
        return ACHIEVEMENTS.map((item) => ({
            ...item,
            unlocked: this.unlocked.has(item.id),
            unlockedAt: this.unlocked.get(item.id) || null,
        }))
    }

    getState()
    {
        return {
            count: this.unlocked.size,
            total: ACHIEVEMENTS.length,
            items: this.getAll(),
        }
    }

    unlock(id, options = {})
    {
        const item = ACHIEVEMENTS_BY_ID.get(id)
        if(!item || this.unlocked.has(id))
            return false

        this.unlocked.set(id, Date.now())
        this.save()

        if(!options.silent)
        {
            this.enqueueToast(item)
            this.cards?.announcer?.announce(`Conquista desbloqueada: ${item.title}. ${item.description}`)
        }

        this.events.trigger('unlock', [ item ])
        this.events.trigger('change', [ this.getState() ])
        window.dispatchEvent(new CustomEvent('timeline:achievementUnlocked', { detail: { ...item } }))
        return true
    }

    markEraVisited(eraId)
    {
        const norm = normalizeEraId(eraId)
        if(!norm)
            return

        const added = !this.visitedEras.has(norm)
        this.visitedEras.add(norm)
        if(added)
            this.save()

        if(CORE_ERA_IDS.every((id) => this.visitedEras.has(id)))
            this.unlock('all_eras')
    }

    reset()
    {
        this.unlocked.clear()
        this.visitedEras.clear()
        this.save()
        this.events.trigger('change', [ this.getState() ])
    }

    buildToast()
    {
        const root = this.game?.domElement || document.body

        this.toastEl = document.createElement('div')
        this.toastEl.className = 'vn-achievement-toast js-achievement-toast'
        this.toastEl.setAttribute('aria-hidden', 'true')
        this.toastEl.innerHTML = `
            <span class="vn-achievement-toast-badge">Conquista desbloqueada</span>
            <strong class="vn-achievement-toast-title js-achievement-toast-title"></strong>
            <span class="vn-achievement-toast-desc js-achievement-toast-desc"></span>
        `
        root.appendChild(this.toastEl)

        this.toastTitleEl = this.toastEl.querySelector('.js-achievement-toast-title')
        this.toastDescEl = this.toastEl.querySelector('.js-achievement-toast-desc')
    }

    enqueueToast(item)
    {
        this._toastQueue.push(item)
        if(!this._activeToast)
            this.showNextToast()
    }

    showNextToast()
    {
        const next = this._toastQueue.shift()
        if(!next || !this.toastEl)
        {
            this._activeToast = false
            return
        }

        this._activeToast = true
        this.toastTitleEl.textContent = next.title
        this.toastDescEl.textContent = next.description
        this.toastEl.classList.add('is-visible')

        if(this._toastTimer)
            clearTimeout(this._toastTimer)

        this._toastTimer = setTimeout(() =>
        {
            this.toastEl?.classList.remove('is-visible')
            this._toastTimer = setTimeout(() =>
            {
                this.showNextToast()
            }, 220)
        }, TOAST_DURATION_MS)
    }

    bindEvents()
    {
        this.cards?.events?.on('visit', (milestone) =>
        {
            if(milestone?.era?.id)
                this.markEraVisited(milestone.era.id)

            if(ORIGENS_MILESTONE_IDS.every((id) => this.cards.visited.has(id)))
                this.unlock('origens_memories')
        })

        this.cards?.events?.on('open', (type) =>
        {
            if(type === 'project')
                this.unlock('cartridge_explorer')
            else if(type === 'contact')
                this.unlock('end_dot')
        })

        window.addEventListener('timeline:teleportEra', (event) =>
        {
            const era = event.detail?.eraId || event.detail?.id
            if(era)
                this.markEraVisited(era)
        })

        window.addEventListener('timeline:era', (event) =>
        {
            const era = event.detail?.eraId || event.detail?.id || event.detail
            if(era)
                this.markEraVisited(era)
        })

        window.addEventListener('timeline:achievement', (event) =>
        {
            const id = typeof event.detail === 'string' ? event.detail : event.detail?.id
            if(id)
                this.unlock(id)
        })

        this.game?.ticker?.events?.on('tick', () =>
        {
            this.pollWorldState()
        }, 28)
    }

    bindGameplayHooks()
    {
        const controller = this.game?.world?.player?.controller
        if(controller && this._boundController !== controller)
        {
            this._boundController = controller
            controller.events?.on('grindStart', () => this.unlock('line_musician'))
            controller.events?.on('secretOpen', () => this.unlock('secret_hunter'))
            controller.events?.on('endDotStamp', () => this.unlock('end_dot'))
        }

        const gameplay = this.game?.world?.origensEra?.gameplay
        if(gameplay && this._boundGameplay !== gameplay)
        {
            this._boundGameplay = gameplay
            gameplay.events?.on('secretOpen', () => this.unlock('secret_hunter'))
            gameplay.events?.on('endDotStamp', () => this.unlock('end_dot'))
        }
    }

    pollWorldState()
    {
        if(!this.game?.ready)
            return

        this.bindGameplayHooks()

        const activeZone = this.game.world?.zoneStreamer?.activeZone
        if(activeZone)
            this.markEraVisited(activeZone)

        if(!this.isUnlocked('first_step'))
        {
            const controller = this.game.world?.player?.controller
            const pos = controller?.body?.translation?.()
            if(pos)
            {
                if(!this._spawnOrigin)
                {
                    this._spawnOrigin = { x: pos.x, z: pos.z }
                }
                else
                {
                    const moved = Math.hypot(pos.x - this._spawnOrigin.x, pos.z - this._spawnOrigin.z)
                    if(moved >= 1.5)
                        this.unlock('first_step')
                }
            }
        }

        if(!this.isUnlocked('cerrado_runner'))
        {
            const fleeing = this.game.world?.origensEra?.ambientLife?.seriemaState?.fleeing
            if(fleeing)
                this.unlock('cerrado_runner')
        }
    }
}
