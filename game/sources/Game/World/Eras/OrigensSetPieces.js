import * as THREE from 'three/webgpu'
import { texture, uv, vec3 } from 'three/tsl'
import { Game } from '../../Game.js'

const CONFETTI_COLORS = [ 0xf2b84b, 0xe8734a, 0xf4ead5, 0x8fb86a, 0xc2412d ]
const CONFETTI_COUNT = 28

function clamp01(t)
{
    return Math.max(0, Math.min(1, t))
}

function easeOutBack(t)
{
    const c1 = 1.70158
    const c3 = c1 + 1
    const x = clamp01(t) - 1
    return 1 + c3 * x * x * x + c1 * x * x
}

function easeOutCubic(t)
{
    const x = 1 - clamp01(t)
    return 1 - x * x * x
}

/**
 * Interactive set pieces for Era 1 ("Origens"):
 * - T2.19a (O2, 1994): Pop-up house unfolding + Ipe blooming + confetti + card `e-1994-09`
 * - T2.19b (O5, 2005): CRT power button stamp -> Ponto Interativo 256x192 screen + card `e-2005-01`
 * - T2.19c (O8, 2011): Capelo parabolic flight onto Victor's head bone + card `e-2011-12`
 */
export class OrigensSetPieces
{
    constructor(era = null)
    {
        this.game = era?.game || Game.getInstance()
        this.era = era || this.game?.world?.origensEra || null
        this.world = era?.world || this.game?.world || null

        this.housePopped = false
        this.crtLit = false
        this.capeloAttached = false

        this.houseAnim = null
        this.crtAnim = null
        this.capeloAnim = null
        this.confetti = null

        this.meshes = {}
        this.restTransforms = new Map()
        this.crtTexture = null
        this.crtLoading = false

        this._tempVecA = new THREE.Vector3()
        this._tempVecB = new THREE.Vector3()
        this._tempQuat = new THREE.Quaternion()
        this._tempScale = new THREE.Vector3()
        this._headOffset = new THREE.Vector3(0, 0.22, 0)
        this._disposed = false
        this._unsubs = []

        this.resolveMeshes()
        this.prepareInitialStates()
        this.bindEvents()
        this.exposeDebugApi()
    }

    getObject3D(name)
    {
        const entry = this.era?.landmarkMeshes?.get(name)
        if(entry?.visual?.object3D)
            return entry.visual.object3D
        return this.game?.scene?.getObjectByName(name) || null
    }

    resolveMeshes()
    {
        const names = [
            'OrigensHouseBody',
            'OrigensHousePorch',
            'OrigensHouseRoof',
            'OrigensIpeBloom',
            'OrigensCrtPowerButton',
            'screen',
            'OrigensCapelo',
        ]
        for(const name of names)
        {
            const obj = this.getObject3D(name)
            this.meshes[name] = obj
            if(obj)
            {
                this.restTransforms.set(name, {
                    position: obj.position.clone(),
                    quaternion: obj.quaternion.clone(),
                    scale: obj.scale.clone(),
                })
            }
        }
    }

    prepareInitialStates()
    {
        // Fold house & ipe bloom subtly until 1994 milestone is triggered
        const houseParts = [ 'OrigensHouseBody', 'OrigensHousePorch', 'OrigensHouseRoof' ]
        for(const name of houseParts)
        {
            const mesh = this.meshes[name]
            const rest = this.restTransforms.get(name)
            if(!mesh || !rest)
                continue
            mesh.scale.set(rest.scale.x, rest.scale.y * 0.08, rest.scale.z)
            mesh.position.y = rest.position.y - 0.55
        }

        const ipe = this.meshes.OrigensIpeBloom
        if(ipe)
            ipe.scale.setScalar(0.001)
    }

    bindEvents()
    {
        const fixedUn = this.game.ticker.events.on('fixedTick', () => this.fixedUpdate(), 7)
        const tickUn = this.game.ticker.events.on('tick', () => this.update(), 8)
        if(typeof fixedUn === 'function') this._unsubs.push(fixedUn)
        if(typeof tickUn === 'function') this._unsubs.push(tickUn)

        const player = this.world?.player
        if(player?.controller?.events)
        {
            const bumpUn = player.controller.events.on('bump', (info) => this.onPlayerBump(info))
            const stampUn = player.controller.events.on('stamp', (info) => this.onPlayerStamp(info))
            if(typeof bumpUn === 'function') this._unsubs.push(bumpUn)
            if(typeof stampUn === 'function') this._unsubs.push(stampUn)
        }
        if(player?.events)
        {
            const interactUn = player.events.on('interact', () => this.onPlayerInteract())
            if(typeof interactUn === 'function') this._unsubs.push(interactUn)
        }

        this._onKeyDown = (event) =>
        {
            if(!this.hasActiveAnimation())
                return
            if(event.code === 'Space' || event.code === 'Escape')
                this.skipActiveAnimation()
        }
        this._onPointerDown = () =>
        {
            if(this.hasActiveAnimation())
                this.skipActiveAnimation()
        }
        if(typeof window !== 'undefined')
        {
            window.addEventListener('keydown', this._onKeyDown)
            this.game?.canvasElement?.addEventListener('pointerdown', this._onPointerDown)
        }
    }

