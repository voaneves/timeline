import { Events } from './Events.js'
import { Game } from './Game.js'
import { resolveAsset } from './assetManifest.js'

const DUCK_DB = -8
const DUCK_GAIN = Math.pow(10, DUCK_DB / 20) // 0.3981071705534972
const STRIDE_DISTANCE = 1.75
const HARD_LAND_SPEED = 9.0
const SKID_COOLDOWN_MS = 180
const AUDIO_LOG_CAP = 256

const ORIGENS_BOUNDS = {
    minX: -37.3,
    maxX: 37.3,
    minZ: -49.0,
    maxZ: 24.0,
}

export const SOUND_REGISTRY = {
    // Surface footsteps (T2.24a)
    stepLaterite: [
        'sounds/common/step_laterite_01.mp3',
        'sounds/common/step_laterite_02.mp3',
        'sounds/common/step_laterite_03.mp3',
        'sounds/common/step_laterite_04.mp3',
    ],
    stepGrass: [
        'sounds/common/step_grass_01.mp3',
        'sounds/common/step_grass_02.mp3',
        'sounds/common/step_grass_03.mp3',
        'sounds/common/step_grass_04.mp3',
    ],
    stepWood: [
        'sounds/common/step_wood_01.mp3',
        'sounds/common/step_wood_02.mp3',
        'sounds/common/step_wood_03.mp3',
    ],
    stepStone: [
        'sounds/common/step_stone_01.mp3',
        'sounds/common/step_stone_02.mp3',
        'sounds/common/step_stone_03.mp3',
    ],

    // Locomotion SFX (T2.24a)
    jumpLaunch: [ 'sounds/common/jump_launch.mp3' ],
    flutterRibbon: [ 'sounds/common/flutter_ribbon.mp3' ],
    landSoft: [ 'sounds/common/land_soft.mp3' ],
    landHard: [ 'sounds/common/land_hard.mp3' ],
    skidDust: [ 'sounds/common/skid_dust.mp3' ],

    // Interaction SFX (T2.24b)
    stampLock: [ 'sounds/common/stamp_lock.mp3' ],
    stampImpact: [ 'sounds/common/stamp_impact.mp3' ],
    blockBump: [ 'sounds/common/block_bump.mp3' ],
    blockSolid: [ 'sounds/common/block_solid.mp3' ],
    signalCollect: [ 'sounds/common/signal_collect.mp3' ],
    cardOpen: [ 'sounds/common/card_open.mp3' ],
    cardClose: [ 'sounds/common/card_close.mp3' ],
    grindLoop: [ 'sounds/common/grind_loop.mp3' ],
    linePluck: [
        'sounds/common/line_pluck_01.mp3',
        'sounds/common/line_pluck_02.mp3',
        'sounds/common/line_pluck_03.mp3',
    ],

    // Era 1 Ambiences (T2.24c)
    ambCerrado: [ 'sounds/origens/amb_cerrado_dawn.mp3' ],
    ambRio: [ 'sounds/origens/amb_rio_tocantins.mp3' ],
}

function clamp(v, min, max)
{
    return Math.max(min, Math.min(max, v))
}

function smoothstep(edge0, edge1, x)
{
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
}

/**
 * Runtime Web Audio engine (T2.24a/b/c):
 * - Out of critical load path: `loadBank()` is invoked only post-reveal.
 * - Muted/suspended until user gesture or explicit HUD "Som" toggle.
 * - Anti-repeat footsteps & plucks with ±12% pitch and ±10% volume variation.
 * - Speed-scaled grind loop, riverbank ambience crossfade, and -8 dB card ducking.
 */
export class Audio
{
    constructor(game = Game.getInstance())
    {
        this.game = game
        this.events = new Events()
        this.buffers = new Map()
        this.recentVariants = new Map()
        this.recentPlays = []

        this.ctx = null
        this.masterGain = null
        this.sfxGain = null
        this.ambienceGain = null
        this.duckGain = null

        this.unlocked = false
        this.bankLoaded = false
        this.bankPromise = null
        this.muted = !(this.game?.ui?.options?.sound ?? true)
        this.ducked = false
        this.duckTarget = 1.0
        this.duckCurrent = 1.0

        this.strideDistance = 0
        this.lastFootstepPos = null
        this.lastSkidMs = -Infinity
        this.rngState = 0x13572468

        this.grindSource = null
        this.grindGain = null
        this.ambienceNodes = null
        this.terrainPixels = null
        this.dialogObserver = null

        this.setupLog()
        this.bindEvents()
        this.bindUnlockGestures()
    }

