// One-thumb touch controls and single-pointer alternatives (plan T1.8, WCAG 2.5.7).
//
// - Left 60% viewport: floating ink joystick on drag (outer ring 64 px, deadzone 10 px, max deflection 48 px)
//   and single-pointer tap-to-walk on short tap (< 10 px move, < 350 ms) via Rapier physics raycast.
// - Right 40% viewport: tap/hold anywhere to jump or trigger 2nd-tap ribbon glide; optional downward swipe
//   (>= 48 px while airborne) triggers stamp. A 76 px circular "Pular" hint fades after 20 s of touch play.
// - Contextual 64 px "Carimbar" button appears only while airborne above `feel.stamp.minHeight`.
// - Camera 44 px orbit buttons (⟲ / ⟳) support hold-to-orbit and crisp 15 deg single-tap nudges.
// - Multi-touch is tracked by `touch.identifier` so left and right thumbs work simultaneously.
import * as THREE from 'three/webgpu'
import { Inputs } from './Inputs.js'

const LEFT_ZONE_RATIO = 0.60
const JOYSTICK_OUTER_RADIUS = 64
const JOYSTICK_DEADZONE = 10
const JOYSTICK_MAX_DEFLECTION = 48
const TAP_MAX_MOVE = 10
const TAP_MAX_DURATION = 0.35
const SWIPE_DOWN_STAMP_PX = 48
const JUMP_HINT_DURATION = 20
const ORBIT_TAP_MAX_DURATION = 0.25

const UP = new THREE.Vector3(0, 1, 0)

export class TouchControls
{
    constructor(inputs)
    {
        this.inputs = inputs
        this.game = inputs.game
        this.enabled = true

        this.leftTouch = null
        this.rightTouch = null
        this.orbitTouches = new Map()
        this.stampTouchId = null
        this.lastTouchEndElapsed = - Infinity

        this.joystick = { x: 0, y: 0, radius: 0, active: false }
        this.touchPlayElapsed = 0
        this.jumpHintFaded = false
        this.canStamp = false

        this.raycaster = new THREE.Raycaster()
        this.ndc = new THREE.Vector2()
        this.fallbackPlane = new THREE.Plane(UP, 0)
        this.fallbackPoint = new THREE.Vector3()

        this.config = {
            leftZoneRatio: LEFT_ZONE_RATIO,
            outerRadius: JOYSTICK_OUTER_RADIUS,
            deadzone: JOYSTICK_DEADZONE,
            maxDeflection: JOYSTICK_MAX_DEFLECTION,
            tapMaxMove: TAP_MAX_MOVE,
            tapMaxDuration: TAP_MAX_DURATION,
            swipeDownStampPx: SWIPE_DOWN_STAMP_PX,
            jumpHintDuration: JUMP_HINT_DURATION,
        }

        this.bindElements()
        this.bindEvents()
    }

    bindElements()
    {
        const root = document.querySelector('.js-touch-controls')
        this.root = root
        this.joystickElement = root?.querySelector('.js-touch-joystick') ?? null
        this.joystickStickElement = root?.querySelector('.js-touch-joystick-stick') ?? null
        this.joystickKnobElement = root?.querySelector('.js-touch-joystick-knob') ?? null
        this.jumpHintElement = root?.querySelector('.js-touch-jump') ?? null
        this.stampElement = root?.querySelector('.js-touch-stamp') ?? null
        this.orbitLeftElement = root?.querySelector('.js-touch-orbit-left') ?? null
        this.orbitRightElement = root?.querySelector('.js-touch-orbit-right') ?? null
    }