    getPlayerPosition()
    {
        const player = this.world?.player
        if(!player)
            return null
        if(player.controller?.position)
            return player.controller.position
        return player.model?.position || null
    }

    getReferencePosition(refName, fallbackMeshName)
    {
        const ref = this.world?.references?.get(refName)
        if(ref?.position)
            return ref.position
        const rest = fallbackMeshName ? this.restTransforms.get(fallbackMeshName) : null
        return rest?.position || null
    }

    onPlayerBump()
    {
        if(this.housePopped)
            return
        const pos = this.getPlayerPosition()
        const refPos = this.getReferencePosition('refMilestone1994', 'OrigensHousePorch')
        if(!pos || !refPos)
            return

        const horiz = Math.hypot(pos.x - refPos.x, pos.z - refPos.z)
        const dy = Math.abs(pos.y - refPos.y)
        if(horiz <= 2.1 && dy <= 2.0)
            this.trigger1994()
    }

    onPlayerStamp(info)
    {
        if(this.crtLit || !info)
            return
        const btnRest = this.restTransforms.get('OrigensCrtPowerButton')
        const target = btnRest?.position || this.getReferencePosition('refMilestone2005')
        if(!target)
            return

        const horiz = Math.hypot(info.x - target.x, info.z - target.z)
        const dy = Math.abs(info.y - target.y)
        if(horiz <= 1.75 && dy <= 1.4)
            this.trigger2005()
    }

    onPlayerInteract()
    {
        const pos = this.getPlayerPosition()
        if(!pos)
            return

        const assist = Boolean(this.game?.ui?.options?.assistMode)
        const radius = assist ? 3.5 : 2.4

        if(!this.housePopped)
        {
            const ref1994 = this.getReferencePosition('refMilestone1994', 'OrigensHousePorch')
            if(ref1994 && Math.hypot(pos.x - ref1994.x, pos.z - ref1994.z) <= radius)
            {
                this.trigger1994()
                return
            }
        }

        if(!this.crtLit)
        {
            const btnPos = this.restTransforms.get('OrigensCrtPowerButton')?.position || this.getReferencePosition('refMilestone2005')
            if(btnPos && Math.hypot(pos.x - btnPos.x, pos.z - btnPos.z) <= radius)
            {
                this.trigger2005()
                return
            }
        }

        if(!this.capeloAttached)
        {
            const capPos = this.restTransforms.get('OrigensCapelo')?.position || this.getReferencePosition('refMilestone2011')
            if(capPos && Math.hypot(pos.x - capPos.x, pos.z - capPos.z) <= radius)
                this.trigger2011()
        }
    }

    fixedUpdate()
    {
        if(this._disposed)
            return

        const pos = this.getPlayerPosition()
        if(!pos)
            return

        // Proximity check for reaching/bumping OrigensCapelo on the school roof peak (O8, 2011)
        if(!this.capeloAttached && !this.capeloAnim)
        {
            const capPos = this.restTransforms.get('OrigensCapelo')?.position
            if(capPos)
            {
                const horiz = Math.hypot(pos.x - capPos.x, pos.z - capPos.z)
                const dy = Math.abs(pos.y - capPos.y)
                if(horiz <= 1.35 && dy <= 1.5)
                    this.trigger2011()
            }
        }

        // Upward jump bump fallback near 1994 block if KCC didn't fire ceiling bump
        if(!this.housePopped && !this.houseAnim)
        {
            const ref1994 = this.getReferencePosition('refMilestone1994')
            const vy = this.world?.player?.controller?.velocity?.y ?? 0
            if(ref1994 && vy > 0.5)
            {
                const horiz = Math.hypot(pos.x - ref1994.x, pos.z - ref1994.z)
                const dy = ref1994.y - pos.y
                if(horiz <= 1.4 && dy >= -0.3 && dy <= 1.4)
                    this.trigger1994()
            }
        }
    }