    setupLog()
    {
        if(typeof window === 'undefined')
            return
        if(!Array.isArray(window.__audioLog))
            window.__audioLog = []

        const self = this
        Object.defineProperty(window, '__audioState', {
            configurable: true,
            get()
            {
                return {
                    bankLoaded: self.bankLoaded,
                    unlocked: self.unlocked,
                    muted: self.muted,
                    ducked: self.ducked,
                    duckGain: self.duckCurrent,
                    duckDb: self.duckCurrent > 0 ? 20 * Math.log10(self.duckCurrent) : -Infinity,
                    buffersCount: self.buffers.size,
                }
            },
        })
    }

    nextRandom()
    {
        // Deterministic-friendly LCG for variation without touching fixedTick simulation
        this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0
        return this.rngState / 4294967296
    }

    ensureContext()
    {
        if(this.ctx)
            return this.ctx
        if(typeof window === 'undefined')
            return null

        const AudioCtx = window.AudioContext || window.webkitAudioContext
        if(!AudioCtx)
            return null

        try
        {
            this.ctx = new AudioCtx()
            this.masterGain = this.ctx.createGain()
            this.sfxGain = this.ctx.createGain()
            this.ambienceGain = this.ctx.createGain()
            this.duckGain = this.ctx.createGain()

            this.masterGain.gain.value = this.muted ? 0 : 1
            this.sfxGain.gain.value = 1
            this.ambienceGain.gain.value = 0.55
            this.duckGain.gain.value = this.duckTarget

            this.sfxGain.connect(this.masterGain)
            this.ambienceGain.connect(this.duckGain)
            this.duckGain.connect(this.masterGain)
            this.masterGain.connect(this.ctx.destination)
        }
        catch
        {
            this.ctx = null
        }

        return this.ctx
    }

    bindUnlockGestures()
    {
        if(typeof window === 'undefined')
            return

        this._unlockEvents = [ 'pointerdown', 'keydown', 'touchstart' ]
        this._unlockHandler = () =>
        {
            this.unlock()
        }

        for(const evt of this._unlockEvents)
            window.addEventListener(evt, this._unlockHandler, { passive: true })

        document.addEventListener('visibilitychange', () =>
        {
            if(!this.ctx || !this.masterGain)
                return
            if(document.hidden)
                this.setBusGain(this.masterGain, 0, 0.04)
            else if(!this.muted)
                this.setBusGain(this.masterGain, 1, 0.08)
        })
    }

    cleanupUnlockGestures()
    {
        if(typeof window === 'undefined' || !this._unlockHandler)
            return
        if(this.unlocked && this.ctx?.state === 'running')
        {
            for(const evt of this._unlockEvents)
                window.removeEventListener(evt, this._unlockHandler)
            this._unlockHandler = null
        }
    }

    unlock()
    {
        if(this.game?.paused)
            return

        const ctx = this.ensureContext()
        this.unlocked = true
        if(ctx && ctx.state === 'suspended' && !this.muted)
        {
            ctx.resume().then(() => this.cleanupUnlockGestures()).catch(() => {})
        }
        else if(ctx && ctx.state === 'running')
        {
            this.cleanupUnlockGestures()
        }
        if(this.bankLoaded && !this.ambienceNodes && !this.muted)
            this.startAmbience()
    }

    setBusGain(gainNode, target, fadeSeconds = 0.08)
    {
        if(!gainNode || !this.ctx)
            return
        const now = this.ctx.currentTime
        try
        {
            gainNode.gain.cancelScheduledValues(now)
            gainNode.gain.setValueAtTime(gainNode.gain.value, now)
            gainNode.gain.linearRampToValueAtTime(target, now + fadeSeconds)
        }
        catch
        {
            gainNode.gain.value = target
        }
    }

