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

        // Island shoreline distance & shallow-water gradient
        const centerX = float((this.bounds.minX + this.bounds.maxX) * 0.5)
        const centerZ = float((this.bounds.minZ + this.bounds.maxZ) * 0.5)
        const halfX = float((this.bounds.maxX - this.bounds.minX) * 0.48)
        const halfZ = float((this.bounds.maxZ - this.bounds.minZ) * 0.48)

        const dx = positionWorld.x.sub(centerX).abs().sub(halfX).max(0)
        const dz = positionWorld.z.sub(centerZ).abs().sub(halfZ).max(0)

        let waveDispY
        let finalWaterColor
        let nearMask

        if(isQ0)
        {
            const p1 = positionWorld.x.mul(0.24).add(positionWorld.z.mul(0.16)).add(this.uTime.mul(1.25))
            const p2 = positionWorld.x.mul(-0.19).add(positionWorld.z.mul(0.33)).sub(this.uTime.mul(1.05))
            const p3 = positionWorld.x.mul(0.52).sub(positionWorld.z.mul(0.44)).add(this.uTime.mul(1.65))
            const p4 = positionWorld.x.mul(0.85).add(positionWorld.z.mul(0.72)).sub(this.uTime.mul(2.1))
            const w1 = sin(p1)
            const w2 = cos(p2)
            const w3 = sin(p3)
            const w4 = cos(p4)
            waveDispY = w1.mul(0.12).add(w2.mul(0.08)).add(w3.mul(0.045))

            // Analytical wave slope for stylized sun-lit wave facets & crest highlights
            const dHx = cos(p1).mul(0.24 * 0.14).add(sin(p2).mul(0.19 * 0.10)).add(cos(p3).mul(0.52 * 0.06)).sub(sin(p4).mul(0.85 * 0.03))
            const dHz = cos(p1).mul(0.16 * 0.14).sub(sin(p2).mul(0.33 * 0.10)).sub(cos(p3).mul(0.44 * 0.06)).sub(sin(p4).mul(0.72 * 0.03))
            const waveLit = dHx.mul(0.65).add(dHz.mul(0.55)).add(0.5).clamp(0.0, 1.0)
            const crestHighlight = smoothstep(float(0.68), float(0.92), waveLit)

            let fftFoam = float(0)
            if(this.fft)
            {
                const fftUv = positionWorld.xz.div(float(46.0))
                const fftSample = texture(this.fft.displacementTexture, fftUv)
                fftFoam = fftSample.w
            }

            // Organic shoreline perturbation so shore foam curves naturally instead of a straight rectangle
            const shoreNoise = sin(positionWorld.x.mul(0.28)).mul(0.85).add(cos(positionWorld.z.mul(0.32)).mul(0.75))
            const rawEdge = dx.mul(dx).add(dz.mul(dz)).add(0.0001).sqrt()
            const edgeDist = rawEdge.add(shoreNoise.mul(0.45)).max(0.0)

            const shallowBand = float(1).sub(smoothstep(float(0.0), float(15.0), edgeDist))
            const swashPhase = sin(edgeDist.mul(1.75).sub(this.uTime.mul(1.85))).mul(0.5).add(0.5)
            const shoreFoamBand = float(1).sub(smoothstep(float(0.0), float(3.4), edgeDist))
            const stylizedShoreFoam = step(float(0.56), shoreFoamBand.mul(0.72).add(swashPhase.mul(0.45)))

            const crestFoamWave = w1.mul(0.45).add(w3.mul(0.35)).add(w4.mul(0.2)).mul(0.5).add(0.5)
            const whitecapFoam = smoothstep(float(0.55), float(0.82), fftFoam.add(crestFoamWave.mul(0.38)))
            const totalFoam = stylizedShoreFoam.max(whitecapFoam.mul(0.8))

            const oceanBase = mix(deepOcean, midLagoon, waveLit.mul(0.65).add(shallowBand.mul(0.35)))
            const withShallow = mix(oceanBase, shallowTurquoise, shallowBand.mul(0.62))
            const withHighlight = mix(withShallow, color('#8be3ee'), crestHighlight.mul(0.45))
            const withFoam = mix(withHighlight, foamCream, totalFoam.mul(0.88))
            const horizonBlend = smoothstep(float(70.0), float(185.0), rawEdge)
            finalWaterColor = mix(withFoam, horizonTint, horizonBlend.mul(0.85))
            nearMask = float(1).sub(smoothstep(float(90.0), float(180.0), rawEdge))
        }
        else
        {
            // Lightweight Q1/Q2 analytical ocean for mobile WebGL2 60fps
            const w1 = sin(positionWorld.x.mul(0.25).add(this.uTime.mul(1.1)))
            const w2 = cos(positionWorld.z.mul(0.28).sub(this.uTime.mul(0.95)))
            waveDispY = w1.mul(0.045).add(w2.mul(0.035))
            const edgeSum = dx.add(dz)
            const shallowBand = float(1).sub(smoothstep(float(0.0), float(14.0), edgeSum))
            const shoreFoam = float(1).sub(smoothstep(float(0.0), float(2.6), edgeSum))
            const waterTone = mix(deepOcean, shallowTurquoise, shallowBand.mul(0.65).add(w1.mul(0.1).add(0.1)))
            finalWaterColor = mix(waterTone, foamCream, shoreFoam.mul(0.75))
            nearMask = float(1).sub(smoothstep(float(55.0), float(105.0), edgeSum))
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
        mesh.position.set(0, -0.22, -12.5)
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
