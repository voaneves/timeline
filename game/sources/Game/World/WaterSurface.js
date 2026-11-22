// Adapted from dgreenheck/tidewater (MIT, (c) 2026 DRG Software Solutions LLC)
import * as THREE from 'three/webgpu'
import { color, cos, float, length, mix, positionLocal, positionWorld, sin, smoothstep, step, texture, uniform, vec2, vec3 } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'
import { OceanFFT } from './OceanFFT.js'

/**
 * Stylized Tidewater-tech ocean horizon + cerrado foliage wind sway.
 * - Q0 (WebGPU): 2-cascade JONSWAP FFT displacement + Jacobian foam texture + analytical shore swash
 * - Q1/Q2 (WebGL2): analytical JONSWAP wave synthesis + shore swash
 * - Extends seamlessly 420 m x 420 m into horizon fog so background void is never exposed.
 */
export class WaterSurface
{
    constructor(options = {})
    {
        this.game = Game.getInstance()
        this.uTime = uniform(0)
        this.waterMesh = options.waterMesh || null
        this.foliageMesh = options.foliageMesh || null
        this.terrainTexture = options.terrainTexture || null
        this.bounds = options.bounds || { minX: -37.3, maxX: 37.3, minZ: -49, maxZ: 24 }
        const level = this.game.quality?.level ?? 0
        this.qualityTier = options.qualityTier || `Q${level}`
        this.useFFT = this.qualityTier === 'Q0'
        this.fft = this.useFFT ? new OceanFFT() : null
        this._fftAccum = 0

        if(this.waterMesh)
            this.waterMesh.visible = false

        this.horizonOcean = this.createHorizonOceanMesh()

        if(this.foliageMesh)
            this.attachFoliageWind(this.foliageMesh)

        this._onTick = () => this.update()
        this.game.ticker.events.on('tick', this._onTick, 7)
    }