    bindEvents()
    {
        const canvas = this.game.canvasElement
        const onZoneStart = (event) => this.onZoneTouchStart(event)
        const onMove = (event) => this.onTouchMove(event)
        const onEnd = (event) => this.onTouchEnd(event, false)
        const onCancel = (event) => this.onTouchEnd(event, true)

        canvas.addEventListener('touchstart', onZoneStart, { passive: false })
        canvas.addEventListener('touchmove', onMove, { passive: false })
        canvas.addEventListener('touchend', onEnd, { passive: false })
        canvas.addEventListener('touchcancel', onCancel, { passive: false })

        // Track move/end/cancel globally so fingers leaving the canvas never leave stuck inputs
        window.addEventListener('touchmove', onMove, { passive: false })
        window.addEventListener('touchend', onEnd, { passive: false })
        window.addEventListener('touchcancel', onCancel, { passive: false })

        if(this.jumpHintElement)
        {
            this.jumpHintElement.addEventListener('touchstart', (event) =>
            {
                this.onJumpHintTouchStart(event)
            }, { passive: false })

            this.jumpHintElement.addEventListener('click', (event) =>
            {
                if(this.wasRecentTouch() || this.inputs.locked)
                    return
                event.preventDefault()
                this.inputs.start('Touch.jump')
                this.inputs.end('Touch.jump')
            })
        }

        if(this.stampElement)
        {
            this.stampElement.addEventListener('touchstart', (event) =>
            {
                event.preventDefault()
                event.stopPropagation()
                if(!this.enabled || this.inputs.locked)
                    return
                this.inputs.updateMode(Inputs.MODE_TOUCH)
                const touch = event.changedTouches?.[0]
                if(touch)
                    this.stampTouchId = touch.identifier
                this.stampElement.classList.add('is-pressed')
                this.inputs.start('Touch.stamp')
            }, { passive: false })

            const endStamp = (event) =>
            {
                event.preventDefault()
                event.stopPropagation()
                this.lastTouchEndElapsed = this.game.ticker.elapsed
                this.stampTouchId = null
                this.stampElement.classList.remove('is-pressed')
                this.inputs.end('Touch.stamp')
            }
            this.stampElement.addEventListener('touchend', endStamp, { passive: false })
            this.stampElement.addEventListener('touchcancel', endStamp, { passive: false })

            this.stampElement.addEventListener('click', (event) =>
            {
                if(this.wasRecentTouch() || !this.enabled || this.inputs.locked)
                    return
                event.preventDefault()
                this.inputs.start('Touch.stamp')
                this.inputs.end('Touch.stamp')
            })
        }

        this.bindOrbitButton(this.orbitLeftElement, 'left')
        this.bindOrbitButton(this.orbitRightElement, 'right')
    }

    bindOrbitButton(element, direction)
    {
        if(!element)
            return

        const holdKey = direction === 'left' ? 'Touch.cameraOrbitLeft' : 'Touch.cameraOrbitRight'
        const nudgeKey = direction === 'left' ? 'Touch.cameraOrbitNudgeLeft' : 'Touch.cameraOrbitNudgeRight'

        element.addEventListener('touchstart', (event) =>
        {
            event.preventDefault()
            event.stopPropagation()
            if(!this.enabled || this.inputs.locked)
                return

            this.inputs.updateMode(Inputs.MODE_TOUCH)
            const changed = event.changedTouches ? [ ...event.changedTouches ] : []
            for(const touch of changed)
            {
                this.orbitTouches.set(touch.identifier, {
                    direction,
                    holdKey,
                    nudgeKey,
                    element,
                    startElapsed: this.game.ticker.elapsed,
                })
            }
            element.classList.add('is-pressed')
            this.inputs.start(holdKey)
        }, { passive: false })

        const finishOrbit = (event, cancelled) =>
        {
            event.preventDefault()
            event.stopPropagation()
            this.lastTouchEndElapsed = this.game.ticker.elapsed
            const changed = event.changedTouches ? [ ...event.changedTouches ] : []
            for(const touch of changed)
            {
                this.releaseOrbitTouch(touch.identifier, cancelled)
            }
            if(changed.length === 0)
            {
                element.classList.remove('is-pressed')
                this.inputs.end(holdKey)
            }
        }

        element.addEventListener('touchend', (event) => finishOrbit(event, false), { passive: false })
        element.addEventListener('touchcancel', (event) => finishOrbit(event, true), { passive: false })

        element.addEventListener('click', (event) =>
        {
            if(this.wasRecentTouch() || !this.enabled || this.inputs.locked)
                return
            event.preventDefault()
            this.inputs.start(nudgeKey, 1, false)
        })
    }

