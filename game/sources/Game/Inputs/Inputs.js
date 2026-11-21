import { Events } from '../Events.js'
import { Game } from '../Game.js'
import { Gamepad } from './Gamepad.js'
import { Pointer } from './Pointer.js'
import Keyboard from './Keyboard.js'
import { InteractiveButtons } from './InteractiveButtons.js'
import { Wheel } from './Wheel.js'
import { Nipple } from './Nipple.js'
import { TouchControls } from './TouchControls.js'
import ObservableSet from '../utilities/ObservableSet.js'

export class Inputs
{
    static MODE_MOUSEKEYBOARD = 1
    static MODE_GAMEPAD = 2
    static MODE_TOUCH = 3

    constructor(actions = [], filters = [])
    {
        this.game = Game.getInstance()
        this.events = new Events()

        this.actions = new Map()
        this.filters = new ObservableSet((event) =>
        {
            if(event.type === 'add')
            {
                document.documentElement.classList.add(`input-filter-${event.value}`)
            }
            else if(event.type === 'delete')
            {
                document.documentElement.classList.remove(`input-filter-${event.value}`)
            }
            else if(event.type === 'clear')
            {
                for(const previousValue of event.previousValues)
                {
                    document.documentElement.classList.remove(`input-filter-${previousValue}`)
                }
            }
        })
        this.mode = Inputs.MODE_MOUSEKEYBOARD
        this.locked = false // Ghost replay: ignore live input
        this.onAction = null // Ghost recorder hook

        this.setKeyboard()
        this.setGamepad()
        this.setPointer()
        this.setWheel()
        this.setInteractiveButtons()
        this.setNipple()
        this.setTouchControls()

        this.addActions([
            { name: 'menu', categories: [], keys: [ 'Keyboard.Escape', 'Gamepad.start' ] },
            { name: 'map', categories: [ 'wandering' ], keys: [ 'Keyboard.KeyM', 'Gamepad.select' ] },
        ])
        this.addActions(actions)
        
        for(const filter of filters)
            this.filters.add(filter)

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 0)
        