    createHorizonOceanMesh()
    {
        const isQ0 = this.qualityTier === 'Q0'
        const segs = isQ0 ? 72 : 16
        const size = isQ0 ? 420 : 240
        const geometry = new THREE.PlaneGeometry(size, size, segs, segs)
        geometry.rotateX(-Math.PI * 0.5)

        const deepOcean = color('#1e6fa8')
        const midLagoon = color('#2f96c8')
        const shallowTurquoise = color('#5ac7d6')
        const foamCream = color('#f4ead4')
        const horizonTint = color('#cde3f2')

        // Circular cove distance around island center (0, -18) for natural shore foam & shallows
        const cx = positionWorld.x.div(35.0)
        const cz = positionWorld.z.add(18.0).div(30.0)
        const rawR = cx.mul(cx).add(cz.mul(cz)).add(0.0001).sqrt().mul(32.5)
        const coastApprox = float(28.5).add(sin(positionWorld.x.mul(0.16)).mul(1.9)).add(cos(positionWorld.z.mul(0.19)).mul(1.6))
        const edgeDist = rawR.sub(coastApprox).max(0.0)

        let waveDispY
        let finalWaterColor
        let nearMask

        if(isQ0)
        {
            const p1 = positionWorld.x.mul(0.24).add(positionWorld.z.mul(0.16)).add(this.uTime.mul(1.35))
            const p2 = positionWorld.x.mul(-0.19).add(positionWorld.z.mul(0.33)).sub(this.uTime.mul(1.15))
            const p3 = positionWorld.x.mul(0.52).sub(positionWorld.z.mul(0.44)).add(this.uTime.mul(1.75))
            const p4 = positionWorld.x.mul(0.85).add(positionWorld.z.mul(0.72)).sub(this.uTime.mul(2.2))
            const w1 = sin(p1)
            const w2 = cos(p2)
            const w3 = sin(p3)
            const w4 = cos(p4)
            waveDispY = w1.mul(0.14).add(w2.mul(0.09)).add(w3.mul(0.05))

            // Analytical wave slopes -> sun-lit wave facets & specular glints (visible even when camera is still)
            const dHx = cos(p1).mul(0.045).add(sin(p2).mul(0.025)).add(cos(p3).mul(0.038)).sub(sin(p4).mul(0.032))
            const dHz = cos(p1).mul(0.030).sub(sin(p2).mul(0.042)).sub(cos(p3).mul(0.032)).sub(sin(p4).mul(0.028))
            const waveLit = dHx.mul(2.4).add(dHz.mul(2.1)).add(0.5).clamp(0.0, 1.0)
            const crestHighlight = smoothstep(float(0.64), float(0.90), waveLit)

            let fftFoam = float(0)
            if(this.fft)
            {
                const fftUv = positionWorld.xz.div(float(46.0))
                const fftSample = texture(this.fft.displacementTexture, fftUv)
                fftFoam = fftSample.w
            }

            const shallowBand = float(1).sub(smoothstep(float(0.0), float(16.0), edgeDist))
            const swashPhase = sin(edgeDist.mul(1.65).sub(this.uTime.mul(1.9))).mul(0.5).add(0.5)
            const shoreFoamBand = float(1).sub(smoothstep(float(0.0), float(3.8), edgeDist))
            const stylizedShoreFoam = step(float(0.54), shoreFoamBand.mul(0.74).add(swashPhase.mul(0.46)))

            const crestFoamWave = w1.mul(0.45).add(w3.mul(0.35)).add(w4.mul(0.2)).mul(0.5).add(0.5)
            const whitecapFoam = smoothstep(float(0.56), float(0.84), fftFoam.add(crestFoamWave.mul(0.38)))
            const totalFoam = stylizedShoreFoam.max(whitecapFoam.mul(0.8))

            const oceanBase = mix(deepOcean, midLagoon, waveLit.mul(0.68).add(shallowBand.mul(0.32)))
            const withShallow = mix(oceanBase, shallowTurquoise, shallowBand.mul(0.65))
            const withHighlight = mix(withShallow, color('#9aeaf3'), crestHighlight.mul(0.48))
            const withFoam = mix(withHighlight, foamCream, totalFoam.mul(0.88))
            const horizonBlend = smoothstep(float(75.0), float(190.0), rawR)
            finalWaterColor = mix(withFoam, horizonTint, horizonBlend.mul(0.85))
            nearMask = float(1).sub(smoothstep(float(90.0), float(180.0), rawR))
        }
        else
        {
            // Lightweight Q1/Q2 analytical ocean for mobile WebGL2 60fps
            const w1 = sin(positionWorld.x.mul(0.26).add(this.uTime.mul(1.2)))
            const w2 = cos(positionWorld.z.mul(0.30).sub(this.uTime.mul(1.0)))
            waveDispY = w1.mul(0.06).add(w2.mul(0.04))
            const shallowBand = float(1).sub(smoothstep(float(0.0), float(16.0), edgeDist))
            const shoreFoam = float(1).sub(smoothstep(float(0.0), float(3.2), edgeDist))
            const waterTone = mix(deepOcean, shallowTurquoise, shallowBand.mul(0.65).add(w1.mul(0.12).add(0.12)))
            finalWaterColor = mix(waterTone, foamCream, shoreFoam.mul(0.75))
            nearMask = float(1).sub(smoothstep(float(55.0), float(105.0), rawR))
        }

        const material = isQ0
            ? new MeshDefaultMaterial({
                colorNode: finalWaterColor,
                hasCoreShadows: false,
                hasDropShadows: false,
                hasLightBounce: false,
                hasVertexAo: false,
                hasWater: false,
                hasFog: true,
                hasReveal: true,
            })
            : new THREE.MeshBasicNodeMaterial({
                colorNode: finalWaterColor,
            })

        // Dampen vertical displacement near horizon so fog edge stays calm
        if(isQ0)
        {
            material.positionNode = vec3(
                positionLocal.x,
                positionLocal.y.add(waveDispY.mul(nearMask)),
                positionLocal.z
            )
        }

        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = 'OrigensHorizonOcean'
        mesh.position.set(0, -0.35, -18.0)
        mesh.renderOrder = 10
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.userData.preventMaterialOverride = true
        this.game.scene.add(mesh)
        return mesh
    }

    attachFoliageWind(mesh)
    {
        if(!mesh.material || !mesh.material._colorNode)
            return

        const baseMat = mesh.material
        const windMat = new MeshDefaultMaterial({
            colorNode: baseMat._colorNode,
            hasCoreShadows: true,
            hasDropShadows: true,
            hasLightBounce: true,
            hasVertexAo: true,
            hasWater: false,
            hasFog: true,
            hasReveal: true,
        })

        // Coherent directional breeze across whole canopy (no circular Lissajous / twisting)
        const swayWeight = smoothstep(float(2.2), float(5.0), positionWorld.y)
        const windWave = sin(this.uTime.mul(0.55).add(positionWorld.x.mul(0.05)).add(positionWorld.z.mul(0.05)))
        const sway = windWave.mul(0.022).mul(swayWeight)

        windMat.positionNode = vec3(
            positionLocal.x.add(sway.mul(0.85)),
            positionLocal.y,
            positionLocal.z.add(sway.mul(0.35))
        )

        mesh.material = windMat
        mesh.userData.preventMaterialOverride = true
    }

    update()
    {
        const elapsed = this.game.ticker.elapsed
        this.uTime.value = elapsed
        if(this.fft)
        {
            this._fftAccum += this.game.ticker.delta || 0.016
            if(this._fftAccum >= 0.033)
            {
                this._fftAccum = 0
                this.fft.update(elapsed)
            }
        }
    }

    dispose()
    {
        this.game?.ticker?.events?.off?.('tick', this._onTick)
        if(this.horizonOcean)
        {
            this.horizonOcean.removeFromParent()
            this.horizonOcean.geometry?.dispose()
            this.horizonOcean.material?.dispose()
            this.horizonOcean = null
        }
        this.fft?.dispose()
        this.fft = null
    }
}
