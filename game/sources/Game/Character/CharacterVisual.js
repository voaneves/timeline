// Rigged & animated Victor character visual (T2.9a state machine + T2.9b 5 procedural layers).
// Purely visual: reads CharacterController / Stamp / Player state, never mutates Rapier physics.
import * as THREE from 'three/webgpu'
import { texture } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'
import { feel } from '../../data/feel.js'
import { Stamp } from './Stamp.js'

const DEG = Math.PI / 180
const MAX_LEAN_RAD = 12 * DEG
const MAX_TRANSITIONS_LOG = 200

const CORE_FALLBACK = {
    idle: 'idle',
    idleLong: 'idle',
    sitLaptop: 'idle',
    walk: 'walk',
    run: 'run',
    skid: 'walk',
    jumpUp: 'jumpUp',
    flutter: 'fall',
    fall: 'fall',
    landSoft: 'landSoft',
    landHard: 'landHard',
    stamp: 'fall',
    push: 'walk',
    grind: 'idle',
    interact: 'idle',
    hurtBump: 'landHard',
    wave: 'idle',
    celebrate: 'idle',
}

const ONE_SHOT_STATES = new Set([
    'jumpUp',
    'landSoft',
    'landHard',
    'interact',
    'hurtBump',
    'wave',
    'celebrate',
])

const FADE_DURATION = {
    jumpUp: 0.08,
    flutter: 0.08,
    skid: 0.08,
    stamp: 0.08,
    landSoft: 0.08,
    landHard: 0.08,
    hurtBump: 0.08,
    walk: 0.12,
    run: 0.12,
    fall: 0.12,
    push: 0.12,
    grind: 0.12,
    interact: 0.12,
    idle: 0.15,
    idleLong: 0.15,
    sitLaptop: 0.15,
    wave: 0.15,
    celebrate: 0.15,
}

const EYE_UV_OFFSETS = {
    open: [ 0, 0 ],
    half: [ 1 / 16, 0 ],
    blink: [ 1 / 16, 1 / 16 ],
}

const MOUTH_UV_OFFSETS = {
    smile: [ 0, 0 ],
    neutral: [ 1 / 16, 0 ],
    o: [ 3 / 16, 0 ],
}

function clamp(value, min, max)
{
    return Math.max(min, Math.min(max, value))
}

export class CharacterVisual
{
    constructor(player)
    {
        this.player = player
        this.controller = player.controller
        this.game = Game.getInstance()

        this.root = new THREE.Group()
        this.root.name = 'victorVisual'

        this.clips = new Map()
        this.actions = new Map()
        this.mixer = null
        this.modelScene = null

        this.state = 'idle'
        this.clipName = 'idle'
        this.timeScale = 1
        this.activeAction = null
        this.transitions = []
        this.extrasLoaded = false
        this.extrasPromise = null

        // Deterministic fixed-step state timers
        this.idleTimer = 0
        this.pushTimer = 0
        this.landTimer = 0
        this.landState = 'landSoft'
        this.hurtTimer = 0
        this.interactTimer = 0
        this.overrideState = null
        this.overrideTimer = 0

        // T2.9b procedural layers (all toggleable in ?debug & window.__victorVisual.procedural)
        this.procedural = {
            lean: true,
            squash: true,
            lookAt: true,
            scarf: true,
            face: true,
        }

        // Squash & stretch state
        this.squashY = 1

        // Look-at state
        this.lookYaw = 0
        this.lookPitch = 0
        this.bones = { head: null, neck: null, scarf1: null, scarf2: null, scarf3: null }

        // Scarf spring-damper states
        this.scarfSprings = [
            { pitch: 0, yaw: 0, pitchVel: 0, yawVel: 0 },
            { pitch: 0, yaw: 0, pitchVel: 0, yawVel: 0 },
            { pitch: 0, yaw: 0, pitchVel: 0, yawVel: 0 },
        ]

        // Face UV state
        this.faceMeshes = { eyeL: null, eyeR: null, mouth: null }
        this.baseUvs = { eyeL: null, eyeR: null, mouth: null }
        this.eyeState = 'open'
        this.mouthState = 'smile'
        this.blinkClock = 0

        this._tempEuler = new THREE.Euler(0, 0, 0, 'YXZ')
        this._tempQuat = new THREE.Quaternion()

        this.setupModel()
        this.bindControllerEvents()
        this.exposeDebugApi()
        this.setDebug()
    }

