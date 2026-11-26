import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { Track } from '../Tracks.js'
import { Trails } from '../Trails.js'
import { remapClamp } from '../utilities/maths.js'
import { cameraPosition, color, Fn, min, mix, normalWorld, positionViewDirection, positionWorld, screenCoordinate, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { clamp } from 'three/src/math/MathUtils.js'
import gsap from 'gsap'
import { MeshDefaultMaterial } from '../Materials/MeshDefaultMaterial.js'

export class VisualVehicle
{
    constructor(model)
    {
        this.game = Game.getInstance()
        
        this.model = model

        this.setParts()
        this.setMainGroundTrack()
        this.setWheels()
        this.setBlinkers()
        this.setBackLights()
        this.setAntenna()
        this.setBoostTrails()
        this.setBoostAnimation()
        this.setScreenPosition()
        this.setPaints()
        this.setSubmarineKit()
        this.setCharacterFace()
        this.setCargoTrophies()

        this.tickCallback = () =>
        {
            this.update()
        }
        this.game.ticker.events.on('tick', this.tickCallback, 8)
    }

    destroy()
    {
        this.game.ticker.events.off('tick', this.tickCallback)

        if(this.blinkers)
        {
            this.game.inputs.events.off('left', this.blinkers.leftCallback)
            this.game.inputs.events.off('right', this.blinkers.rightCallback)
        }

        for(let partName in this.parts)
        {
            const part = this.parts[partName]
            part.removeFromParent()
        }

        this.game.tracks.remove(this.mainGroundTrack)

        for(const wheel of this.wheels.items)
        {
            this.game.tracks.remove(wheel.groundTrack)
        }
    }

    setParts()
    {
        this.parts = {}

        const searchList = [
            'bodyPainted',
            'chassis',
            'blinkerLeft',
            'blinkerRight',
            'stopLights',
            'backLights',
            'wheelContainer',
            'antenna',
            'cell1',
            'cell2',
            'cell3',
            'energy',
        ]
        for(let i = 0; i < searchList.length; i++)
        {
            searchList[i] = new RegExp(`^(${searchList[i]})`, 'i')
        }

        this.model.traverse((child) =>
        {
            if(child.isMesh)
            {
                child.receiveShadow = true
                child.castShadow = true
                child.material.shadowSide = THREE.BackSide
            }

            for(const search of searchList)
            {
                const match = child.name.match(search)

                if(match)
                {
                    this.parts[match[0]] = child
                }
            }
        })

        // Chassis
        this.parts.chassis.rotation.reorder('YXZ')
        this.game.materials.updateObject(this.parts.chassis)
        this.game.scene.add(this.parts.chassis)

        // Blinker left
        if(this.parts.blinkerLeft)
            this.parts.blinkerLeft.visible = false

        // Blinker right
        if(this.parts.blinkerRight)
            this.parts.blinkerRight.visible = false

        // Stop lights
        if(this.parts.stopLights)
            this.parts.stopLights.visible = false

        // Back lights
        if(this.parts.backLights)
            this.parts.backLights.visible = false

        // Wheel
        this.game.materials.updateObject(this.parts.wheelContainer)
    }

    setPaints()
    {
        this.paints = {}

        this.paints.choices = {}
        this.paints.choices.red = this.game.materials.getFromName('redGradient')
        this.paints.choices.orange = this.game.materials.createGradient('orangeGradient', '#1dd3c6', '#0d6e9e', this.game.materials.debugPanel?.addFolder({ title: 'orangeGradient' }))
        this.paints.choices.white = this.game.materials.createGradient('whiteGradient', '#fffaf0', '#d4cfc4', this.game.materials.debugPanel?.addFolder({ title: 'whiteGradient' }))
        this.paints.choices.black = this.game.materials.createGradient('blackGradient', '#4a5568', '#1a202c', this.game.materials.debugPanel?.addFolder({ title: 'blackGradient' }))
        
        // Flames
        {
            const material = this.paints.choices.red.clone()
            const baseOutput = material.outputNode
            const colorA = uniform(color('#ffd166'))
            const colorB = uniform(color('#ff4d2e'))
            const emissiveStrength = uniform(7.75)

            material.outputNode = Fn(() =>
            {
                // Flames
                {
                    const newUv = uv(1).toVar()
                    const uv3 = newUv.sub(vec2(0, this.game.ticker.elapsedScaledUniform.mul(-0.075))).mul(vec2(0.96 * 1.3, 0.35 * 1.3))
                    const noise3 = texture(this.game.noises.voronoi, uv3).r

                    const uv4 = newUv.sub(vec2(0, this.game.ticker.elapsedScaledUniform.mul(-0.041))).mul(vec2(1.28 * 1.3, 0.75 * 1.3))
                    const noise4 = texture(this.game.noises.voronoi, uv4).r

                    const noiseFinal = min(noise3, noise4)
                    const stepTreshold = newUv.y.oneMinus()
                    const flameMix = noiseFinal.step(stepTreshold)

                    const flameColor = mix(colorA, colorB, newUv.y).mul(emissiveStrength)

                    baseOutput.rgb.assign(mix(baseOutput.rgb, flameColor, flameMix))
                }


                return baseOutput
            })()

            this.paints.choices.flames = material

            // Debug
            if(this.game.debug.active && this.game.materials.debugPanel)
            {
                const debugPanel = this.game.materials.debugPanel.addFolder({
                    title: 'flames',
                    expanded: true,
                })
                this.game.debug.addThreeColorBinding(debugPanel, colorA.value, 'flamesColorA')
                this.game.debug.addThreeColorBinding(debugPanel, colorB.value, 'flamesColorB')
                debugPanel.addBinding(emissiveStrength, 'value', { label: 'emissiveStrength', min: 1, max: 10, step: 0.001 })
            }
        }
        
        // Celestial
        {
            const material = new THREE.MeshBasicMaterial({ wireframe: false })
            const fresnelColor = uniform(color('#7ce8ff'))
            const fresnelIntensity = uniform(22)
            const starsIntensity = uniform(12)

            material.outputNode = Fn(() =>
            {
                const starsUv = screenCoordinate.div(256).fract()
                const starsColor = texture(this.game.resources.behindTheSceneStarsTexture, starsUv).rgb.pow(2).mul(starsIntensity)
				
                const viewDirection = positionWorld.sub( cameraPosition ).normalize();
                const fresnel = viewDirection.dot(normalWorld).remapClamp(-0.2, -0.4, 1, 0)
                
                const fresnelFinalColor = fresnelColor.mul(fresnelIntensity)
                const finalColor = mix(starsColor, fresnelFinalColor, fresnel)

                finalColor.assign(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, finalColor))

                return vec4(finalColor, 1)
            })()

            this.paints.choices.celestial = material

            // Debug
            if(this.game.debug.active && this.game.materials.debugPanel)
            {
                const debugPanel = this.game.materials.debugPanel.addFolder({
                    title: 'celestial',
                    expanded: true,
                })
                this.game.debug.addThreeColorBinding(debugPanel, fresnelColor.value, 'fresnelColor')
                debugPanel.addBinding(fresnelIntensity, 'value', { label: 'fresnelIntensity', min: 1, max: 40, step: 0.001 })
                debugPanel.addBinding(starsIntensity, 'value', { label: 'starsIntensity', min: 1, max: 40, step: 0.001 })
            }
        }

        this.paints.changeTo = (name = 'red') =>
        {
            const material = this.paints.choices[name]

            if(!material)
                return false

            this.parts.bodyPainted.material = material

            for(const wheel of this.wheels.items)
            {
                if(wheel.painted)
                    wheel.painted.material = material
            }
        }
        
        // From achievemnts
        this.paints.changeTo(this.game.achievements.rewards.current.name)

        this.game.achievements.events.on('rewardActiveChange', (reward) =>
        {
            this.paints.changeTo(reward.name)
        })
    }

    setSubmarineKit()
    {
        this.submarineKit = {
            active: false,
            group: new THREE.Group(),
            propellers: [],
            bubbles: [],
            eyes: null,
            savedVisibility: new Map(),
            savedAntennaVisible: true
        }
        this.submarineKit.group.visible = false
        this.parts.chassis.add(this.submarineKit.group)

        const hullMat = new MeshDefaultMaterial({ colorNode: color('#f6be2c'), hasWater: false, hasLightBounce: false })
        const keelMat = new MeshDefaultMaterial({ colorNode: color('#163a5f'), hasWater: false, hasLightBounce: false })
        const podMat = new MeshDefaultMaterial({ colorNode: color('#2a4365'), hasWater: false, hasLightBounce: false })
        const trimMat = new MeshDefaultMaterial({ colorNode: color('#20b2aa'), hasWater: false, hasLightBounce: false })
        const ivoryMat = new MeshDefaultMaterial({ colorNode: color('#f4f9ff'), hasWater: false, hasLightBounce: false })
        const brassMat = new MeshDefaultMaterial({ colorNode: color('#f5c542'), hasWater: false, hasLightBounce: false })
        const bladeMat = new THREE.MeshBasicNodeMaterial()
        bladeMat.colorNode = color('#34cfc4').mul(1.25)
        const portGlowMat = new THREE.MeshBasicNodeMaterial()
        portGlowMat.colorNode = color('#7ef2ff').mul(1.45)

        const addSolid = (mesh) =>
        {
            mesh.castShadow = true
            mesh.receiveShadow = true
            this.submarineKit.group.add(mesh)
            return mesh
        }

        // Casco principal pressurizado amarelo (pesquisa oceanica)
        const mainHull = addSolid(new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 2.25, 20), hullMat))
        mainHull.rotation.z = Math.PI * 0.5
        mainHull.position.set(0.05, 0.10, 0)

        const bowCap = addSolid(new THREE.Mesh(new THREE.SphereGeometry(0.68, 20, 14), hullMat))
        bowCap.position.set(1.15, 0.10, 0)
        bowCap.scale.set(0.75, 1.0, 1.0)

        const sternCone = addSolid(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.68, 0.92, 20), hullMat))
        sternCone.rotation.z = Math.PI * 0.5
        sternCone.position.set(-1.53, 0.10, 0)

        // Quilha inferior azul-marinho e faixas hidrodinamicas turquesa
        const keel = addSolid(new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.34, 0.84), keelMat))
        keel.position.set(-0.02, -0.44, 0)

        const bowKeel = addSolid(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.24, 0.62), keelMat))
        bowKeel.position.set(1.25, -0.38, 0)
        bowKeel.rotation.z = 0.25

        for(const sz of [ -0.71, 0.71 ])
        {
            const stripe = addSolid(new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.10, 0.08), trimMat))
            stripe.position.set(0.05, 0.04, sz)

            // Escotilhas laterais iluminadas (3 por lado)
            for(const px of [ -0.58, 0.02, 0.62 ])
            {
                const frame = addSolid(new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.032, 8, 16), brassMat))
                frame.position.set(px, 0.22, sz)
                const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.04, 14), portGlowMat)
                glass.rotation.x = Math.PI * 0.5
                glass.position.set(px, 0.22, sz)
                this.submarineKit.group.add(glass)
            }
        }

        // Cupula frontal panoramica ciano + anel de latao
        const domeMat = new THREE.MeshLambertNodeMaterial({ transparent: true, opacity: 0.44 })
        domeMat.colorNode = color('#8beeff')
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.54), domeMat)
        dome.rotation.z = -Math.PI * 0.5
        dome.position.set(1.32, 0.10, 0)
        dome.scale.set(1.0, 1.08, 1.0)
        this.submarineKit.group.add(dome)

        const bowCollar = addSolid(new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.055, 8, 24), brassMat))
        bowCollar.rotation.y = Math.PI * 0.5
        bowCollar.position.set(1.30, 0.10, 0)

        // Olhos LED amigaveis dentro da cupula frontal do submarino
        const eyeMat = new THREE.MeshBasicNodeMaterial()
        eyeMat.colorNode = color('#a8f8ff').mul(1.85)
        const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.14), eyeMat)
        leftEye.position.set(1.62, 0.19, -0.22)
        const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.14), eyeMat)
        rightEye.position.set(1.62, 0.19, 0.22)
        const smile = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.22), eyeMat)
        smile.position.set(1.62, 0.06, 0)
        this.submarineKit.group.add(leftEye, rightEye, smile)
        this.submarineKit.eyes = { leftEye, rightEye, smile }

        // Torre de comando superior (sail), lemes de profundidade e periscopio
        const sail = addSolid(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.52, 0.44), hullMat))
        sail.position.set(0.10, 0.90, 0)

        const hatchRing = addSolid(new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 0.08, 14), ivoryMat))
        hatchRing.position.set(0.04, 1.18, 0)

        const divePlanes = addSolid(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 1.38), trimMat))
        divePlanes.position.set(0.16, 0.92, 0)

        const periscopeMast = addSolid(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.36, 10), brassMat))
        periscopeMast.position.set(0.28, 1.32, 0)
        const periscopeHead = addSolid(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.09), brassMat))
        periscopeHead.position.set(0.35, 1.48, 0)
        const periscopeLens = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.07), portGlowMat)
        periscopeLens.position.set(0.45, 1.48, 0)
        this.submarineKit.group.add(periscopeLens)

        // Estabilizadores cruciformes de popa e helice central de latao (4 pas)
        const rudderTop = addSolid(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.07), keelMat))
        rudderTop.position.set(-1.72, 0.42, 0)
        const rudderBottom = addSolid(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.40, 0.07), keelMat))
        rudderBottom.position.set(-1.72, -0.26, 0)
        const sternPlanes = addSolid(new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.07, 1.18), trimMat))
        sternPlanes.position.set(-1.72, 0.10, 0)

        const tailHub = new THREE.Group()
        tailHub.position.set(-2.06, 0.10, 0)
        const tailSpinner = addSolid(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.10, 0.18, 10), brassMat))
        tailSpinner.rotation.z = Math.PI * 0.5
        tailHub.add(tailSpinner)
        for(let k = 0; k < 4; k++)
        {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.32, 0.08), brassMat)
            blade.rotation.x = (k / 4) * Math.PI * 2
            blade.castShadow = true
            tailHub.add(blade)
        }
        this.submarineKit.group.add(tailHub)
        this.submarineKit.propellers.push(tailHub)

        // Turbinas hidro laterais com helices giratorias (3 pas ciano)
        for(const sz of [ -0.94, 0.94 ])
        {
            const pylon = addSolid(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.10, 0.36), keelMat))
            pylon.position.set(-1.05, 0.02, sz * 0.74)

            const pod = addSolid(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.64, 12), podMat))
            pod.rotation.z = Math.PI * 0.5
            pod.position.set(-1.12, 0.02, sz)

            const nozzle = addSolid(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.028, 8, 14), trimMat))
            nozzle.rotation.y = Math.PI * 0.5
            nozzle.position.set(-0.82, 0.02, sz)

            const hub = new THREE.Group()
            hub.position.set(-1.47, 0.02, sz)
            for(let k = 0; k < 3; k++)
            {
                const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.06), bladeMat)
                blade.rotation.x = (k / 3) * Math.PI * 2
                hub.add(blade)
            }
            this.submarineKit.group.add(hub)
            this.submarineKit.propellers.push(hub)
        }

        // Farol submarino frontal volumetrico
        const beamMat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        })
        beamMat.outputNode = Fn(() =>
        {
            const fade = uv().y.smoothstep(0.0, 0.85).oneMinus()
            return vec4(color('#8beeff').mul(1.2), fade.mul(0.22))
        })()
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 1.75, 6.8, 16, 1, true), beamMat)
        beam.rotation.z = -Math.PI * 0.5
        beam.position.set(5.15, 0.08, 0)
        this.submarineKit.group.add(beam)

        // Rastro de bolhas atras das turbinas laterais e helice central
        const bubbleGeo = new THREE.SphereGeometry(0.085, 7, 6)
        const bubbleMat = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.72 })
        bubbleMat.colorNode = color('#a8f4ff')
        const bubbleAnchors = [
            { x: -1.56, y: 0.02, z: -0.94 },
            { x: -1.56, y: 0.02, z: 0.94 },
            { x: -2.14, y: 0.10, z: 0.0 }
        ]
        for(let i = 0; i < 21; i++)
        {
            const b = new THREE.Mesh(bubbleGeo, bubbleMat)
            const anchor = bubbleAnchors[i % bubbleAnchors.length]
            this.submarineKit.group.add(b)
            this.submarineKit.bubbles.push({
                mesh: b,
                phase: i / 21,
                baseX: anchor.x,
                baseY: anchor.y,
                baseZ: anchor.z + (Math.random() - 0.5) * 0.14,
                driftY: (Math.random() - 0.25) * 0.45,
                driftZ: (Math.random() - 0.5) * 0.28,
            })
        }
    }

    setSubmarineMode(active)
    {
        if(!this.submarineKit)
            return

        const next = !!active
        if(this.submarineKit.active === next)
            return

        this.submarineKit.active = next
        this.submarineKit.group.visible = next

        if(next)
        {
            this.submarineKit.savedVisibility.clear()
            for(const child of this.parts.chassis.children)
            {
                if(
                    child === this.submarineKit.group ||
                    child === this.boostTrails?.leftReference ||
                    child === this.boostTrails?.rightReference
                )
                    continue

                this.submarineKit.savedVisibility.set(child, child.visible)
                child.visible = false
            }

            if(this.antenna?.head)
            {
                this.submarineKit.savedAntennaVisible = this.antenna.head.visible
                this.antenna.head.visible = false
            }
        }
        else
        {
            for(const [ child, prevVisible ] of this.submarineKit.savedVisibility.entries())
            {
                child.visible = prevVisible
            }
            this.submarineKit.savedVisibility.clear()

            if(this.parts.blinkerLeft)
                this.parts.blinkerLeft.visible = false
            if(this.parts.blinkerRight)
                this.parts.blinkerRight.visible = false
            if(this.parts.stopLights)
                this.parts.stopLights.visible = false
            if(this.parts.backLights)
                this.parts.backLights.visible = false

            if(this.antenna?.head)
                this.antenna.head.visible = this.submarineKit.savedAntennaVisible
        }
    }

    setCharacterFace()
    {
        const eyeMat = new THREE.MeshBasicNodeMaterial()
        eyeMat.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#7ef2ff').mul(1.9)), 1))()

        const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.14), eyeMat)
        leftEye.position.set(1.425, 0.09, -0.24)
        const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.14), eyeMat)
        rightEye.position.set(1.425, 0.09, 0.24)

        const smile = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.24), eyeMat)
        smile.position.set(1.425, -0.01, 0)

        this.parts.chassis.add(leftEye, rightEye, smile)
        this.characterFace = { leftEye, rightEye, smile }
    }

    setCargoTrophies()
    {
        const group = new THREE.Group()
        this.parts.chassis.add(group)

        const goldMat = new MeshDefaultMaterial({ colorNode: color('#f5c542'), hasWater: false, hasLightBounce: false })
        const greenMat = new MeshDefaultMaterial({ colorNode: color('#2d8a4e'), hasWater: false, hasLightBounce: false })
        const cyanMat = new THREE.MeshBasicNodeMaterial()
        cyanMat.outputNode = Fn(() => vec4(MeshDefaultMaterial.revealDiscardNodeBuilder(this.game, color('#38bdf8').mul(1.7)), 1))()
        const darkMat = new MeshDefaultMaterial({ colorNode: color('#1e293b'), hasWater: false, hasLightBounce: false })
        const cedarMat = new MeshDefaultMaterial({ colorNode: color('#c67c3b'), hasWater: false, hasLightBounce: false })
        const silverMat = new MeshDefaultMaterial({ colorNode: color('#cbd5e1'), hasWater: false, hasLightBounce: false })
        const redMat = new MeshDefaultMaterial({ colorNode: color('#dc2626'), hasWater: false, hasLightBounce: false })

        const items = new Map()

        // 1. Agro: mini fardo dourado + broto verde
        {
            const m = new THREE.Group()
            const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.24, 12), goldMat)
            roll.rotation.z = Math.PI * 0.5
            m.add(roll)
            const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), greenMat)
            leaf.position.y = 0.18
            m.add(leaf)
            m.position.set(-0.62, 0.28, -0.32)
            m.visible = false
            group.add(m)
            items.set('agro', m)
        }

        // 2. Tech: mini rack servidor brilhante
        {
            const m = new THREE.Group()
            const rack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.22), darkMat)
            m.add(rack)
            const led = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.14), cyanMat)
            led.position.y = 0.08
            m.add(led)
            m.position.set(-1.04, 0.33, -0.32)
            m.visible = false
            group.add(m)
            items.set('tech', m)
        }

        // 3. Negocios: mini grafico 3D dourado
        {
            const m = new THREE.Group()
            for(let b = 0; b < 3; b++)
            {
                const h = 0.12 + b * 0.09
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), b === 2 ? goldMat : cyanMat)
                bar.position.set(0, h * 0.5 - 0.1, -0.10 + b * 0.10)
                m.add(bar)
            }
            m.position.set(-0.62, 0.27, 0.32)
            m.visible = false
            group.add(m)
            items.set('business', m)
        }

        // 4. Musica: mini violao apoiado perto da cabine
        {
            const m = new THREE.Group()
            const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.07, 12), cedarMat)
            body.rotation.x = Math.PI * 0.5
            m.add(body)
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.30, 0.03), darkMat)
            neck.position.y = 0.22
            m.add(neck)
            m.rotation.set(-0.45, Math.PI * 0.5, 0)
            m.position.set(-0.56, 0.36, 0.0)
            m.visible = false
            group.add(m)
            items.set('music', m)
        }

        // 5. Musculacao: mini barra olimpica com anilhas vermelhas
        {
            const m = new THREE.Group()
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8), silverMat)
            bar.rotation.x = Math.PI * 0.5
            m.add(bar)
            for(const pz of [ -0.16, 0.16 ])
            {
                const p = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.04, 12), redMat)
                p.rotation.x = Math.PI * 0.5
                p.position.z = pz
                m.add(p)
            }
            m.position.set(-1.04, 0.26, 0.30)
            m.visible = false
            group.add(m)
            items.set('gym', m)
        }

        const unlocked = new Set()
        try
        {
            const saved = JSON.parse(localStorage.getItem('vn_park_trophies_v1') || '[]')
            if(Array.isArray(saved))
            {
                for(const id of saved)
                {
                    if(items.has(id))
                    {
                        unlocked.add(id)
                        items.get(id).visible = true
                    }
                }
            }
        }
        catch(e) {}

        this.cargoTrophies = { group, items, unlocked }
    }

    unlockCargoTrophy(id)
    {
        const mesh = this.cargoTrophies?.items.get(id)
        if(!mesh)
            return false
        const isNew = !this.cargoTrophies.unlocked.has(id)
        this.cargoTrophies.unlocked.add(id)
        mesh.visible = true
        try
        {
            localStorage.setItem('vn_park_trophies_v1', JSON.stringify([ ...this.cargoTrophies.unlocked ]))
        }
        catch(e) {}
        return isNew
    }

    setMainGroundTrack()
    {
        this.mainGroundTrack = this.game.tracks.add(new Track(1.5, 'g'))
    }

    setWheels()
    {
        // Setup
        this.wheels = {}
        this.wheels.items = []
        this.wheels.steering = 0

        // Create wheels
        for(let i = 0; i < 4; i++)
        {
            const wheel = {}

            // Clone group
            wheel.container = this.parts.wheelContainer.clone(true)
            this.parts.chassis.add(wheel.container)

            wheel.container.traverse((child) =>
            {
                if(child.name.match(/^wheelSuspension/))
                    wheel.suspension = child
                if(child.name.match(/^wheelCylinder/))
                    wheel.cylinder = child
                if(child.name.match(/^wheelPainted/))
                    wheel.painted = child
            })
            
            // Cylinder (actual wheel)
            wheel.cylinder.position.set(0, 0, 0)
            
            if(i === 0 || i === 2)
                wheel.container.rotation.y = Math.PI

            // Add new track
            wheel.groundTrack = this.game.tracks.add(new Track(0.5, 'r'))

            this.wheels.items.push(wheel)
        }
    }

    setBlinkers()
    {
        if(!this.parts.blinkerLeft)
            return
            
        this.blinkers = {}

        let running = false
        let on = false

        const start = () =>
        {
            if(running)
                return

            running = true
            on = true

            this.parts.blinkerLeft.visible = this.game.inputs.actions.get('left').active ? on : false
            this.parts.blinkerRight.visible = this.game.inputs.actions.get('right').active ? on : false

            gsap.delayedCall(0.8, blink)
        }

        const blink = () =>
        {
            on = !on

            if(this.submarineKit?.active)
            {
                this.parts.blinkerLeft.visible = false
                this.parts.blinkerRight.visible = false
            }
            else
            {
                this.parts.blinkerLeft.visible = this.game.inputs.actions.get('left').active ? on : false
                this.parts.blinkerRight.visible = this.game.inputs.actions.get('right').active ? on : false
            }

            if(!this.game.inputs.actions.get('left').active && !this.game.inputs.actions.get('right').active && !on)
            {
                running = false
            }
            else
            {
                gsap.delayedCall(0.8, blink)
            }
        }

        this.blinkers.leftCallback = (active) =>
        {
            if(active.active)
                start()
        }
        
        this.blinkers.rightCallback = (active) =>
        {
            if(active.active)
                start()
        }

        this.game.inputs.events.on('left', this.blinkers.leftCallback)
        this.game.inputs.events.on('right', this.blinkers.rightCallback)
    }

    setBackLights()
    {
        this.backLights = {}
        this.backLights.material = new THREE.MeshBasicNodeMaterial({ colorNode: vec3(2.2) })
    }

    setAntenna()
    {
        if(!this.parts.antenna)
            return

        this.antenna = {}
        this.antenna.target = new THREE.Vector3(0, 2, 0)
        this.antenna.target = new THREE.Vector3(0, 2, 0)
        this.antenna.object = this.parts.antenna
        this.antenna.head = this.game.resources.vehicle.scene.getObjectByName('antennaHead')
        this.antenna.headAxle = this.antenna.head.children[0]
        this.antenna.headReference = this.antenna.object.getObjectByName('antennaHeadReference')

        this.game.materials.updateObject(this.antenna.head)
        this.game.scene.add(this.antenna.head)
    }

    setBoostTrails()
    {
        this.boostTrails = {}
        this.boostTrails.instance = new Trails()

        this.boostTrails.leftReference = new THREE.Object3D()
        this.boostTrails.leftReference.position.set(-1.28, 0.1, -0.55)
        this.parts.chassis.add(this.boostTrails.leftReference)

        this.boostTrails.left = this.boostTrails.instance.create()
        this.boostTrails.leftReference.getWorldPosition(this.boostTrails.left.position)
    
        this.boostTrails.rightReference = new THREE.Object3D()
        this.boostTrails.rightReference.position.set(-1.28, 0.1, 0.55)
        this.parts.chassis.add(this.boostTrails.rightReference)

        this.boostTrails.right = this.boostTrails.instance.create()
        this.boostTrails.rightReference.getWorldPosition(this.boostTrails.right.position)
    }

    setBoostAnimation()
    {
        this.boostAnimation = {}
        this.boostAnimation.mix = 0
        this.boostAnimation.speed = 1.2
        this.boostAnimation.mixUniform = uniform(0)

        // Energy
        if(this.parts.energy)
        {
            const emissiveOuput = this.game.materials.getFromName('emissiveBlueRadialGradient').outputNode
            const defaultOutput = this.parts.energy.material.outputNode

            const material = new THREE.MeshLambertNodeMaterial()
            material.outputNode = mix(defaultOutput, emissiveOuput, this.boostAnimation.mixUniform)

            this.parts.energy.material = material
        }
    }

    setScreenPosition()
    {
        this.screenPosition = new THREE.Vector2(0, 0)
    }

    update()
    {
        const physicalVehicle = this.game.physicalVehicle
        
        // Chassis
        this.parts.chassis.position.copy(physicalVehicle.position)
        this.parts.chassis.quaternion.copy(physicalVehicle.quaternion)
        
        // Wheels
        this.wheels.steering += ((this.game.player.steering * physicalVehicle.steeringAmplitude) - this.wheels.steering) * this.game.ticker.deltaScaled * 16

        const wheelsRotation = (physicalVehicle.forwardSpeed) / physicalVehicle.wheels.settings.radius * 0.006

        for(let i = 0; i < 4; i++)
        {
            const visualWheel = this.wheels.items[i]
            const physicalWheel = physicalVehicle.wheels.items[i]

            // visualWheel.container.position.copy(physicalWheel.basePosition)

            if(!this.game.inputs.actions.get('brake').active || this.game.inputs.actions.get('forward').active || this.game.inputs.actions.get('backward').active)
            {
                if(i === 0 || i === 2)
                    visualWheel.cylinder.rotation.z += wheelsRotation
                else
                    visualWheel.cylinder.rotation.z -= wheelsRotation
            }

            if(i === 0)
                visualWheel.container.rotation.y = Math.PI + this.wheels.steering

            if(i === 1)
                visualWheel.container.rotation.y = this.wheels.steering
  
            const suspensionLength = physicalWheel.suspensionLength
            let wheelY = physicalWheel.basePosition.y - suspensionLength
            wheelY = Math.min(wheelY, -0.5)

            visualWheel.container.position.x = physicalWheel.basePosition.x
            visualWheel.container.position.y += (wheelY - visualWheel.container.position.y) * 25 * this.game.ticker.deltaScaled
            visualWheel.container.position.z = physicalWheel.basePosition.z

            if(visualWheel.suspension)
            {
                const suspensionScale = Math.abs(visualWheel.container.position.y) - 0.5
                visualWheel.suspension.scale.y = suspensionScale
            }

            // Ground tracks (desativado quando tracks.enabled = false)
            if(this.game.tracks.enabled)
                visualWheel.groundTrack.update(physicalWheel.contactPoint, physicalWheel.inContact)
        }

        // Main ground track
        if(this.game.tracks.enabled)
            this.mainGroundTrack.update(physicalVehicle.position, physicalVehicle.position.y < 1.5)

        // Antenna
        if(this.antenna)
        {
            const angle = Math.atan2(this.antenna.target.x - physicalVehicle.position.x, this.antenna.target.z - physicalVehicle.position.z)
            this.antenna.object.rotation.y = angle - this.parts.chassis.rotation.y
            this.antenna.headReference.getWorldPosition(this.antenna.head.position)
            this.antenna.head.lookAt(this.antenna.target)

            const antennaTargetDistance = this.antenna.target.distanceTo(physicalVehicle.position)
            
            const antennaRotationSpeed = remapClamp(antennaTargetDistance, 50, 5, 1, 10)
            this.antenna.headAxle.rotation.z += this.game.ticker.deltaScaled * antennaRotationSpeed
        }

        // Stop/back lights
        if(this.submarineKit?.active)
        {
            if(this.parts.stopLights)
                this.parts.stopLights.visible = false

            if(this.parts.backLights)
                this.parts.backLights.visible = false
        }
        else if(this.game.player.braking)
        {
            if(this.parts.stopLights)
                this.parts.stopLights.visible = true

            if(this.parts.backLights)
            {
                this.parts.backLights.visible = true
                this.parts.backLights.material = this.game.materials.getFromName('emissiveOrangeRadialGradient')
            }
        }
        else
        {
            if(this.parts.stopLights)
                this.parts.stopLights.visible = false

            if(this.parts.backLights)
            {
                // Backward
                if(this.game.player.accelerating < 0)
                {
                    this.parts.backLights.visible = true
                    this.parts.backLights.material = this.backLights.material
                }
                // Backward
                else
                {
                    this.parts.backLights.visible = false
                }
            }
        }

        // Boost trails
        const trailAlpha = physicalVehicle.goingForward && this.game.player.boosting && this.game.player.accelerating > 0 ? 1 : 0
        this.boostTrails.leftReference.getWorldPosition(this.boostTrails.left.position)
        this.boostTrails.left.alpha = trailAlpha
        this.boostTrails.rightReference.getWorldPosition(this.boostTrails.right.position)
        this.boostTrails.right.alpha = trailAlpha

        // Boost animation
        this.boostAnimation.mix += (this.game.player.boosting ? 1 : - 1) * this.game.ticker.deltaScaled * this.boostAnimation.speed
        this.boostAnimation.mix = clamp(this.boostAnimation.mix, 0, 1)
        // this.boostAnimation.mixUniform.value = remapClamp(this.boostAnimation.mix, 0, 0.2, 0, 1)
        this.boostAnimation.mixUniform.value = 1 - Math.pow(1 - this.boostAnimation.mix, 7)
        if(this.parts.energy)
        {
            this.parts.cell1.position.y = remapClamp(this.boostAnimation.mix, 0, 0.6, 0.2, 0)
            this.parts.cell3.position.y = remapClamp(this.boostAnimation.mix, 0.2, 0.8, 0.2, 0)
            this.parts.cell2.position.y = remapClamp(this.boostAnimation.mix, 0.4, 1, 0.2, 0)
        }

        // Screen position
        const vector = new THREE.Vector3()
        vector.setFromMatrixPosition(this.parts.chassis.matrixWorld)
        vector.project(this.game.view.camera)

        this.screenPosition.x = (vector.x * 0.5 + 0.5)
        this.screenPosition.y = (vector.y * -0.5 + 0.5)

        if(this.submarineKit?.active)
        {
            const speedMag = Math.abs(physicalVehicle.forwardSpeed)
            const spin = (speedMag + 3) * this.game.ticker.deltaScaled * 3.5
            for(const prop of this.submarineKit.propellers)
                prop.rotation.x += spin

            const t = this.game.ticker.elapsedScaled
            const wakeLen = 1.6 + Math.min(2.6, speedMag * 0.12)
            for(const b of this.submarineKit.bubbles)
            {
                const p = (t * (0.9 + speedMag * 0.04) + b.phase) % 1
                b.mesh.position.set(
                    b.baseX - p * wakeLen,
                    b.baseY + p * (0.45 + b.driftY),
                    b.baseZ + Math.sin(t * 6 + b.phase * 10) * 0.06 + p * b.driftZ
                )
                const s = Math.sin(p * Math.PI) * (0.65 + (b.phase % 0.4))
                b.mesh.scale.setScalar(Math.max(0.01, s))
            }

            if(this.submarineKit.eyes)
            {
                const blink = (t % 4.2) > 4.08 ? 0.12 : (this.game.player.boosting ? 1.25 : 1.0)
                this.submarineKit.eyes.leftEye.scale.y = blink
                this.submarineKit.eyes.rightEye.scale.y = blink
                this.submarineKit.eyes.smile.scale.z = this.game.player.boosting ? 1.25 : 1.0
            }
        }

        if(this.characterFace)
        {
            const t = this.game.ticker.elapsedScaled
            const blink = (t % 4.2) > 4.08 ? 0.12 : (this.game.player.boosting ? 1.25 : 1.0)
            this.characterFace.leftEye.scale.y = blink
            this.characterFace.rightEye.scale.y = blink
            this.characterFace.smile.scale.z = this.game.player.boosting ? 1.25 : 1.0
        }
    }
}