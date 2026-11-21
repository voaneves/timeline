import { Game } from '../Game.js'

/**
 * Accessible live-region announcer for screen readers (`aria-live="polite"`).
 */
export class Announcer
{
    constructor(parent = null)
    {
        this.game = Game.getInstance()
        this.parent = parent || this.game?.domElement || document.body
        this.lastByKey = new Map()
        this.lastMessage = ''

        this.element = document.createElement('div')
        this.element.className = 'sr-only js-announcer'
        this.element.setAttribute('aria-live', 'polite')
        this.element.setAttribute('aria-atomic', 'true')
        this.parent.appendChild(this.element)
    }

    /**
     * Announce a concise status message to assistive technology.
     */
    announce(message)
    {
        if(!message)
            return

        const text = String(message)
        this.lastMessage = text
        this.element.textContent = ''
        queueMicrotask(() =>
        {
            this.element.textContent = text
        })
    }

    /**
     * Announce a message throttled per key (default 1.5 s) to avoid screen-reader spam.
     */
    announceThrottled(key, message, minIntervalMs = 1500)
    {
        if(!message)
            return false

        const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
        const prev = this.lastByKey.get(key)
        if(prev !== undefined && (now - prev) < minIntervalMs)
            return false

        this.lastByKey.set(key, now)
        this.announce(message)
        return true
    }

    /**
     * Announce entry into an era and its milestone count.
     */
    announceEra(eraName, milestoneCount)
    {
        if(!eraName)
            return
        const label = milestoneCount === 1 ? '1 marco' : `${milestoneCount} marcos`
        this.announce(`${eraName}, ${label}`)
    }
}