    setupModel()
    {
        const gltf = this.game.resources?.victorCore
        if(!gltf)
        {
            console.warn('[CharacterVisual] victorCore resource missing')
            return
        }

        this.modelScene = gltf.scene
        this.modelScene.name = 'victorModel'

        // Align feet (y = 0 in GLB) to bottom of capsule and face -Z (GLB faces +Z)
        const feetOffset = -(feel.body.halfHeight + feel.body.radius)
        this.modelScene.position.set(0, feetOffset, 0)
        this.modelScene.rotation.set(0, Math.PI, 0)

        const material = this.createPaletteMaterial()
        this.modelScene.traverse((child) =>
        {
            if(child.isMesh)
            {
                if(material)
                    child.material = material
                child.castShadow = true
                child.receiveShadow = true
                child.frustumCulled = false

                if(child.name === 'VictorEye.L')
                    this.cacheFaceMesh('eyeL', child)
                else if(child.name === 'VictorEye.R')
                    this.cacheFaceMesh('eyeR', child)
                else if(child.name === 'VictorMouth')
                    this.cacheFaceMesh('mouth', child)
            }
            if(child.isBone)
            {
                if(child.name === 'head') this.bones.head = child
                else if(child.name === 'neck') this.bones.neck = child
                else if(child.name === 'scarf.01') this.bones.scarf1 = child
                else if(child.name === 'scarf.02') this.bones.scarf2 = child
                else if(child.name === 'scarf.03') this.bones.scarf3 = child
            }
        })

        this.root.add(this.modelScene)
        this.mixer = new THREE.AnimationMixer(this.modelScene)
        this.registerClips(gltf.animations)
        this.applyState('idle', true)
    }

    createPaletteMaterial()
    {
        const paletteTex = this.game.resources?.palette
        if(!paletteTex)
            return null

        paletteTex.colorSpace = THREE.SRGBColorSpace
        paletteTex.minFilter = THREE.NearestFilter
        paletteTex.magFilter = THREE.NearestFilter
        paletteTex.generateMipmaps = false
        paletteTex.flipY = false
        paletteTex.needsUpdate = true

        const mat = new MeshDefaultMaterial({
            colorNode: texture(paletteTex).rgb,
            hasCoreShadows: true,
            hasDropShadows: true,
        })
        mat.userData.prevent = true
        return mat
    }

    cacheFaceMesh(key, mesh)
    {
        this.faceMeshes[key] = mesh
        const uvAttr = mesh.geometry?.attributes?.uv
        if(uvAttr)
            this.baseUvs[key] = new Float32Array(uvAttr.array)
    }

    registerClips(animations = [])
    {
        if(!this.mixer)
            return

        for(const clip of animations)
        {
            if(!clip?.name || this.clips.has(clip.name))
                continue

            this.clips.set(clip.name, clip)
            const action = this.mixer.clipAction(clip)
            if(ONE_SHOT_STATES.has(clip.name))
            {
                action.setLoop(THREE.LoopOnce, 1)
                action.clampWhenFinished = true
            }
            else
            {
                action.setLoop(THREE.LoopRepeat, Infinity)
            }
            this.actions.set(clip.name, action)
        }
    }

    loadExtras()
    {
        if(this.extrasLoaded)
            return Promise.resolve(true)
        if(this.extrasPromise)
            return this.extrasPromise

        this.extrasPromise = this.game.resourcesLoader
            .load([ [ 'victorExtras', 'character/victor_extras.glb', 'gltf' ] ])
            .then((resources) =>
            {
                if(resources?.victorExtras?.animations)
                    this.registerClips(resources.victorExtras.animations)
                this.extrasLoaded = true

                // If current state was using a fallback clip, upgrade to the real clip now
                if(this.clips.has(this.state) && this.clipName !== this.state)
                    this.applyState(this.state, false)

                return true
            })
            .catch((err) =>
            {
                console.warn('[CharacterVisual] Failed to lazy-load victor_extras.glb', err)
                return false
            })

        return this.extrasPromise
    }

    bindControllerEvents()
    {
        this.controller.events.on('jump', () =>
        {
            this.landTimer = 0
            this.squashY = 1.18
        })

        this.controller.events.on('land', ({ speed }) =>
        {
            if(speed >= 9.0)
            {
                this.landState = 'landHard'
                this.landTimer = 0.32
                this.squashY = 0.78
            }
            else if(speed >= 2.0)
            {
                this.landState = 'landSoft'
                this.landTimer = 0.18
                this.squashY = 0.86
            }
        })

        this.controller.events.on('stampStart', () =>
        {
            this.squashY = 1.10
        })

        this.controller.events.on('stamp', () =>
        {
            this.landState = 'landHard'
            this.landTimer = 0.25
            this.squashY = 0.78
        })

        this.controller.events.on('bump', () =>
        {
            this.hurtTimer = 0.35
        })

        this.controller.events.on('teleport', () =>
        {
            this.idleTimer = 0
            this.pushTimer = 0
            this.landTimer = 0
            this.hurtTimer = 0
            this.interactTimer = 0
            this.overrideState = null
            this.overrideTimer = 0
            this.squashY = 1
            for(const s of this.scarfSprings)
                s.pitch = s.yaw = s.pitchVel = s.yawVel = 0
            this.applyState('idle', true)
        })

        this.player.events.on('interact', () =>
        {
            this.interactTimer = 0.45
        })
    }

