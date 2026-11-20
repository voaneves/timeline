// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
import * as THREE from 'three/webgpu'
import { Game } from './Game.js'
import { color, Fn, mix, round, smoothstep, texture, uniform, uv, vec2 } from 'three/tsl'

export class Terrain
{
    constructor()
    {
        this.game = Game.getInstance()

        this.subdivision = 128
        this.size = 192

        if(this.game.debug.active)
        {
            this.debugPanel = this.game.debug.panel.addFolder({
                title: '🏔️ Terrain Data',
                expanded: false,
            })
        }

        this.setDataTexture()
        this.setGradient()
        this.setNodes()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 10)
    }

    // Procedural stand-in for upstream's hand-painted terrain.png (not copied).
    // Channels read by terrainNode / colorNode: g = grass amount, b = dirt/water gradient index.
    setDataTexture()
    {
        const resolution = 64
        const data = new Uint8Array(resolution * resolution * 4)

        for(let y = 0; y < resolution; y++)
        {
            for(let x = 0; x < resolution; x++)
            {
                const i = (y * resolution + x) * 4

                // Radial distance from the center: 0 at the center, 1 at the border of the texture
                const dx = (x + 0.5) / resolution * 2 - 1
                const dy = (y + 0.5) / resolution * 2 - 1
                const radius = Math.hypot(dx, dy)

                const grass = 1 - Math.min(Math.max((radius - 0.45) / 0.35, 0), 1) // full grass inside, fades out
                const gradient = 0.12 + Math.min(Math.max((radius - 0.7) / 0.3, 0), 1) * 0.6 // dirt (low) to deep water (high)

                data[i    ] = 0
                data[i + 1] = Math.round(grass * 255)
                data[i + 2] = Math.round(gradient * 255)
                data[i + 3] = 255
            }
        }

        this.dataTexture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType)
        this.dataTexture.minFilter = THREE.LinearFilter
        this.dataTexture.magFilter = THREE.LinearFilter
        this.dataTexture.wrapS = THREE.ClampToEdgeWrapping
        this.dataTexture.wrapT = THREE.ClampToEdgeWrapping
        this.dataTexture.generateMipmaps = false
        this.dataTexture.flipY = false
        this.dataTexture.needsUpdate = true
    }

    setGradient()
    {
        const height = 16

        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = height

        this.gradientTexture = new THREE.Texture(canvas)
        this.gradientTexture.colorSpace = THREE.SRGBColorSpace

        const context = canvas.getContext('2d')

        this.colors = [
            { stop: 0.1, value: '#ffa94e' },
            { stop: 0.3, value: '#5bc2b9' },
            { stop: 0.9, value: '#13375f' },
        ]

        const update = () =>
        {
            const gradient = context.createLinearGradient(0, 0, 0, height)
            for(const color of this.colors)
                gradient.addColorStop(color.stop, color.value)

            context.fillStyle = gradient
            context.fillRect(0, 0, 1, height)
            this.gradientTexture.needsUpdate = true
        }

        update()

        // // Debug
        // canvas.style.position = 'fixed'
        // canvas.style.zIndex = 999
        // canvas.style.top = 0
        // canvas.style.left = 0
        // canvas.style.width = '128px'
        // canvas.style.height = `256px`
        // document.body.append(canvas)
        
        if(this.game.debug.active)
        {
            for(const color of this.colors)
            {
                this.debugPanel.addBinding(color, 'stop', { min: 0, max: 1, step: 0.001 }).on('change', update)
                this.debugPanel.addBinding(color, 'value', { view: 'color' }).on('change', update)
            }
        }
    }

    setNodes()
    {
        this.grassColorUniform = uniform(color('#b8b62e'))
        this.tracksDelta = uniform(vec2(0))

        const worldPositionToUvNode = Fn(([position]) =>
        {
            return position.div(this.subdivision).div(1.5).add(0.5)
        })

        this.terrainNode = Fn(([position]) =>
        {
            const textureUv = worldPositionToUvNode(position)
            const data = texture(this.dataTexture, textureUv)

            // Wheel tracks
            const groundDataColor = texture(
                this.game.tracks.renderTarget.texture,
                position.sub(- this.game.tracks.halfSize).sub(this.tracksDelta).div(this.game.tracks.size)
            )
            data.g.mulAssign(groundDataColor.r.oneMinus())

            return data
        })
        
        this.colorNode = Fn(([terrainData]) =>
        {
            // Dirt and water
            const baseColor = texture(this.gradientTexture, vec2(0, terrainData.b.oneMinus()))

            // Grass
            baseColor.assign(mix(baseColor, this.grassColorUniform, terrainData.g))

            return baseColor.rgb
        })

        if(this.game.debug.active)
        {
            this.game.debug.addThreeColorBinding(this.debugPanel, this.grassColorUniform.value, 'grassColor')
        }
    }
    
    update()
    {
        // Tracks delta
        this.tracksDelta.value.set(
            this.game.tracks.focusPoint.x,
            this.game.tracks.focusPoint.y
        )
    }
}