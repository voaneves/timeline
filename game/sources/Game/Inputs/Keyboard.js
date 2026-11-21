import { Events } from '../Events.js'

const PREVENT_SCROLL_CODES = new Set([
    'Space',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
])

const INTERACTIVE_TAGS = new Set([
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'BUTTON',
    'A',
    'DIALOG',
    'SUMMARY',
    'DETAILS',
])

const INTERACTIVE_CONTAINER_SELECTOR = 'input, textarea, select, button, a[href], dialog, [contenteditable=""], [contenteditable="true"], .modal, .menu'

export default class Keyboard
{
    constructor(canvas = null)
    {
        this.canvas = canvas
        this.events = new Events()

        this.pressed = []
        this.pressedEntries = new Map()
        this.canvasBlurred = false
        this.keyboardFocusIntent = false

        window.addEventListener('pointerdown', () =>
        {
            this.keyboardFocusIntent = false
        }, { capture: true })

        window.addEventListener('mousedown', () =>
        {
            this.keyboardFocusIntent = false
        }, { capture: true })

        if(this.canvas)
        {
            this.canvas.addEventListener('pointerdown', () =>
            {
                this.keyboardFocusIntent = false
                this.canvasBlurred = false
                this.canvas.classList.remove('is-keyboard-focus')
                if(document.activeElement !== this.canvas)
                    this.canvas.focus({ preventScroll: true, focusVisible: false })
            })

            this.canvas.addEventListener('focus', () =>
            {
                this.canvasBlurred = false
                this.canvas.classList.toggle('is-keyboard-focus', this.keyboardFocusIntent)
            })

            this.canvas.addEventListener('blur', () =>
            {
                this.canvasBlurred = true
                this.canvas.classList.remove('is-keyboard-focus')
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

        // Key down event: accept automatically when canvas/body/documentElement has focus,
        // and block when an interactive/editable DOM element is focused.
        addEventListener('keydown', (_event) =>
        {
            if(_event.key === 'Tab')
                this.keyboardFocusIntent = true

            this.canvasBlurred = false
            if(!this.shouldAcceptKey(_event))
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
            if(!hadCode && !this.shouldAcceptKey(_event))
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

    isInteractiveElement(el)
    {
        if(!el || el === this.canvas || el === document.body || el === document.documentElement)
            return false

        if(el.isContentEditable)
            return true

        const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
        if(INTERACTIVE_TAGS.has(tag))
            return true

        if(typeof el.closest === 'function' && el.closest(INTERACTIVE_CONTAINER_SELECTOR))
            return true

        return false
    }

    shouldAcceptKey(_event = null)
    {
        if(this.canvasBlurred)
            return false

        if(document.querySelector('dialog[open]'))
            return false

        const active = document.activeElement
        if(this.isInteractiveElement(active))
            return false

        const target = _event?.target
        if(target && target !== active && this.isInteractiveElement(target))
            return false

        if(!active || active === this.canvas || active === document.body || active === document.documentElement)
            return true

        return false
    }

    isCanvasFocused()
    {
        return this.shouldAcceptKey()
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
