import { Events } from '../Events.js'

const PREVENT_SCROLL_CODES = new Set([
    'Space',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
])

export default class Keyboard
{
    constructor(canvas = null)
    {
        this.canvas = canvas
        this.events = new Events()

        this.pressed = []
        this.pressedEntries = new Map()

        if(this.canvas)
        {
            this.canvas.addEventListener('pointerdown', () =>
            {
                if(document.activeElement !== this.canvas)
                    this.canvas.focus({ preventScroll: true })
            })

            this.canvas.addEventListener('blur', () =>
            {
                this.releaseAll()
            })
        }

        // Release all held keys when window loses focus or tab becomes hidden
        window.addEventListener('blur', () =>
        {
            this.releaseAll()
        })

        document.addEventListener('visibilitychange', () =>
        {
            if(document.hidden)
                this.releaseAll()
        })

        // Key down event: capture strictly when the canvas is focused
        addEventListener('keydown', (_event) =>
        {
            if(!this.isCanvasFocused())
                return

            if(PREVENT_SCROLL_CODES.has(_event.code))
                _event.preventDefault()

            if(_event.repeat || this.pressedEntries.has(_event.code))
                return

            this.pressedEntries.set(_event.code, _event.key)
            this.pressed.push(_event.code)
            if(_event.key !== _event.code)
                this.pressed.push(_event.key)

            this.events.trigger('down', [ _event.code, _event.key ])
        })

        // Key up event
        addEventListener('keyup', (_event) =>
        {
            const hadCode = this.pressedEntries.has(_event.code)
            if(!hadCode && !this.isCanvasFocused())
                return

            const savedKey = this.pressedEntries.get(_event.code) ?? _event.key
            this.pressedEntries.delete(_event.code)

            const indexCode = this.pressed.indexOf(_event.code)
            if(indexCode !== -1)
                this.pressed.splice(indexCode, 1)

            const indexKey = this.pressed.indexOf(savedKey)
            if(indexKey !== -1)
                this.pressed.splice(indexKey, 1)

            if(savedKey !== _event.key)
            {
                const indexEventKey = this.pressed.indexOf(_event.key)
                if(indexEventKey !== -1)
                    this.pressed.splice(indexEventKey, 1)
            }

            if(hadCode)
                this.events.trigger('up', [ _event.code, savedKey ])
        })
    }

    isCanvasFocused()
    {
        return Boolean(this.canvas && document.activeElement === this.canvas)
    }

    releaseAll()
    {
        if(this.pressedEntries.size === 0)
            return

        const entries = [ ...this.pressedEntries.entries() ]
        this.pressedEntries.clear()
        this.pressed.length = 0

        for(const [ code, key ] of entries)
            this.events.trigger('up', [ code, key ])
    }
}
