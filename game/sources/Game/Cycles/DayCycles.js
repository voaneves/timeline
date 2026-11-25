import * as THREE from 'three/webgpu'
import { Cycles } from './Cycles.js'

const presets = {
    day:   { revealColor: new THREE.Color('#2ad4d9'), revealIntensity: 10, electricField: 0, temperature: 14, lightColor: new THREE.Color('#fff3db'), lightIntensity: 1.25, shadowColor: new THREE.Color('#3d6cb9'), fogColorA: new THREE.Color('#68e1fd'), fogColorB: new THREE.Color('#a8d4ff'), fogNearRatio: 0.34, fogFarRatio: 1.28 },
    dusk:  { revealColor: new THREE.Color('#ff9a62'), revealIntensity: 6, electricField: 0.2, temperature: 8, lightColor: new THREE.Color('#ffaa6b'), lightIntensity: 1.22, shadowColor: new THREE.Color('#4a3a8c'), fogColorA: new THREE.Color('#ff9d6c'), fogColorB: new THREE.Color('#5b6ce6'), fogNearRatio: 0.05, fogFarRatio: 1.25 },
    night: { revealColor: new THREE.Color('#45d9ff'), revealIntensity: 9, electricField: 0.85, temperature: 0, lightColor: new THREE.Color('#4b73ff'), lightIntensity: 3.1, shadowColor: new THREE.Color('#1d2a78'), fogColorA: new THREE.Color('#0f2454'), fogColorB: new THREE.Color('#1e3a6e'), fogNearRatio: -0.75, fogFarRatio: 1.05 },
    dawn:  { revealColor: new THREE.Color('#ffd08a'), revealIntensity: 5.5, electricField: 0.2, temperature: 6, lightColor: new THREE.Color('#ffc599'), lightIntensity: 1.2, shadowColor: new THREE.Color('#6d4c8f'), fogColorA: new THREE.Color('#ffd1a6'), fogColorB: new THREE.Color('#87c6ff'), fogNearRatio: 0.3, fogFarRatio: 1.25 },
}

export class DayCycles extends Cycles
{
    constructor()
    {
        const forcedProgress = import.meta.env.VITE_DAY_CYCLE_PROGRESS ? parseFloat(import.meta.env.VITE_DAY_CYCLE_PROGRESS) : null
        super('🕜 Day Cycles', 4 * 60, forcedProgress, false)
    }

    get presets()
    {
        return presets
    }

    getKeyframesDescriptions()
    {
        // Debug
        if(this.game.debug.active)
        {
            this.debugPanel.addBinding(this, 'duration', { min: 1, max: 60 * 10, step: 1 })

            for(const presetKey in presets)
            {
                const preset = presets[presetKey]
                const presetsDebugPanel = this.debugPanel.addFolder({
                    title: presetKey,
                    expanded: true,
                })

                this.game.debug.addThreeColorBinding(presetsDebugPanel, preset.revealColor, 'revealColor')
                presetsDebugPanel.addBinding(preset, 'revealIntensity', { min: 0, max: 20, step: 0.001 })
                this.game.debug.addThreeColorBinding(presetsDebugPanel, preset.lightColor, 'lightColor')
                presetsDebugPanel.addBinding(preset, 'lightIntensity', { min: 0, max: 20 })
                this.game.debug.addThreeColorBinding(presetsDebugPanel, preset.shadowColor, 'shadowColor')
                this.game.debug.addThreeColorBinding(presetsDebugPanel, preset.fogColorA, 'fogColorA')
                this.game.debug.addThreeColorBinding(presetsDebugPanel, preset.fogColorB, 'fogColorB')
                presetsDebugPanel.addBinding(preset, 'fogNearRatio', { label: 'near', min: -2, max: 2, step: 0.001 })
                presetsDebugPanel.addBinding(preset, 'fogFarRatio', { label: 'far', min: -2, max: 2, step: 0.001 })
            }
        }

        return [
            [
                { properties: presets.day, stop: 0.0 }, // day
                { properties: presets.day, stop: 0.15 }, // day
                { properties: presets.dusk, stop: 0.25 }, // Dusk
                { properties: presets.night, stop: 0.35 }, // Night
                { properties: presets.night, stop: 0.6 }, // Night
                { properties: presets.dawn, stop: 0.8 }, // Dawn
                { properties: presets.day, stop: 0.9 }, // day
            ]
        ]
    }

    getIntervalDescriptions()
    {
        return [
            { name: 'night', start: 0.25, end: 0.7 },
            { name: 'deepNight', start: 0.35, end: 0.6 },
        ]
    }
}