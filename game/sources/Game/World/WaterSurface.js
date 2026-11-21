import * as THREE from 'three/webgpu'
import { color, cos, float, mix, positionLocal, positionWorld, sin, smoothstep, uniform, vec3 } from 'three/tsl'
import { Game } from '../Game.js'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

/**
 * Animated stylized Rio Tocantins water surface + cerrado foliage wind sway.
 */
export class WaterSurface
{
    constructor(options = {})
    {
        this.game = Game.getInstance()
        this.uTime = uniform(0)
        this.waterMesh = options.waterMesh || null
        this.foliageMesh = options.foliageMesh || null

        if(this.waterMesh)
            this.attachWaterMaterial(this.waterMesh)

        if(this.foliageMesh)
            this.attachFoliageWind(this.foliageMesh)

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 7)
    }

    attachWaterMaterial(mesh)
    {
        const deepColor = color('#4b8ea8') // waterOrigens
        const shallowMint = color('#4ecdc4') // dataMint
        const foamColor = color('#e6f8f5')

        // Shoreline sits around z = 9.4..11.0 along the south channel
        const shoreFactor = float(1).sub(smoothstep(float(9.4), float(11.8), positionWorld.z))
        const waveA = sin(positionWorld.x.mul(0.45).add(this.uTime.mul(1.6)))
        const waveB = cos(positionWorld.z.mul(0.85).sub(this.uTime.mul(1.25)))
        const ripple = waveA.mul(0.5).add(waveB.mul(0.5)).mul(0.5).add(0.5)

        const foamBand = smoothstep(float(0.62), float(0.88), shoreFactor.add(ripple.mul(0.28)))
        const waterTone = mix(deepColor, shallowMint, shoreFactor.mul(0.55).add(ripple.mul(0.18)))
        const finalWaterColor = mix(waterTone, foamColor, foamBand.mul(0.7))

        const material = new MeshDefaultMaterial({
            colorNode: finalWaterColor,
            hasCoreShadows: false,
            hasDropShadows: false,
            hasLightBounce: false,
            hasVertexAo: false,
            hasWater: false,
            hasFog: true,
            hasReveal: true,
        })

        const waveHeight = sin(positionWorld.x.mul(0.35).add(this.uTime.mul(1.5)))
            .mul(0.028)
            .add(cos(positionWorld.z.mul(0.55).add(this.uTime.mul(1.2))).mul(0.022))

        material.positionNode = vec3(
            positionLocal.x,
            positionLocal.y.add(waveHeight),
            positionLocal.z
        )

        mesh.material = material
        mesh.userData.preventMaterialOverride = true
        mesh.castShadow = false
        mesh.receiveShadow = false
    }

    attachFoliageWind(mesh)
    {
        if(!mesh.material || !mesh.material._colorNode)
            return

        // Clone material so only foliage vertices sway in the wind
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

        const swayWeight = smoothstep(float(1.0), float(4.0), positionWorld.y)
        const swayX = sin(this.uTime.mul(1.4).add(positionWorld.x.mul(0.35)).add(positionWorld.z.mul(0.25))).mul(0.055).mul(swayWeight)
        const swayZ = cos(this.uTime.mul(1.15).add(positionWorld.z.mul(0.3))).mul(0.045).mul(swayWeight)

        windMat.positionNode = vec3(
            positionLocal.x.add(swayX),
            positionLocal.y,
            positionLocal.z.add(swayZ)
        )

        mesh.material = windMat
    }

    update()
    {
        this.uTime.value = this.game.time?.elapsed ?? 0
    }
}