    hasActiveAnimation()
    {
        return Boolean(
            (this.houseAnim && !this.houseAnim.done)
            || (this.capeloAnim && !this.capeloAnim.done)
        )
    }

    skipActiveAnimation()
    {
        if(this.houseAnim && !this.houseAnim.done)
            this.finishHousePopup()
        if(this.capeloAnim && !this.capeloAnim.done)
            this.finishCapeloFlight()
    }

    trigger1994({ openCard = true } = {})
    {
        if(this.housePopped)
            return false

        this.housePopped = true
        this.updateEraProgress()

        const reduced = Boolean(this.game?.ui?.options?.reducedMotion)
        if(reduced)
        {
            this.finishHousePopup(openCard)
            return true
        }

        this.houseAnim = {
            elapsed: 0,
            duration: 1.8,
            openCard,
            done: false,
        }
        this.spawnIpeConfetti()
        return true
    }

    finishHousePopup(openCard = true)
    {
        for(const name of [ 'OrigensHouseBody', 'OrigensHousePorch', 'OrigensHouseRoof', 'OrigensIpeBloom' ])
        {
            const mesh = this.meshes[name]
            const rest = this.restTransforms.get(name)
            if(mesh && rest)
            {
                mesh.position.copy(rest.position)
                mesh.quaternion.copy(rest.quaternion)
                mesh.scale.copy(rest.scale)
            }
        }

        if(this.houseAnim)
            this.houseAnim.done = true

        if(openCard)
            this.game?.ui?.openMilestone?.('e-1994-09')
    }

