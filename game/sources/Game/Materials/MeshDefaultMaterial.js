import * as THREE from 'three/webgpu'
import { Debug } from '../Debug.js'
import { Game } from '../Game.js'
import { Fn, color, float, frontFacing, If, max, mix, normalWorld, positionWorld, texture, uniform, vec2, vec3, vec4, vertexColor } from 'three/tsl'

export class MeshDefaultMaterial extends THREE.MeshLambertNodeMaterial
{
    static resolveInitialAoStrength()
    {
        if(typeof location === 'undefined')
            return 1

        const raw = Debug.getParam('ao')
        if(raw === null || raw === '')
            return 1

        const normalized = String(raw).trim().toLowerCase()
        if(normalized === '0' || normalized === 'false' || normalized === 'off')
            return 0

        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? Math.max(0, Math.min(2, parsed)) : 1
    }

    static aoStrengthUniform = uniform(MeshDefaultMaterial.resolveInitialAoStrength())

    static setAoStrength(value)
    {
        const parsed = Number(value)
        if(Number.isFinite(parsed))
            MeshDefaultMaterial.aoStrengthUniform.value = Math.max(0, Math.min(2, parsed))
        return MeshDefaultMaterial.aoStrengthUniform.value
    }

    static createDefaultBakedShadowTexture()
    {
        const data = new Uint8Array([ 255, 255, 255, 255 ])
        const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
        tex.colorSpace = THREE.NoColorSpace
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.wrapS = THREE.ClampToEdgeWrapping
        tex.wrapT = THREE.ClampToEdgeWrapping
        tex.flipY = false
        tex.generateMipmaps = false
        tex.needsUpdate = true
        return tex
    }

    static defaultBakedShadowTexture = MeshDefaultMaterial.createDefaultBakedShadowTexture()
    static bakedShadowTexture = MeshDefaultMaterial.defaultBakedShadowTexture
    static bakedShadowNode = texture(MeshDefaultMaterial.defaultBakedShadowTexture)
    static bakedShadowEnabledUniform = uniform(0)
    // vec4(minX, minZ, invSpanX, invSpanZ)
    static bakedShadowBoundsUniform = uniform(new THREE.Vector4(-10, -10, 1 / 20, 1 / 20))
    static bakedShadowBounds = null

    static setBakedShadow(shadowTexture, bounds)
    {
        if(!shadowTexture || !bounds)
        {
            MeshDefaultMaterial.clearBakedShadow()
            return false
        }

        const minX = Number(bounds.minX ?? bounds[0] ?? -10)
        const maxX = Number(bounds.maxX ?? bounds[1] ?? 10)
        const minZ = Number(bounds.minZ ?? bounds[2] ?? -10)
        const maxZ = Number(bounds.maxZ ?? bounds[3] ?? 10)
        const spanX = Math.max(1e-4, maxX - minX)
        const spanZ = Math.max(1e-4, maxZ - minZ)

        shadowTexture.colorSpace = THREE.NoColorSpace
        shadowTexture.minFilter = THREE.LinearFilter
        shadowTexture.magFilter = THREE.LinearFilter
        shadowTexture.wrapS = THREE.ClampToEdgeWrapping
        shadowTexture.wrapT = THREE.ClampToEdgeWrapping
        shadowTexture.flipY = bounds.flipY === true
        shadowTexture.generateMipmaps = false
        shadowTexture.needsUpdate = true

        MeshDefaultMaterial.bakedShadowTexture = shadowTexture
        MeshDefaultMaterial.bakedShadowNode.value = shadowTexture
        MeshDefaultMaterial.bakedShadowBoundsUniform.value.set(minX, minZ, 1 / spanX, 1 / spanZ)
        MeshDefaultMaterial.bakedShadowBounds = { minX, maxX, minZ, maxZ, spanX, spanZ }
        MeshDefaultMaterial.bakedShadowEnabledUniform.value = 1

        const game = Game.getInstance()
        if(game?.lighting && typeof game.lighting.setStaticBakedShadowActive === 'function')
            game.lighting.setStaticBakedShadowActive(true)

        return true
    }