    setMuted(muted)
    {
        this.muted = Boolean(muted)
        if(this.masterGain && this.ctx)
            this.setBusGain(this.masterGain, this.muted ? 0 : 1, 0.06)

        if(!this.muted)
        {
            this.unlock()
            if(this.bankLoaded && !this.ambienceNodes)
                this.startAmbience()
        }
    }

    setDucked(ducked)
    {
        const nextDucked = Boolean(ducked)
        this.ducked = nextDucked
        this.duckTarget = nextDucked ? DUCK_GAIN : 1.0
        this.duckCurrent = this.duckTarget

        if(this.duckGain && this.ctx)
            this.setBusGain(this.duckGain, this.duckTarget, 0.12)
    }

    syncDialogDucking()
    {
        if(typeof document === 'undefined')
            return
        const hasOpenDialog = Boolean(document.querySelector('dialog[open]'))
        this.setDucked(hasOpenDialog)
    }

    async resolveSoundUrl(logicalPath)
    {
        try
        {
            const manifest = await this.game?.resourcesLoader?.getManifest?.()
            if(manifest)
                return resolveAsset(manifest, logicalPath, document.baseURI)
        }
        catch {}
        return new URL(logicalPath, document.baseURI).href
    }

    async loadBank()
    {
        if(this.bankLoaded)
            return true
        if(this.bankPromise)
            return this.bankPromise

        this.bankPromise = (async () =>
        {
            const ctx = this.ensureContext()
            const uniqueFiles = new Set()
            for(const list of Object.values(SOUND_REGISTRY))
            {
                for(const path of list)
                    uniqueFiles.add(path)
            }

            await Promise.all([ ...uniqueFiles ].map(async (logicalPath) =>
            {
                try
                {
                    const url = await this.resolveSoundUrl(logicalPath)
                    const res = await fetch(url)
                    if(!res.ok)
                        return
                    const arr = await res.arrayBuffer()
                    if(ctx)
                    {
                        const decoded = await ctx.decodeAudioData(arr)
                        this.buffers.set(logicalPath, decoded)
                    }
                    else
                    {
                        this.buffers.set(logicalPath, true)
                    }
                }
                catch {}
            }))

            this.bankLoaded = true
            this.events.trigger('bankLoaded')
            if(this.unlocked && !this.muted)
                this.startAmbience()
            return true
        })()

        return this.bankPromise
    }