    spawnIpeConfetti()
    {
        const origin = this.restTransforms.get('OrigensIpeBloom')?.position
        if(!origin || !this.game?.scene)
            return

        const geom = new THREE.PlaneGeometry(0.14, 0.14)
        const mat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide,
        })
        const inst = new THREE.InstancedMesh(geom, mat, CONFETTI_COUNT)
        inst.name = 'origensIpeConfetti'
        inst.frustumCulled = false

        const particles = []
        const dummy = new THREE.Object3D()
        const col = new THREE.Color()

        for(let i = 0; i < CONFETTI_COUNT; i++)
        {
            const angle = (i / CONFETTI_COUNT) * Math.PI * 2 + (i % 3) * 0.25
            const speed = 1.6 + (i % 5) * 0.45
            particles.push({
                x: origin.x,
                y: origin.y + 0.3,
                z: origin.z,
                vx: Math.cos(angle) * speed,
                vy: 2.8 + (i % 4) * 0.65,
                vz: Math.sin(angle) * speed,
                rx: i * 0.5,
                ry: i * 0.9,
                vrx: 4 + (i % 3) * 2,
                vry: 5 + (i % 4) * 1.5,
            })
            col.setHex(CONFETTI_COLORS[i % CONFETTI_COLORS.length])
            inst.setColorAt(i, col)
            dummy.position.set(origin.x, origin.y + 0.3, origin.z)
            dummy.updateMatrix()
            inst.setMatrixAt(i, dummy.matrix)
        }
        if(inst.instanceColor)
            inst.instanceColor.needsUpdate = true

        this.game.scene.add(inst)
        this.confetti = { inst, geom, mat, particles, dummy, age: 0, life: 2.0 }
    }

    async trigger2005({ openCard = true } = {})
    {
        if(this.crtLit)
            return false

        this.crtLit = true
        this.updateEraProgress()

        const btn = this.meshes.OrigensCrtPowerButton
        const btnRest = this.restTransforms.get('OrigensCrtPowerButton')
        if(btn && btnRest)
            btn.position.y = btnRest.position.y - 0.06

        this.crtAnim = { elapsed: 0, duration: 0.35 }

        await this.applyPontoInterativoScreen()

        if(openCard)
            this.game?.ui?.openMilestone?.('e-2005-01')

        return true
    }

    async applyPontoInterativoScreen()
    {
        const screenMesh = this.meshes.screen
        if(!screenMesh)
            return false

        if(!this.crtTexture && !this.crtLoading)
        {
            this.crtLoading = true
            try
            {
                const res = await this.game.resourcesLoader.load([
                    [ 'pontoInterativo', 'eras/origens/ponto_interativo.png', 'texture' ],
                ])
                const tex = res?.pontoInterativo
                if(tex)
                {
                    tex.minFilter = THREE.NearestFilter
                    tex.magFilter = THREE.NearestFilter
                    tex.generateMipmaps = false
                    tex.colorSpace = THREE.SRGBColorSpace
                    tex.flipY = false
                    tex.needsUpdate = true
                    this.crtTexture = tex
                }
            }
            catch(err)
            {
                console.warn('[OrigensSetPieces] Failed to load ponto_interativo.png', err)
            }
            finally
            {
                this.crtLoading = false
            }
        }

        if(!this.crtTexture || this._disposed)
            return false

        // Use TEXCOORD_1 (uv1) planar 4:3 UVs on the screen mesh with warm emissive glow
        const hasUv1 = Boolean(screenMesh.geometry?.attributes?.uv1)
        const screenUv = hasUv1 ? uv(1) : uv(0)
        const texSample = texture(this.crtTexture, screenUv).rgb

        const mat = new THREE.MeshStandardNodeMaterial({
            colorNode: texSample,
            emissiveNode: texSample.mul(0.85).add(vec3(0.05, 0.03, 0.01)),
            roughness: 0.25,
            metalness: 0.0,
        })
        mat.userData.prevent = true
        screenMesh.material = mat
        return true
    }

    trigger2011({ openCard = true } = {})
    {
        if(this.capeloAttached)
            return false

        this.capeloAttached = true
        this.updateEraProgress()

        const capelo = this.meshes.OrigensCapelo
        if(!capelo)
        {
            if(openCard)
                this.game?.ui?.openMilestone?.('e-2011-12')
            return true
        }

        if(capelo.parent !== this.game.scene)
            this.game.scene.attach(capelo)

        const reduced = Boolean(this.game?.ui?.options?.reducedMotion)
        if(reduced)
        {
            this.finishCapeloFlight(openCard)
            return true
        }

        this.world?.player?.visual?.trigger?.('celebrate', 1.4)

        this.capeloAnim = {
            elapsed: 0,
            duration: 1.25,
            startPos: capelo.position.clone(),
            startQuat: capelo.quaternion.clone(),
            openCard,
            done: false,
            attached: false,
        }
        return true
    }

    finishCapeloFlight(openCard = true)
    {
        const capelo = this.meshes.OrigensCapelo
        const visual = this.world?.player?.visual

        if(this.capeloAnim)
        {
            this.capeloAnim.done = true
            this.capeloAnim.attached = true
        }

        if(capelo && visual)
        {
            if(typeof visual.attachHeadAccessory === 'function')
                visual.attachHeadAccessory(capelo)
            else
                this.syncCapeloToHeadBone()
        }

        if(openCard)
            this.game?.ui?.openMilestone?.('e-2011-12')
    }

    getHeadTargetWorldPose(outPos, outQuat)
    {
        const visual = this.world?.player?.visual
        const headBone = visual?.bones?.head
        if(headBone)
        {
            headBone.updateWorldMatrix(true, false)
            headBone.matrixWorld.decompose(outPos, outQuat, this._tempScale)
            this._tempVecB.copy(this._headOffset).applyQuaternion(outQuat)
            outPos.add(this._tempVecB)
            return true
        }

        const playerPos = this.getPlayerPosition()
        if(!playerPos)
            return false

        outPos.set(playerPos.x, playerPos.y + 0.65, playerPos.z)
        outQuat.setFromAxisAngle(this._tempVecB.set(0, 1, 0), this.world?.player?.controller?.yaw ?? 0)
        return true
    }

    syncCapeloToHeadBone()
    {
        const capelo = this.meshes.OrigensCapelo
        if(!capelo)
            return
        if(typeof this.world?.player?.visual?.attachHeadAccessory === 'function')
            return

        if(this.getHeadTargetWorldPose(this._tempVecA, this._tempQuat))
        {
            capelo.position.copy(this._tempVecA)
            capelo.quaternion.copy(this._tempQuat)
        }
    }

    update()
    {
        if(this._disposed)
            return

        const dt = Math.min(this.game?.ticker?.delta ?? 0.016, 0.05)

        // 1994 House pop-up + Ipe bloom
        if(this.houseAnim && !this.houseAnim.done)
        {
            this.houseAnim.elapsed += dt
            const t = this.houseAnim.elapsed / this.houseAnim.duration

            this.animateHousePart('OrigensHousePorch', (t - 0.0) / 0.55)
            this.animateHousePart('OrigensHouseBody', (t - 0.1) / 0.6)
            this.animateHousePart('OrigensHouseRoof', (t - 0.25) / 0.65)

            const ipe = this.meshes.OrigensIpeBloom
            const ipeRest = this.restTransforms.get('OrigensIpeBloom')
            if(ipe && ipeRest)
            {
                const bt = clamp01((t - 0.35) / 0.65)
                const s = Math.max(0.001, easeOutBack(bt))
                ipe.scale.copy(ipeRest.scale).multiplyScalar(s)
            }

            if(t >= 1)
                this.finishHousePopup(this.houseAnim.openCard)
        }

        // Confetti burst
        if(this.confetti)
        {
            this.confetti.age += dt
            const { inst, particles, dummy, age, life } = this.confetti
            if(age >= life)
            {
                this.game.scene.remove(inst)
                this.confetti.geom.dispose()
                this.confetti.mat.dispose()
                this.confetti = null
            }
            else
            {
                const fade = 1 - clamp01((age - life * 0.6) / (life * 0.4))
                for(let i = 0; i < particles.length; i++)
                {
                    const p = particles[i]
                    p.vy -= 7.5 * dt
                    p.x += p.vx * dt
                    p.y += p.vy * dt
                    p.z += p.vz * dt
                    p.rx += p.vrx * dt
                    p.ry += p.vry * dt
                    dummy.position.set(p.x, p.y, p.z)
                    dummy.rotation.set(p.rx, p.ry, 0)
                    dummy.scale.setScalar(fade)
                    dummy.updateMatrix()
                    inst.setMatrixAt(i, dummy.matrix)
                }
                inst.instanceMatrix.needsUpdate = true
            }
        }

        // 2011 Capelo parabolic flight -> head bone tracking
        if(this.capeloAnim && !this.capeloAnim.done)
        {
            this.capeloAnim.elapsed += dt
            const t = clamp01(this.capeloAnim.elapsed / this.capeloAnim.duration)
            const capelo = this.meshes.OrigensCapelo

            if(capelo && this.getHeadTargetWorldPose(this._tempVecA, this._tempQuat))
            {
                const ease = easeOutCubic(t)
                capelo.position.lerpVectors(this.capeloAnim.startPos, this._tempVecA, ease)
                capelo.position.y += Math.sin(t * Math.PI) * 1.45

                capelo.quaternion.slerpQuaternions(this.capeloAnim.startQuat, this._tempQuat, ease)
                const spin = (1 - ease) * Math.PI * 2
                this._tempScale.set(0, 1, 0)
                capelo.rotateOnAxis(this._tempScale, spin)
            }

            if(t >= 1)
                this.finishCapeloFlight(this.capeloAnim.openCard)
        }
        else if(this.capeloAttached)
        {
            this.syncCapeloToHeadBone()
        }
    }

    animateHousePart(name, localT)
    {
        const mesh = this.meshes[name]
        const rest = this.restTransforms.get(name)
        if(!mesh || !rest)
            return

        const u = clamp01(localT)
        const s = easeOutBack(u)
        mesh.scale.set(rest.scale.x, Math.max(0.08, rest.scale.y * s), rest.scale.z)
        mesh.position.y = rest.position.y - (1 - Math.min(s, 1.12)) * 0.55
    }

    updateEraProgress()
    {
        const count = (this.housePopped ? 1 : 0) + (this.crtLit ? 1 : 0) + (this.capeloAttached ? 1 : 0)
        this.game?.ui?.setEraProgress?.('Origens', count, 3)
    }

    exposeDebugApi()
    {
        if(typeof window === 'undefined')
            return

        const self = this
        window.__setPieces = {
            get housePopped() { return self.housePopped },
            get crtLit() { return self.crtLit },
            get capeloAttached() { return self.capeloAttached },
            trigger1994: (opts) => self.trigger1994(opts),
            trigger2005: (opts) => self.trigger2005(opts),
            trigger2011: (opts) => self.trigger2011(opts),
            skip: () => self.skipActiveAnimation(),
        }
    }

    dispose()
    {
        this._disposed = true
        for(const unsub of this._unsubs)
            unsub()
        this._unsubs = []

        if(typeof window !== 'undefined')
        {
            window.removeEventListener('keydown', this._onKeyDown)
            this.game?.canvasElement?.removeEventListener('pointerdown', this._onPointerDown)
            if(window.__setPieces)
                delete window.__setPieces
        }

        if(this.confetti)
        {
            this.game?.scene?.remove(this.confetti.inst)
            this.confetti.geom.dispose()
            this.confetti.mat.dispose()
            this.confetti = null
        }

        if(this.crtTexture)
        {
            this.crtTexture.dispose()
            this.crtTexture = null
        }
    }
}