    static clearBakedShadow()
    {
        MeshDefaultMaterial.bakedShadowTexture = MeshDefaultMaterial.defaultBakedShadowTexture
        MeshDefaultMaterial.bakedShadowNode.value = MeshDefaultMaterial.defaultBakedShadowTexture
        MeshDefaultMaterial.bakedShadowEnabledUniform.value = 0
        MeshDefaultMaterial.bakedShadowBounds = null

        const game = Game.getInstance()
        if(game?.lighting && typeof game.lighting.setStaticBakedShadowActive === 'function')
            game.lighting.setStaticBakedShadowActive(false)
    }

    static revealDiscardNodeBuilder = (game, outputColor) =>
    {
        return Fn(([ outputColor ]) =>
        {
            const distanceToCenter = positionWorld.xz.sub(game.reveal.position2Uniform).length()
            distanceToCenter.greaterThan(game.reveal.distance).discard()

            const revealMix = distanceToCenter.step(game.reveal.distance.sub(game.reveal.thickness))
            // const revealMix = game.reveal.distance.sub(distanceToCenter).oneMinus().max(0).pow(4)
            const revealColor = game.reveal.color.mul(game.reveal.intensity)
            return mix(outputColor.rgb, revealColor, revealMix)
        })(outputColor)
    }
    
