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

        this.element.textContent = ''
        queueMicrotask(() =>
        {
            this.element.textContent = String(message)
        })
    }
}