    releaseOrbitTouch(touchId, cancelled)
    {
        const record = this.orbitTouches.get(touchId)
        if(!record)
            return

        this.orbitTouches.delete(touchId)
        record.element.classList.remove('is-pressed')
        this.inputs.end(record.holdKey)

        if(!cancelled && !this.inputs.locked)
        {
            const duration = this.game.ticker.elapsed - record.startElapsed
            if(duration < ORBIT_TAP_MAX_DURATION)
                this.inputs.start(record.nudgeKey, 1, false)
        }
    }

    wasRecentTouch()
    {
        return (this.game.ticker.elapsed - this.lastTouchEndElapsed) < 0.45
    }

    isExplicitButtonTarget(target)
    {
        return Boolean(target?.closest?.('.js-touch-stamp, .js-touch-orbit-left, .js-touch-orbit-right, .js-button'))
    }

    onJumpHintTouchStart(event)
    {
        if(!this.enabled || this.inputs.locked)
            return

        event.preventDefault()
        event.stopPropagation()
        this.inputs.updateMode(Inputs.MODE_TOUCH)

        const changed = event.changedTouches ? [ ...event.changedTouches ] : []
        for(const touch of changed)
        {
            if(this.rightTouch === null)
                this.startRightTouch(touch)
        }
    }

    onZoneTouchStart(event)
    {
        if(!this.enabled || this.inputs.locked)
            return

        if(this.isExplicitButtonTarget(event.target))
            return

        if(event.cancelable)
            event.preventDefault()

        this.inputs.updateMode(Inputs.MODE_TOUCH)

        const rect = this.game.canvasElement.getBoundingClientRect()
        const splitX = rect.left + rect.width * LEFT_ZONE_RATIO
        const changed = event.changedTouches ? [ ...event.changedTouches ] : []

        for(const touch of changed)
        {
            if(touch.clientX < splitX)
            {
                if(this.leftTouch === null)
                    this.startLeftTouch(touch)
            }
            else
            {
                if(this.rightTouch === null)
                    this.startRightTouch(touch)
            }
        }
    }

    startLeftTouch(touch)
    {
        this.leftTouch = {
            id: touch.identifier,
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: touch.clientX,
            currentY: touch.clientY,
            startElapsed: this.game.ticker.elapsed,
            maxMove: 0,
            isDragging: false,
        }
        this.showJoystickAt(touch.clientX, touch.clientY)
        this.updateJoystickVisual(0, 0, false)
        this.emitJoystick(0, 0, 0, false)
    }

    startRightTouch(touch)
    {
        this.rightTouch = {
            id: touch.identifier,
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: touch.clientX,
            currentY: touch.clientY,
            swipedDown: false,
        }
        this.jumpHintElement?.classList.add('is-pressed')
        this.inputs.start('Touch.jump')
    }

    onTouchMove(event)
    {
        if(!this.enabled || event.__vnTouchMoveHandled)
            return
        event.__vnTouchMoveHandled = true

        if(this.inputs.locked)
        {
            this.resetActiveTouches()
            return
        }

        const changed = event.changedTouches ? [ ...event.changedTouches ] : []
        let handled = false

        for(const touch of changed)
        {
            if(this.leftTouch && touch.identifier === this.leftTouch.id)
            {
                handled = true
                this.updateLeftTouch(touch)
            }
            else if(this.rightTouch && touch.identifier === this.rightTouch.id)
            {
                handled = true
                this.updateRightTouch(touch)
            }
        }

        if(handled && event.cancelable)
            event.preventDefault()
    }