    constructor(parameters = {})
    {
        super()

        this.game = Game.getInstance()

        this.depthWrite = parameters.depthWrite ?? true
        this.depthTest = parameters.depthTest ?? true
        this.side = parameters.side ?? THREE.FrontSide
        this.wireframe = parameters.wireframe ?? false
        this.transparent = parameters.transparent ?? false
        this.shadowSide = parameters.shadowSide ?? THREE.FrontSide

        this.hasCoreShadows = parameters.hasCoreShadows ?? true
        this.hasDropShadows = parameters.hasDropShadows ?? true
        this.hasLightBounce = parameters.hasLightBounce ?? true
        this.hasVertexAo = parameters.hasVertexAo ?? true
        this.hasFog = parameters.hasFog ?? true
        this.hasWater = parameters.hasWater ?? true
        this.hasReveal = parameters.hasReveal ?? true

        this.aoStrengthUniform = typeof parameters.aoStrength === 'number'
            ? uniform(parameters.aoStrength)
            : (parameters.aoStrengthNode ?? MeshDefaultMaterial.aoStrengthUniform)

        this._colorNode = parameters.colorNode ?? color(0xffffff)
        this._normalNode = parameters.normalNode ?? normalWorld
        this._alphaNode = parameters.alphaNode ?? float(1)
        this._shadowNode = parameters.shadowNode ?? float(0)
        this.alphaTest = parameters.alphaTest ?? 0.1

        this.normalNode = this._normalNode // Get rid of warning
        
        /**
         * Shadow catcher
         * Catch shadow as a float and remove it from initial pipeline
         */
        const catchedShadow = float(1).toVar()

        if(this.hasDropShadows)
        {
            this.receivedShadowNode = Fn(([ shadow ]) => 
            {
                catchedShadow.mulAssign(shadow.r)
                return float(1)
            })
        }

        /**
         * Output node
         */
        this.outputNode = Fn(() =>
        {
            const baseColor = this._colorNode.toVar()
            const outputColor = this._colorNode.toVar()
            // outputColor.assign(vec3(0))
            // outputColor.assign(vec3(0.8))

            // Normal orientation
            const reorientedNormal = this._normalNode.toVar()
            if(this.side === THREE.DoubleSide || this.side === THREE.BackSide)
            {
                If(frontFacing.not(), () => { reorientedNormal.mulAssign(-1) })
            }

            // Light bounce
            if(this.hasLightBounce)
            {
                const bounceOrientation = reorientedNormal.dot(vec3(0, - 1, 0)).smoothstep(this.game.lighting.lightBounceEdgeLow, this.game.lighting.lightBounceEdgeHigh)
                const bounceDistance = this.game.lighting.lightBounceDistance.sub(max(0, positionWorld.y)).div(this.game.lighting.lightBounceDistance).max(0).pow(2)
                const terrainData = this.game.terrain.terrainNode(positionWorld.xz)
                const bounceColor = this.game.terrain.colorNode(terrainData)
                outputColor.assign(mix(outputColor, bounceColor, bounceOrientation.mul(bounceDistance).mul(this.game.lighting.lightBounceMultiplier)))
            }

            // Water
            if(this.hasWater)
            {
                const nearWaterSurface = positionWorld.y.sub(this.game.water.surfaceElevationUniform).abs().greaterThan(this.game.water.surfaceThicknessUniform)
                outputColor.assign(nearWaterSurface.select(outputColor, color('#ffffff')))
                baseColor.assign(nearWaterSurface.select(baseColor, color('#ffffff')))
            }

            // Light
            outputColor.mulAssign(this.game.lighting.colorUniform.mul(this.game.lighting.intensityUniform))

            // Core shadow
            let coreShadowMix = float(0)
            if(this.hasCoreShadows)
                coreShadowMix = reorientedNormal.dot(this.game.lighting.directionUniform).smoothstep(this.game.lighting.coreShadowEdgeHigh, this.game.lighting.coreShadowEdgeLow)
            
            // Cast shadow (real-time shadow map + Q1 top-down baked shadow texture sampled by positionWorld.xz)
            let dropShadowMix = float(0)
            if(this.hasDropShadows)
            {
                const bakedUv = positionWorld.xz
                    .sub(MeshDefaultMaterial.bakedShadowBoundsUniform.xy)
                    .mul(MeshDefaultMaterial.bakedShadowBoundsUniform.zw)
                    .clamp(0, 1)
                const bakedShadowSample = MeshDefaultMaterial.bakedShadowNode.sample(bakedUv).r
                // Apply top-down baked shadow on ground & near-ground contact surfaces while keeping
                // elevated step treads, ramp tops, and floating blocks free of top-down self-footprint streaks
                const heightWeight = float(1).sub(positionWorld.y.smoothstep(0.05, 0.25))
                const upwardWeight = reorientedNormal.y.smoothstep(-0.1, 0.5)
                const bakedDropMix = float(1)
                    .sub(bakedShadowSample)
                    .mul(MeshDefaultMaterial.bakedShadowEnabledUniform)
                    .mul(heightWeight)
                    .mul(upwardWeight)
                dropShadowMix = max(catchedShadow.oneMinus(), bakedDropMix)
            }

            // Combined shadows
            if(this.hasCoreShadows || this.hasDropShadows)
            {
                const combinedShadowMix = max(coreShadowMix, dropShadowMix, this._shadowNode).clamp(0, 1)
                
                const shadowColor = baseColor.rgb.mul(this.game.lighting.shadowColor).rgb
                outputColor.assign(mix(outputColor, shadowColor, combinedShadowMix))
            }

            // Vertex ambient occlusion (COLOR_0 -> geometry.attributes.color, fallback vec4(1))
            if(this.hasVertexAo)
            {
                const aoFactor = mix(vec3(1), vertexColor().rgb, this.aoStrengthUniform)
                outputColor.mulAssign(aoFactor)
            }
            
            // Fog
            if(this.hasFog)
                outputColor.assign(this.game.fog.strength.mix(outputColor, this.game.fog.color))

            // Alpha test discard
            this._alphaNode.lessThan(this.alphaTest).discard()

            // Reveal
            if(this.hasReveal)
                outputColor.assign(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, outputColor))

            // Output
            return vec4(outputColor, this._alphaNode)
        })()
    }
}