    bindEvents()
    {
        // HUD Sound mute/unmute & Menu events
        this.game?.hud?.events?.on('optionChange', (key, value) =>
        {
            if(key === 'sound')
                this.setMuted(!value)
        })
        this.game?.hud?.events?.on('menuOpen', () => this.syncDialogDucking())
        this.game?.hud?.events?.on('menuClose', () => this.syncDialogDucking())

        if(typeof window !== 'undefined')
        {
            window.addEventListener('timeline:option', (event) =>
            {
                if(event?.detail?.key === 'sound')
                    this.setMuted(!event.detail.value)
            })
        }

        // Card open / close + ducking
        this.game?.cards?.events?.on('open', () =>
        {
            this.playKey('cardOpen', { baseVolume: 0.72, event: 'cardOpen' })
            this.setDucked(true)
        })
        this.game?.cards?.events?.on('close', () =>
        {
            this.playKey('cardClose', { baseVolume: 0.68, event: 'cardClose' })
            this.syncDialogDucking()
        })

        // Observe <dialog open> mutations as an extra guarantee for card/menu ducking
        if(typeof MutationObserver !== 'undefined' && typeof document !== 'undefined')
        {
            this.dialogObserver = new MutationObserver(() => this.syncDialogDucking())
            this.dialogObserver.observe(document.body, {
                subtree: true,
                attributes: true,
                attributeFilter: [ 'open' ],
            })
        }

        // Character controller events
        const controller = this.game?.world?.player?.controller
        if(controller?.events)
        {
            controller.events.on('jump', () => this.playKey('jumpLaunch', { baseVolume: 0.75, event: 'jump' }))
            controller.events.on('glide', () => this.playKey('flutterRibbon', { baseVolume: 0.65, event: 'glide' }))
            controller.events.on('land', (info) =>
            {
                const speed = info?.speed ?? 0
                if(speed >= HARD_LAND_SPEED)
                    this.playKey('landHard', { baseVolume: 0.82, event: 'landHard' })
                else
                    this.playKey('landSoft', { baseVolume: 0.62, event: 'landSoft' })
            })
            controller.events.on('skid', () =>
            {
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
                if(now - this.lastSkidMs < SKID_COOLDOWN_MS)
                    return
                this.lastSkidMs = now
                this.playKey('skidDust', { baseVolume: 0.60, event: 'skid' })
            })
            controller.events.on('stampStart', () => this.playKey('stampLock', { baseVolume: 0.75, event: 'stampStart' }))
            controller.events.on('stamp', () => this.playKey('stampImpact', { baseVolume: 0.88, event: 'stamp' }))
            controller.events.on('bump', () => this.playKey('blockSolid', { baseVolume: 0.70, event: 'blockSolid' }))
            controller.events.on('break', () => this.playKey('blockBump', { baseVolume: 0.80, event: 'blockBump' }))
            controller.events.on('teleport', () =>
            {
                this.strideDistance = 0
                this.lastFootstepPos = null
            })

            // Grind events
            controller.events.on('grindStart', (info) => this.startGrind(info?.speed ?? 11.5))
            controller.events.on('grindTick', (info) => this.updateGrind(info?.speed ?? 11.5))
            controller.events.on('grindEnd', () => this.stopGrind())
            controller.events.on('milestonePass', () => this.playKey('linePluck', { baseVolume: 0.78, event: 'milestonePass' }))
        }

        // Frame tick for footsteps stride & ambience crossfade
        this.game?.ticker?.events?.on('tick', () => this.update(), 8)
    }

    pickVariant(key, list)
    {
        if(list.length === 1)
            return list[0]

        const recent = this.recentVariants.get(key) || []
        const lastIdx = recent.length > 0 ? recent[recent.length - 1] : -1
        const prevIdx = recent.length > 1 ? recent[recent.length - 2] : -1

        const candidates = []
        for(let i = 0; i < list.length; i++)
        {
            if(i !== lastIdx && !(i === lastIdx && i === prevIdx))
                candidates.push(i)
        }
        const pool = candidates.length > 0 ? candidates : list.map((_, i) => i)
        const chosen = pool[Math.floor(this.nextRandom() * pool.length)]

        recent.push(chosen)
        if(recent.length > 2)
            recent.shift()
        this.recentVariants.set(key, recent)

        return list[chosen]
    }

    computeVariedParams(file, baseVolume = 0.75)
    {
        const recent = this.recentPlays
        const prev1 = recent[recent.length - 1]
        const prev2 = recent[recent.length - 2]

        let rate = 1
        let volume = baseVolume

        for(let attempt = 0; attempt < 8; attempt++)
        {
            // ±12% rate (within ±8–15%), ±10% volume
            rate = Number((0.88 + this.nextRandom() * 0.24).toFixed(3))
            volume = Number((baseVolume * (0.90 + this.nextRandom() * 0.20)).toFixed(3))

            const sameAsLast2 = prev1 && prev2 &&
                prev1.file === file && prev2.file === file &&
                prev1.rate === rate && prev2.rate === rate &&
                prev1.volume === volume && prev2.volume === volume
            const sameAsLast1 = prev1 && prev1.file === file && prev1.rate === rate && prev1.volume === volume

            if(!sameAsLast2 && !sameAsLast1)
                break
        }

        return { rate, volume }
    }

    recordPlay(entry)
    {
        this.recentPlays.push(entry)
        if(this.recentPlays.length > 16)
            this.recentPlays.shift()

        if(typeof window !== 'undefined' && Array.isArray(window.__audioLog))
        {
            if(window.__audioLog.length >= AUDIO_LOG_CAP)
                window.__audioLog.shift()
            window.__audioLog.push(entry)
        }
    }