        document.documentElement.classList.add(`is-mode-mouse-keyboard`)
    }

    setKeyboard()
    {
        this.keyboard = new Keyboard(this.game.canvasElement)

        this.keyboard.events.on('down', (key, code) =>
        {
            this.updateMode(Inputs.MODE_MOUSEKEYBOARD)
            this.start(`Keyboard.${key}`)
            this.start(`Keyboard.${code}`)
        })

        this.keyboard.events.on('up', (key, code) =>
        {
            this.updateMode(Inputs.MODE_MOUSEKEYBOARD)
            this.end(`Keyboard.${key}`)
            this.end(`Keyboard.${code}`)
        })
    }

    setGamepad()
    {
        this.gamepad = new Gamepad()

        this.gamepad.events.on('down', (key) =>
        {
            this.updateMode(Inputs.MODE_GAMEPAD)
            this.start(`Gamepad.${key.name}`, key.value)
        })

        this.gamepad.events.on('up', (key) =>
        {
            this.updateMode(Inputs.MODE_GAMEPAD)
            this.end(`Gamepad.${key.name}`)
        })

        this.gamepad.events.on('typeChange', (key) =>
        {
            this.updateMode(Inputs.MODE_GAMEPAD)
        })

        this.gamepad.events.on('change', (key) =>
        {
            this.updateMode(Inputs.MODE_GAMEPAD)
            this.change(`Gamepad.${key.name}`, key.value)
        })

        this.gamepad.events.on('joystickChange', (joystick) =>
        {
            if(joystick.active)
                this.updateMode(Inputs.MODE_GAMEPAD)

            const scale = joystick.active && joystick.radius > 0 ? joystick.safeRadius / joystick.radius : 0
            this.change(
                `Gamepad.joystick${joystick.name.charAt(0).toUpperCase() + joystick.name.slice(1)}`,
                {
                    x: joystick.x * scale,
                    y: joystick.y * scale,
                    radius: joystick.active ? joystick.safeRadius : 0,
                    active: joystick.active
                }
            )
        })
    }

    setPointer()
    {
        this.pointer = new Pointer(this.game.canvasElement)

        this.pointer.events.on('down', () =>
        {
            this.updateMode(this.pointer.mode === Pointer.MODE_MOUSE ? Inputs.MODE_MOUSEKEYBOARD : Inputs.MODE_TOUCH)
            this.start('Pointer.any', { x: this.pointer.current.x, y: this.pointer.current.y })
        })

        this.pointer.events.on('up', () =>
        {
            this.updateMode(this.pointer.mode === Pointer.MODE_MOUSE ? Inputs.MODE_MOUSEKEYBOARD : Inputs.MODE_TOUCH)
            this.end('Pointer.any', { x: this.pointer.current.x, y: this.pointer.current.y })
        })

        this.pointer.events.on('move', () =>
        {
            this.change('Pointer.any', { x: this.pointer.current.x, y: this.pointer.current.y })
        })
    }

    setWheel()
    {
        this.wheel = new Wheel()

        this.wheel.events.on('roll', (value) =>
        {
            this.updateMode(Inputs.MODE_MOUSEKEYBOARD)
            this.start('Wheel.roll', value, false)
        })
    }

    setInteractiveButtons()
    {
        this.interactiveButtons = new InteractiveButtons()

        this.interactiveButtons.events.on('interact', () =>
        {
            this.updateMode(Inputs.MODE_TOUCH)
            this.start('Touch.interact')
            this.end('Touch.interact')
        })
    }

    setNipple()
    {
        this.nipple = new Nipple()
        this.addActions([
            { name: 'nipplePointer', categories: [ 'wandering', 'racing' ], keys: [ 'Pointer.any' ] },
        ])

        this.events.on('nipplePointer', (action) =>
        {
            if(this.mode !== Inputs.MODE_TOUCH)
                return
                
            this.nipple.updateFromPointer(this.pointer, action)
        })
    }

    setTouchControls()
    {
        this.touchControls = new TouchControls(this)
        this.nipple.enabled = false
    }

    addActions(actions)
    {
        for(const action of actions)
        {
            const formatedAction = {...action}
            formatedAction.active = false
            formatedAction.value = 0
            formatedAction.trigger = null
            formatedAction.activeKeys = new Set()

            this.actions.set(action.name, formatedAction)
        }
    }

    checkCategory(action)
    {
        // No filter => Allow all
        if(this.filters.size === 0)
            return true

        // Has filter but no category on action => Forbid
        if(action.categories.length === 0)
            return true

        // Has matching category and filter => All
        for(const category of action.categories)
        {
            if(this.filters.has(category))
                return true
        }

        // Otherwise => Forbid
        return false
    }

    // Ghost (T0.16): `onAction(name, trigger, value, isToggle)` is called after an action fired (recorder);
    // `locked` ignores live input (DOM, gamepad, pointer) while a ghost replays through applyAction().
    start(key, value = 1, isToggle = true)
    {
        if(this.locked)
            return

        const filteredActions = [...this.actions.values()].filter((_action) => _action.keys.indexOf(key) !== - 1 )
            
        for(const action of filteredActions)
            this.startAction(action, key, value, isToggle)
    }

    startAction(action, key, value = 1, isToggle = true)
    {
        if(action && this.checkCategory(action))
        {
            action.value = value
            action.activeKeys.add(key)
            action.trigger = 'start'

            // Can be active or inactive => trigger event only on change
            if(isToggle)
            {
                if(!action.active)
                {
                    action.active = true
                    
                    this.events.trigger('actionStart', [ action ])
                    this.events.trigger(action.name, [ action ])
                    this.onAction?.(action.name, 'start', value, true)
                }
            }

            // Trigger event whenever action starts (no "end")
            else
            {
                this.events.trigger('actionStart', [ action ])
                this.events.trigger(action.name, [ action ])
                this.onAction?.(action.name, 'start', value, false)
            }
        }
    }

    end(key, value = 0)
    {
        if(this.locked)
            return

        const filteredActions = [...this.actions.values()].filter((_action) => _action.keys.indexOf(key) !== - 1 )
            
        for(const action of filteredActions)
            this.endAction(action, key, value)
    }

    endAction(action, key, value = 0)
    {
        if(action && action.active)
        {
            action.activeKeys.delete(key)

            if(action.activeKeys.size === 0)
            {
                action.active = false
                action.value = value
                action.trigger = 'end'

                this.events.trigger('actionEnd', [ action ])
                this.events.trigger(action.name, [ action ])
                this.onAction?.(action.name, 'end', value, true)
            }
        }
    }

    change(key, value = 1)
    {
        if(this.locked)
            return

        const filteredActions = [...this.actions.values()].filter((_action) => _action.keys.indexOf(key) !== - 1 )
            
        for(const action of filteredActions)
            this.changeAction(action, value)
    }

    changeAction(action, value = 1)
    {
        if(action && this.checkCategory(action))
        {
            // Test if value has changed
            // - number => Direct comparaison
            // - object => Every property comparaison
            let hasChanged = false

            if(typeof value === 'number')
            {
                if(action.value !== value)
                    hasChanged = true
            }
            else if(value && typeof value === 'object')
            {
                const keys = Object.keys(value)

                if(!action.value || typeof action.value !== 'object')
                {
                    hasChanged = true
                }
                else
                {
                    for(const key of keys)
                    {
                        if(action.value[key] !== value[key])
                            hasChanged = true
                    }
                }
            }

            if(hasChanged)
            {
                action.value = value
                if(value && typeof value === 'object' && typeof value.active === 'boolean')
                    action.active = value.active
                action.trigger = 'change'

                this.events.trigger('actionChange', [ action ])
                this.events.trigger(action.name, [ action ])
                this.onAction?.(action.name, 'change', value, true)
            }
        }
    }

    // Ghost injection point: same code path as live input (startAction / endAction / changeAction), keyed by action
    // name instead of by device key. `trigger` is 'start' | 'end' | 'change'; when omitted it is derived from the value
    // (0 or null => end; else change when the action is active, start otherwise). Returns false for an unknown action.
    applyAction(name, trigger, value = 1, isToggle = true)
    {
        const action = this.actions.get(name)
        if(!action)
            return false

        if(!trigger)
            trigger = (value === 0 || value === null) ? 'end' : (action.active ? 'change' : 'start')

        if(trigger === 'start')
            this.startAction(action, 'Ghost', value, isToggle)
        else if(trigger === 'end')
            this.endAction(action, 'Ghost', value === null ? 0 : value)
        else
            this.changeAction(action, value)

        return true
    }

    updateMode(mode)
    {
        if(mode === this.mode)
            return

        const oldMode = this.mode
        this.mode = mode
        
        if(this.mode === Inputs.MODE_TOUCH)
            this.interactiveButtons.activate()
        else
            this.interactiveButtons.deactivate()

        const modeClasses = [
            null,
            'mouse-keyboard',
            'gamepad',
            'touch'
        ]

        document.documentElement.classList.remove(`is-mode-${modeClasses[oldMode]}`)
        document.documentElement.classList.add(`is-mode-${modeClasses[this.mode]}`)

        this.events.trigger('modeChange', [this.mode])
    }

    update()
    {
        this.pointer.update()
        this.gamepad.update()
        this.nipple.update()
        this.touchControls.update()
    }
}