    updateLeftTouch(touch)
    {
        const lt = this.leftTouch
        lt.currentX = touch.clientX
        lt.currentY = touch.clientY

        const dx = lt.currentX - lt.startX
        const dy = lt.currentY - lt.startY
        const dist = Math.hypot(dx, dy)
        if(dist > lt.maxMove)
            lt.maxMove = dist

        const clamped = Math.min(dist, JOYSTICK_MAX_DEFLECTION)
        const visualX = dist > 1e-4 ? (dx / dist) * clamped : 0
        const visualY = dist > 1e-4 ? (dy / dist) * clamped : 0

        if(dist >= JOYSTICK_DEADZONE)
        {
            lt.isDragging = true
            const norm = Math.max(0.01, (clamped - JOYSTICK_DEADZONE) / (JOYSTICK_MAX_DEFLECTION - JOYSTICK_DEADZONE))
            const nx = (dx / dist) * norm
            const ny = (dy / dist) * norm
            this.updateJoystickVisual(visualX, visualY, norm >= 0.5)
            this.emitJoystick(nx, ny, norm, true)
        }
        else
        {
            this.updateJoystickVisual(visualX, visualY, false)
            this.emitJoystick(0, 0, 0, false)
        }
    }

    updateRightTouch(touch)
    {
        const rt = this.rightTouch
        rt.currentX = touch.clientX
        rt.currentY = touch.clientY

        const dy = rt.currentY - rt.startY
        if(!rt.swipedDown && dy >= SWIPE_DOWN_STAMP_PX)
        {
            const player = this.game.world?.player
            const controller = player?.controller
            if(controller && !controller.grounded && !controller.stamp.active)
            {
                rt.swipedDown = true
                this.inputs.start('Touch.stamp')
            }
        }
    }

    onTouchEnd(event, cancelled)
    {
        if(!this.enabled || event.__vnTouchEndHandled)
            return
        event.__vnTouchEndHandled = true

        const changed = event.changedTouches ? [ ...event.changedTouches ] : []
        let handled = false

        for(const touch of changed)
        {
            if(this.leftTouch && touch.identifier === this.leftTouch.id)
            {
                handled = true
                this.finishLeftTouch(cancelled)
            }
            else if(this.rightTouch && touch.identifier === this.rightTouch.id)
            {
                handled = true
                this.finishRightTouch()
            }
            else if(this.stampTouchId !== null && touch.identifier === this.stampTouchId)
            {
                handled = true
                this.stampTouchId = null
                this.stampElement?.classList.remove('is-pressed')
                this.inputs.end('Touch.stamp')
            }
            else if(this.orbitTouches.has(touch.identifier))
            {
                handled = true
                this.releaseOrbitTouch(touch.identifier, cancelled)
            }
        }

        if(handled)
        {
            this.lastTouchEndElapsed = this.game.ticker.elapsed
            if(event.cancelable)
                event.preventDefault()
        }
    }

    finishLeftTouch(cancelled)
    {
        const lt = this.leftTouch
        if(!lt)
            return

        const duration = this.game.ticker.elapsed - lt.startElapsed
        const isShortTap = !cancelled && !lt.isDragging && lt.maxMove < TAP_MAX_MOVE && duration < TAP_MAX_DURATION

        this.leftTouch = null
        this.hideJoystick()
        this.emitJoystick(0, 0, 0, false)

        if(isShortTap && !this.inputs.locked)
            this.handleTapToWalk(lt.startX, lt.startY)
    }

    finishRightTouch()
    {
        const rt = this.rightTouch
        if(!rt)
            return

        this.rightTouch = null
        this.jumpHintElement?.classList.remove('is-pressed')
        this.inputs.end('Touch.jump')
        if(rt.swipedDown)
            this.inputs.end('Touch.stamp')
    }

    handleTapToWalk(clientX, clientY)
    {
        const player = this.game.world?.player
        const camera = this.game.view?.camera
        const world = this.game.physics?.world
        if(!player || !camera || !world || this.inputs.locked)
            return false

        const rect = this.game.canvasElement.getBoundingClientRect()
        if(rect.width <= 0 || rect.height <= 0)
            return false

        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
        const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1)

        camera.updateMatrixWorld()
        this.raycaster.setFromCamera(this.ndc.set(ndcX, ndcY), camera)

        const ro = this.raycaster.ray.origin
        const rd = this.raycaster.ray.direction
        const ray = new this.game.RAPIER.Ray(
            { x: ro.x, y: ro.y, z: ro.z },
            { x: rd.x, y: rd.y, z: rd.z }
        )

        const playerBody = player.object?.physical?.body
        const playerCollider = player.controller?.collider
        const hit = world.castRay(ray, 200, true, undefined, undefined, playerCollider, playerBody)