    playKey(key, { baseVolume = 0.75, event = key, surface = null, rateOverride = null } = {})
    {
        const list = SOUND_REGISTRY[key]
        if(!list || list.length === 0)
            return null

        const file = this.pickVariant(key, list)
        const { rate: variedRate, volume } = this.computeVariedParams(file, baseVolume)
        const rate = rateOverride ?? variedRate

        const entry = {
            event,
            file,
            rate,
            volume,
            surface,
        }
        this.recordPlay(entry)

        if(!this.muted && this.ctx && this.sfxGain)
        {
            const buffer = this.buffers.get(file)
            if(buffer && buffer instanceof AudioBuffer)
            {
                try
                {
                    if(this.ctx.state === 'suspended' && this.unlocked)
                    {
                        if(this.game?.paused)
                            return
                        this.ctx.resume().then(() => this.cleanupUnlockGestures()).catch(() => {})
                    }

                    const source = this.ctx.createBufferSource()
                    source.buffer = buffer
                    source.playbackRate.value = rate

                    const gain = this.ctx.createGain()
                    gain.gain.value = volume
                    source.connect(gain)
                    gain.connect(this.sfxGain)
                    source.start()
                }
                catch {}
            }
        }

        return entry
    }

    // Convenience interaction triggers for gameplay / tests
    playBlockBump() { return this.playKey('blockBump', { baseVolume: 0.80, event: 'blockBump' }) }
    playBlockSolid() { return this.playKey('blockSolid', { baseVolume: 0.72, event: 'blockSolid' }) }
    playSignalCollect() { return this.playKey('signalCollect', { baseVolume: 0.82, event: 'signalCollect' }) }
    playMilestonePluck() { return this.playKey('linePluck', { baseVolume: 0.78, event: 'milestonePass' }) }

    startGrind(speed = 11.5)
    {
        const rate = this.grindRateForSpeed(speed)
        this.recordPlay({
            event: 'grindStart',
            file: SOUND_REGISTRY.grindLoop[0],
            rate,
            volume: 0.65,
            surface: 'line',
        })

        if(this.muted || !this.ctx || !this.sfxGain)
            return

        const buffer = this.buffers.get(SOUND_REGISTRY.grindLoop[0])
        if(!(buffer instanceof AudioBuffer))
            return

        this.stopGrind(true)

        try
        {
            const source = this.ctx.createBufferSource()
            source.buffer = buffer
            source.loop = true
            source.playbackRate.value = rate

            const gain = this.ctx.createGain()
            gain.gain.value = 0.001
            source.connect(gain)
            gain.connect(this.sfxGain)
            source.start()
            this.setBusGain(gain, 0.65, 0.05)

            this.grindSource = source
            this.grindGain = gain
        }
        catch {}
    }

    grindRateForSpeed(speed)
    {
        const norm = clamp((speed - 9.0) / (14.0 - 9.0), 0, 1)
        return Number((0.85 + norm * 0.50).toFixed(3))
    }