    trigger(state, duration = 1.0)
    {
        if(!(state in CORE_FALLBACK))
            return false
        this.overrideState = state
        this.overrideTimer = duration
        this.applyState(state, false)
        return true
    }

    resolveState(dt)
    {
        const c = this.controller
        const hSpeed = c.movedSpeed

        if(this.overrideTimer > 0)
        {
            this.overrideTimer = Math.max(0, this.overrideTimer - dt)
            if(this.overrideTimer === 0)
                this.overrideState = null
            else
                return this.overrideState
        }

        if(this.hurtTimer > 0)
        {
            this.hurtTimer = Math.max(0, this.hurtTimer - dt)
            if(c.grounded && hSpeed > 0.6)
                this.hurtTimer = 0
            else
                return 'hurtBump'
        }

        if(this.interactTimer > 0)
        {
            this.interactTimer = Math.max(0, this.interactTimer - dt)
            if(hSpeed > 0.6 || !c.grounded)
                this.interactTimer = 0
            else
                return 'interact'
        }

        if(c.stamp.active)
        {
            this.landTimer = 0
            return 'stamp'
        }

        if(!c.grounded)
        {
            this.idleTimer = 0
            this.pushTimer = 0
            this.landTimer = 0
            if(c.gliding)
                return 'flutter'
            if(c.velocity.y > 0.5 || (c.jumping && c.velocity.y >= -0.5))
                return 'jumpUp'
            return 'fall'
        }

        if(this.player.grinding)
            return 'grind'
        if(this.player.sittingLaptop)
            return 'sitLaptop'

        if(c.skidTimer > 0)
        {
            this.idleTimer = 0
            this.landTimer = 0
            return 'skid'
        }

        if(this.landTimer > 0)
        {
            this.landTimer = Math.max(0, this.landTimer - dt)
            if(hSpeed > 1.2)
                this.landTimer = 0
            else
                return this.landState
        }

        // Pushing against a wall/crate: input active, grounded, barely moving
        const wantsMove = this.player.input.speed > 0.1
        if(wantsMove && hSpeed < 0.25)
            this.pushTimer += dt
        else
            this.pushTimer = 0

        if(this.pushTimer >= 0.18)
        {
            this.idleTimer = 0
            return 'push'
        }

        if(hSpeed >= 3.6)
        {
            this.idleTimer = 0
            return 'run'
        }

        if(hSpeed >= 0.25)
        {
            this.idleTimer = 0
            return 'walk'
        }

        this.idleTimer += dt
        if(this.idleTimer >= 6.0)
            return 'idleLong'

        return 'idle'
    }

    applyState(nextState, immediate = false)
    {
        const prevState = this.state
        const targetClip = this.clips.has(nextState) ? nextState : (CORE_FALLBACK[nextState] ?? 'idle')
        const nextAction = this.actions.get(targetClip)

        if(nextState !== prevState || targetClip !== this.clipName)
        {
            const fade = immediate ? 0 : (FADE_DURATION[nextState] ?? 0.12)

            if(nextAction && nextAction !== this.activeAction)
            {
                nextAction.enabled = true
                nextAction.reset()
                nextAction.setEffectiveWeight(1)
                nextAction.play()

                if(this.activeAction && fade > 0)
                    this.activeAction.crossFadeTo(nextAction, fade, false)
                else if(this.activeAction)
                    this.activeAction.stop()

                this.activeAction = nextAction
            }

            if(nextState !== prevState)
            {
                this.transitions.push({
                    from: prevState,
                    to: nextState,
                    clip: targetClip,
                    fade,
                    step: this.controller.steps,
                })
                if(this.transitions.length > MAX_TRANSITIONS_LOG)
                    this.transitions.shift()
            }

            this.state = nextState
            this.clipName = targetClip
        }
    }

