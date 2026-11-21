import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { lerp } from '../utilities/maths.js'

const ERA_PRESETS = {
    origens: {
        skyTop: new THREE.Color('#6fa8dc'),
        skyBottom: new THREE.Color('#ffd9a8'),
        fogColor: new THREE.Color('#f2c9a0'),
        fogColorA: new THREE.Color('#ffd9a8'),
        fogColorB: new THREE.Color('#6fa8dc'),
        lightColor: new THREE.Color('#ffe2b8'),
        lightIntensity: 1.05,
        shadowColor: new THREE.Color('#6a3d5c'),
        fogNearRatio: 0.32,
        fogFarRatio: 1.25,
    },
    unicamp: {
        skyTop: new THREE.Color('#5fb3f0'),
        skyBottom: new THREE.Color('#e3f4ff'),
        fogColor: new THREE.Color('#dcefff'),
        fogColorA: new THREE.Color('#e3f4ff'),
        fogColorB: new THREE.Color('#5fb3f0'),
        lightColor: new THREE.Color('#ffffff'),
        lightIntensity: 1.15,
        shadowColor: new THREE.Color('#3d5a80'),
        fogNearRatio: 0.35,
        fogFarRatio: 1.25,
    },
    industria: {
        skyTop: new THREE.Color('#f29e4c'),
        skyBottom: new THREE.Color('#ffe0b0'),
        fogColor: new THREE.Color('#f6c99a'),
        fogColorA: new THREE.Color('#ffe0b0'),
        fogColorB: new THREE.Color('#f29e4c'),
        lightColor: new THREE.Color('#ffd08a'),
        lightIntensity: 1.0,
        shadowColor: new THREE.Color('#5b4a7a'),
        fogNearRatio: 0.32,
        fogFarRatio: 1.25,
    },
    alemanha: {
        skyTop: new THREE.Color('#9bb7d4'),
        skyBottom: new THREE.Color('#eef3f8'),
        fogColor: new THREE.Color('#e6edf5'),
        fogColorA: new THREE.Color('#eef3f8'),
        fogColorB: new THREE.Color('#9bb7d4'),
        lightColor: new THREE.Color('#f4f7ff'),
        lightIntensity: 0.95,
        shadowColor: new THREE.Color('#4a5670'),
        fogNearRatio: 0.34,
        fogFarRatio: 1.25,
    },
    dados: {
        skyTop: new THREE.Color('#2b6f8f'),
        skyBottom: new THREE.Color('#9fd9d2'),
        fogColor: new THREE.Color('#7fb8c4'),
        fogColorA: new THREE.Color('#9fd9d2'),
        fogColorB: new THREE.Color('#2b6f8f'),
        lightColor: new THREE.Color('#cfe9ff'),
        lightIntensity: 0.85,
        shadowColor: new THREE.Color('#1f3b57'),
        fogNearRatio: 0.30,
        fogFarRatio: 1.22,
    },
    transformacao: {
        skyTop: new THREE.Color('#ff8a5c'),
        skyBottom: new THREE.Color('#3b2a6b'),
        fogColor: new THREE.Color('#c98aa0'),
        fogColorA: new THREE.Color('#3b2a6b'),
        fogColorB: new THREE.Color('#ff8a5c'),
        lightColor: new THREE.Color('#ffb48a'),
        lightIntensity: 0.9,
        shadowColor: new THREE.Color('#3a2550'),
        fogNearRatio: 0.30,
        fogFarRatio: 1.22,
    },
    hub: {
        skyTop: new THREE.Color('#6fa8dc'),
        skyBottom: new THREE.Color('#f6f1e7'),
        fogColor: new THREE.Color('#e8dcc8'),
        fogColorA: new THREE.Color('#f6f1e7'),
        fogColorB: new THREE.Color('#6fa8dc'),
        lightColor: new THREE.Color('#ffe8c8'),
        lightIntensity: 1.05,
        shadowColor: new THREE.Color('#4a3a5c'),
        fogNearRatio: 0.35,
        fogFarRatio: 1.30,
    },
}

const COLOR_KEYS = [ 'skyTop', 'skyBottom', 'fogColor', 'fogColorA', 'fogColorB', 'lightColor', 'shadowColor' ]
const NUMBER_KEYS = [ 'lightIntensity', 'fogNearRatio', 'fogFarRatio' ]

/**
 * Era-based lighting, sky gradient, shadow, and fog interpolator.
 * Active when an era (such as Origens) registers it on `game.eraCycles`.
 */
export class EraCycles
{
    constructor(initialPreset = 'origens')
    {
        this.game = Game.getInstance()
        this.active = true
        this.presets = ERA_PRESETS

        const startKey = Object.hasOwn(ERA_PRESETS, initialPreset) ? initialPreset : 'origens'
        this.currentPreset = startKey
        this.fromPreset = startKey
        this.toPreset = startKey === 'origens' ? 'unicamp' : startKey
        this.progress = 0

        const seed = ERA_PRESETS[startKey]
        this.properties = {}
        for(const key of COLOR_KEYS)
            this.properties[key] = { type: 'color', value: seed[key].clone() }
        for(const key of NUMBER_KEYS)
            this.properties[key] = { type: 'number', value: seed[key] }

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 8)

        this.update()
    }

    setPreset(name)
    {
        if(!Object.hasOwn(ERA_PRESETS, name))
            return false

        this.currentPreset = name
        this.fromPreset = name
        this.toPreset = name
        this.progress = 0
        this.update()
        return true
    }

    setTransition(fromName, toName)
    {
        if(!Object.hasOwn(ERA_PRESETS, fromName) || !Object.hasOwn(ERA_PRESETS, toName))
            return false

        this.fromPreset = fromName
        this.toPreset = toName
        this.update()
        return true
    }

    setProgress(value)
    {
        const clamped = Math.max(0, Math.min(1, Number(value) || 0))
        if(this.fromPreset === this.toPreset)
        {
            this.fromPreset = 'origens'
            this.toPreset = 'unicamp'
        }
        this.progress = clamped
        this.update()
        return this.progress
    }

    update()
    {
        if(!this.active)
            return

        const from = ERA_PRESETS[this.fromPreset] || ERA_PRESETS.origens
        const to = ERA_PRESETS[this.toPreset] || from
        const t = this.progress

        for(const key of COLOR_KEYS)
            this.properties[key].value.lerpColors(from[key], to[key], t)

        for(const key of NUMBER_KEYS)
            this.properties[key].value = lerp(from[key], to[key], t)
    }

    getSnapshot()
    {
        return {
            active: this.active,
            currentPreset: this.currentPreset,
            fromPreset: this.fromPreset,
            toPreset: this.toPreset,
            progress: this.progress,
            skyTop: `#${this.properties.skyTop.value.getHexString()}`,
            skyBottom: `#${this.properties.skyBottom.value.getHexString()}`,
            fogColor: `#${this.properties.fogColor.value.getHexString()}`,
            lightColor: `#${this.properties.lightColor.value.getHexString()}`,
            lightIntensity: this.properties.lightIntensity.value,
            shadowColor: `#${this.properties.shadowColor.value.getHexString()}`,
        }
    }
}