    updateGrind(speed = 11.5)
    {
        if(!this.grindSource || !this.ctx)
            return
        const rate = this.grindRateForSpeed(speed)
        try
        {
            this.grindSource.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.04)
        }
        catch
        {
            this.grindSource.playbackRate.value = rate
        }
    }

    stopGrind(immediate = false)
    {
        if(!this.grindSource)
            return
        const source = this.grindSource
        const gain = this.grindGain
        this.grindSource = null
        this.grindGain = null

        try
        {
            if(immediate || !this.ctx || !gain)
            {
                source.stop()
                source.disconnect()
            }
            else
            {
                this.setBusGain(gain, 0.0001, 0.06)
                setTimeout(() =>
                {
                    try { source.stop(); source.disconnect() } catch {}
                }, 75)
            }
        }
        catch {}
    }

    startAmbience()
    {
        if(this.ambienceNodes || !this.ctx || !this.ambienceGain)
            return

        const cerradoBuf = this.buffers.get(SOUND_REGISTRY.ambCerrado[0])
        const rioBuf = this.buffers.get(SOUND_REGISTRY.ambRio[0])
        if(!(cerradoBuf instanceof AudioBuffer) && !(rioBuf instanceof AudioBuffer))
            return

        const nodes = {}
        const createLoop = (buf, initialGain) =>
        {
            if(!(buf instanceof AudioBuffer))
                return null
            const source = this.ctx.createBufferSource()
            source.buffer = buf
            source.loop = true
            const gain = this.ctx.createGain()
            gain.gain.value = initialGain
            source.connect(gain)
            gain.connect(this.ambienceGain)
            source.start()
            return { source, gain }
        }

        nodes.cerrado = createLoop(cerradoBuf, 1.0)
        nodes.rio = createLoop(rioBuf, 0.0)
        this.ambienceNodes = nodes
    }

    extractTerrainPixels()
    {
        if(this.terrainPixels)
            return this.terrainPixels

        const tex = this.game?.world?.origensEra?.grass?.terrainTexture
        const img = tex?.image
        if(!img || !img.width || !img.height || typeof document === 'undefined')
            return null

        try
        {
            const canvas = document.createElement('canvas')
            canvas.width = img.width
            canvas.height = img.height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0)
            const imageData = ctx.getImageData(0, 0, img.width, img.height)
            this.terrainPixels = {
                width: img.width,
                height: img.height,
                data: imageData.data,
                bounds: this.game?.world?.origensEra?.grass?.bounds || ORIGENS_BOUNDS,
            }
        }
        catch {}
        return this.terrainPixels
    }

    detectSurface(x, y, z)
    {
        const controller = this.game?.world?.player?.controller
        if(controller?.groundPlatform)
            return 'wood'

        const pixels = this.extractTerrainPixels()
        if(pixels)
        {
            const b = pixels.bounds
            const u = clamp((x - b.minX) / (b.maxX - b.minX), 0, 1)
            const v = clamp((z - b.minZ) / (b.maxZ - b.minZ), 0, 1)
            const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width))
            const py = Math.min(pixels.height - 1, Math.floor(v * pixels.height))
            const idx = (py * pixels.width + px) * 4
            const gMask = pixels.data[idx + 1]
            if(gMask > 128)
                return 'grass'
        }

        // Riverbank stone embankment / plaza hint
        if(z > 10 || y > 3.5)
            return 'stone'

        return 'laterite'
    }

    playFootstep(surface)
    {
        const keyMap = {
            laterite: 'stepLaterite',
            grass: 'stepGrass',
            wood: 'stepWood',
            stone: 'stepStone',
        }
        const key = keyMap[surface] || 'stepLaterite'
        return this.playKey(key, { baseVolume: 0.52, event: 'footstep', surface })
    }

    update()
    {
        const controller = this.game?.world?.player?.controller
        if(!controller)
            return

        const pos = controller.next

        // Footstep stride tracking (grounded & not grinding)
        if(controller.grounded && !controller.grind?.active && controller.movedSpeed > 0.35)
        {
            if(!this.lastFootstepPos)
            {
                this.lastFootstepPos = { x: pos.x, z: pos.z }
            }
            else
            {
                const dx = pos.x - this.lastFootstepPos.x
                const dz = pos.z - this.lastFootstepPos.z
                this.strideDistance += Math.hypot(dx, dz)
                this.lastFootstepPos.x = pos.x
                this.lastFootstepPos.z = pos.z

                if(this.strideDistance >= STRIDE_DISTANCE)
                {
                    this.strideDistance %= STRIDE_DISTANCE
                    const surface = this.detectSurface(pos.x, pos.y, pos.z)
                    this.playFootstep(surface)
                }
            }
        }
        else
        {
            this.strideDistance = 0
            this.lastFootstepPos = null
        }

        // Ambience proximity crossfade (south riverbank z > -10)
        if(this.ambienceNodes && this.ctx)
        {
            const riverMix = smoothstep(-14, -4, pos.z) * 0.85
            const cerradoMix = 1.0 - riverMix * 0.65
            if(this.ambienceNodes.cerrado)
                this.ambienceNodes.cerrado.gain.gain.setTargetAtTime(cerradoMix, this.ctx.currentTime, 0.25)
            if(this.ambienceNodes.rio)
                this.ambienceNodes.rio.gain.gain.setTargetAtTime(riverMix, this.ctx.currentTime, 0.25)
        }
    }
}