    fixedUpdate(dt)
    {
        const nextState = this.resolveState(dt)
        if(nextState !== this.state)
            this.applyState(nextState, false)

        // Speed-matched run/walk timeScale
        const hSpeed = this.controller.movedSpeed
        if(this.clipName === 'run')
            this.timeScale = clamp(hSpeed / 7.0, 0.55, 1.45)
        else if(this.clipName === 'walk')
            this.timeScale = clamp(hSpeed / 3.0, 0.55, 1.35)
        else
            this.timeScale = 1

        if(this.activeAction)
            this.activeAction.setEffectiveTimeScale(this.timeScale)
    }

    update(dt)
    {
        if(!this.mixer)
            return

        const safeDt = Math.min(dt, 0.05)
        this.mixer.update(safeDt)

        this.updateLean()
        this.updateSquash(safeDt)
        this.updateLookAt(safeDt)
        this.updateScarf(safeDt)
        this.updateFaceUv(safeDt)
    }

    updateLean()
    {
        if(!this.procedural.lean)
        {
            this.root.rotation.x = 0
            this.root.rotation.z = 0
            return
        }

        const speedRatio = clamp(this.controller.movedSpeed / 7.0, 0, 1)
        let pitch = -speedRatio * (8 * DEG)
        let roll = this.controller.lean

        const mag = Math.hypot(pitch, roll)
        if(mag > MAX_LEAN_RAD && mag > 1e-6)
        {
            const scale = MAX_LEAN_RAD / mag
            pitch *= scale
            roll *= scale
        }

        this.root.rotation.x = pitch
        this.root.rotation.z = roll
    }

    updateSquash(dt)
    {
        this.squashY += (1 - this.squashY) * Math.min(1, 14 * dt)
        if(Math.abs(this.squashY - 1) < 1e-4)
            this.squashY = 1

        if(!this.procedural.squash)
        {
            this.root.scale.set(1, 1, 1)
            return
        }

        const y = clamp(this.squashY, 0.78, 1.20)
        const xz = 1 / Math.sqrt(y)
        this.root.scale.set(xz, y, xz)
    }

    updateLookAt(dt)
    {
        if(!this.procedural.lookAt || (!this.bones.head && !this.bones.neck))
        {
            this.lookYaw = 0
            this.lookPitch = 0
            return
        }

        let targetYaw = 0
        let targetPitch = 0

        if(this.player.walkTarget)
        {
            const dx = this.player.walkTarget.x - this.player.model.position.x
            const dz = this.player.walkTarget.z - this.player.model.position.z
            if(dx * dx + dz * dz > 0.04)
            {
                const worldHeading = Math.atan2(-dx, -dz)
                targetYaw = Math.atan2(Math.sin(worldHeading - this.controller.yaw), Math.cos(worldHeading - this.controller.yaw))
            }
        }
        else if(this.player.input.speed > 0.1)
        {
            const worldHeading = Math.atan2(-this.player.input.x, -this.player.input.z)
            targetYaw = Math.atan2(Math.sin(worldHeading - this.controller.yaw), Math.cos(worldHeading - this.controller.yaw))
        }

        if(!this.controller.grounded)
            targetPitch = clamp(-this.controller.velocity.y * 0.025, -15 * DEG, 15 * DEG)

        targetYaw = clamp(targetYaw, -32 * DEG, 32 * DEG)

        const alpha = 1 - Math.exp(-10 * dt)
        this.lookYaw += (targetYaw - this.lookYaw) * alpha
        this.lookPitch += (targetPitch - this.lookPitch) * alpha

        if(this.bones.neck)
        {
            this._tempEuler.set(this.lookPitch * 0.4, this.lookYaw * 0.4, 0)
            this._tempQuat.setFromEuler(this._tempEuler)
            this.bones.neck.quaternion.multiply(this._tempQuat)
        }
        if(this.bones.head)
        {
            this._tempEuler.set(this.lookPitch * 0.6, this.lookYaw * 0.6, 0)
            this._tempQuat.setFromEuler(this._tempEuler)
            this.bones.head.quaternion.multiply(this._tempQuat)
        }
    }