        if(hit)
        {
            const t = hit.timeOfImpact
            const x = ro.x + rd.x * t
            const y = ro.y + rd.y * t
            const z = ro.z + rd.z * t
            player.setWalkTarget(x, y, z)
            return true
        }

        // Fallback onto the player's horizontal foot plane when tapping past a ledge
        if(rd.y < - 0.02 && playerBody)
        {
            const feetY = playerBody.translation().y - (player.feel.body.halfHeight + player.feel.body.radius)
            this.fallbackPlane.set(UP, - feetY)
            if(this.raycaster.ray.intersectPlane(this.fallbackPlane, this.fallbackPoint))
            {
                if(this.fallbackPoint.distanceTo(ro) <= 120)
                {
                    player.setWalkTarget(this.fallbackPoint.x, feetY, this.fallbackPoint.z)
                    return true
                }
            }
        }

        return false
    }

    emitJoystick(x, y, radius, active)
    {
        this.joystick.x = x
        this.joystick.y = y
        this.joystick.radius = radius
        this.joystick.active = active

        this.inputs.change('Touch.joystick', { x, y, radius, active })
    }

    showJoystickAt(clientX, clientY)
    {
        if(!this.joystickElement)
            return

        const rect = this.game.canvasElement.getBoundingClientRect()
        const localX = clientX - rect.left
        const localY = clientY - rect.top
        this.joystickElement.style.transform = `translate3d(${localX}px, ${localY}px, 0)`
        this.joystickElement.classList.add('is-active')
    }

    updateJoystickVisual(dx, dy, running)
    {
        if(this.joystickStickElement)
        {
            this.joystickStickElement.setAttribute('x2', dx.toFixed(1))
            this.joystickStickElement.setAttribute('y2', dy.toFixed(1))
        }
        if(this.joystickKnobElement)
        {
            this.joystickKnobElement.setAttribute('cx', dx.toFixed(1))
            this.joystickKnobElement.setAttribute('cy', dy.toFixed(1))
            this.joystickKnobElement.classList.toggle('is-running', running)
        }
    }

    hideJoystick()
    {
        if(!this.joystickElement)
            return

        this.joystickElement.classList.remove('is-active')
        this.updateJoystickVisual(0, 0, false)
    }

    resetActiveTouches()
    {
        if(this.leftTouch)
        {
            this.leftTouch = null
            this.hideJoystick()
            this.emitJoystick(0, 0, 0, false)
        }
        if(this.rightTouch)
        {
            const hadSwipe = this.rightTouch.swipedDown
            this.rightTouch = null
            this.jumpHintElement?.classList.remove('is-pressed')
            this.inputs.end('Touch.jump')
            if(hadSwipe)
                this.inputs.end('Touch.stamp')
        }
        if(this.stampTouchId !== null)
        {
            this.stampTouchId = null
            this.stampElement?.classList.remove('is-pressed')
            this.inputs.end('Touch.stamp')
        }
        for(const [ id ] of [ ...this.orbitTouches ])
            this.releaseOrbitTouch(id, true)
    }

    // Per frame (visual/UI state only)
    update()
    {
        if(this.inputs.locked)
            this.resetActiveTouches()

        const isTouchMode = this.inputs.mode === Inputs.MODE_TOUCH

        if(isTouchMode && !this.jumpHintFaded)
        {
            this.touchPlayElapsed += this.game.ticker.delta
            if(this.touchPlayElapsed >= JUMP_HINT_DURATION)
            {
                this.jumpHintFaded = true
                this.jumpHintElement?.classList.add('is-hint-faded')
            }
        }

        const player = this.game.world?.player
        const controller = player?.controller
        const canStamp = Boolean(
            isTouchMode &&
            controller &&
            !controller.grounded &&
            !controller.stamp.active &&
            controller.heightAboveGround(player.feel.stamp.minHeight) >= player.feel.stamp.minHeight
        )

        if(canStamp !== this.canStamp)
        {
            this.canStamp = canStamp
            this.stampElement?.classList.toggle('is-visible', canStamp)
        }
    }
}