    updateScarf(dt)
    {
        const scarfBones = [ this.bones.scarf1, this.bones.scarf2, this.bones.scarf3 ]
        if(!this.procedural.scarf || !scarfBones[0])
            return

        const speed = this.controller.movedSpeed
        const vy = this.controller.velocity.y
        const t = this.game.ticker.elapsed

        const stiffness = 95
        const damping = 11

        for(let i = 0; i < 3; i++)
        {
            const bone = scarfBones[i]
            if(!bone)
                continue

            const s = this.scarfSprings[i]
            const weight = 0.35 + i * 0.25
            const wind = Math.sin(t * 2.6 + i * 1.1) * (3 + speed * 0.8) * DEG
            const targetPitch = clamp((speed * 0.055 - vy * 0.028) * weight, -28 * DEG, 38 * DEG)
            const targetYaw = clamp(wind + this.controller.lean * 0.5 * weight, -22 * DEG, 22 * DEG)

            const accPitch = (targetPitch - s.pitch) * stiffness - s.pitchVel * damping
            const accYaw = (targetYaw - s.yaw) * stiffness - s.yawVel * damping

            s.pitchVel += accPitch * dt
            s.yawVel += accYaw * dt
            s.pitch = clamp(s.pitch + s.pitchVel * dt, -35 * DEG, 45 * DEG)
            s.yaw = clamp(s.yaw + s.yawVel * dt, -28 * DEG, 28 * DEG)

            this._tempEuler.set(s.pitch, s.yaw, 0)
            this._tempQuat.setFromEuler(this._tempEuler)
            bone.quaternion.multiply(this._tempQuat)
        }
    }

    updateFaceUv(dt)
    {
        let nextEye = 'open'
        let nextMouth = 'smile'

        if(this.procedural.face)
        {
            this.blinkClock = (this.blinkClock + dt) % 3.4
            if(this.blinkClock < 0.04)
                nextEye = 'half'
            else if(this.blinkClock < 0.11)
                nextEye = 'blink'
            else if(this.blinkClock < 0.15)
                nextEye = 'half'
            else
                nextEye = 'open'

            if(this.state === 'jumpUp' || this.state === 'flutter' || this.state === 'stamp' || this.state === 'hurtBump')
                nextMouth = 'o'
            else if(this.state === 'idle' || this.state === 'idleLong' || this.state === 'walk' || this.state === 'wave' || this.state === 'celebrate')
                nextMouth = 'smile'
            else
                nextMouth = 'neutral'
        }

        if(nextEye !== this.eyeState)
        {
            this.eyeState = nextEye
            const [ du, dv ] = EYE_UV_OFFSETS[nextEye]
            this.applyUvOffset('eyeL', du, dv)
            this.applyUvOffset('eyeR', du, dv)
        }

        if(nextMouth !== this.mouthState)
        {
            this.mouthState = nextMouth
            const [ du, dv ] = MOUTH_UV_OFFSETS[nextMouth]
            this.applyUvOffset('mouth', du, dv)
        }
    }

    applyUvOffset(key, du, dv)
    {
        const mesh = this.faceMeshes[key]
        const base = this.baseUvs[key]
        const uvAttr = mesh?.geometry?.attributes?.uv
        if(!uvAttr || !base)
            return

        const arr = uvAttr.array
        for(let i = 0; i < arr.length; i += 2)
        {
            arr[i] = base[i] + du
            arr[i + 1] = base[i + 1] + dv
        }
        uvAttr.needsUpdate = true
    }

    exposeDebugApi()
    {
        if(typeof window === 'undefined')
            return

        const self = this
        window.__victorVisual = {
            get state() { return self.state },
            get clip() { return self.clipName },
            get timeScale() { return self.timeScale },
            get transitions() { return self.transitions },
            get procedural() { return self.procedural },
            get clipsLoaded() { return Array.from(self.clips.keys()) },
            get extrasLoaded() { return self.extrasLoaded },
            get extrasPromise() { return self.extrasPromise },
            get eyeState() { return self.eyeState },
            get mouthState() { return self.mouthState },
            get squashY() { return self.squashY },
            get leanDeg()
            {
                return {
                    pitch: self.root.rotation.x / DEG,
                    roll: self.root.rotation.z / DEG,
                }
            },
            trigger: (state, duration) => self.trigger(state, duration),
        }
    }

    setDebug()
    {
        if(!this.game.debug.active)
            return

        const folder = this.debugPanel = this.game.debug.panel.addFolder({ title: '🎭 Victor', expanded: false })
        folder.addBinding(this.procedural, 'lean', { label: 'lean' })
        folder.addBinding(this.procedural, 'squash', { label: 'squash' })
        folder.addBinding(this.procedural, 'lookAt', { label: 'lookAt' })
        folder.addBinding(this.procedural, 'scarf', { label: 'scarf' })
        folder.addBinding(this.procedural, 'face', { label: 'blink & mouth' })

        this.game.debug.addButtons(folder, {
            wave: () => this.trigger('wave', 1.2),
            celebrate: () => this.trigger('celebrate', 1.5),
            sitLaptop: () => this.trigger('sitLaptop', 2.0),
        }, 'actions')
    }
}
