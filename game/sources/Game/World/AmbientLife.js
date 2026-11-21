import * as THREE from 'three/webgpu'
import { attribute, cos, float, positionLocal, sign, sin, uniform, vec3 } from 'three/tsl'
import { Game } from '../Game.js'

const BUTTERFLY_COUNT = 24
const FLEE_ENTER_DIST = 4.5
const FLEE_EXIT_DIST = 7.5
const PATROL_SPEED = 2.3
const SPRINT_SPEED = 6.4

function mulberry32(seed)
{
    let a = seed >>> 0
    return () =>
    {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function appendColoredBox(buffers, sx, sy, sz, ox, oy, oz, hexColor)
{
    const box = new THREE.BoxGeometry(sx, sy, sz)
    box.translate(ox, oy, oz)
    const nonIndexed = box.index ? box.toNonIndexed() : box
    const pos = nonIndexed.attributes.position.array
    const norm = nonIndexed.attributes.normal.array
    const col = new THREE.Color(hexColor)

    for(let i = 0; i < pos.length; i += 3)
    {
        buffers.positions.push(pos[i], pos[i + 1], pos[i + 2])
        buffers.normals.push(norm[i], norm[i + 1], norm[i + 2])
        buffers.colors.push(col.r, col.g, col.b)
    }

    box.dispose()
    if(nonIndexed !== box)
        nonIndexed.dispose()
}

/**
 * Stylized cerrado ambient life (T2.21b):
 * - Toy-diorama Seriema patrolling refSeriema1..4 and sprinting away if chased (1 draw call)
 * - Instanced cerrado butterflies fluttering near ipê/flowers (1 draw call)
 * Total: 2 draw calls (<= 3). Pauses when reducedMotion or paused is active.
 */
export class AmbientLife
{
    constructor(world, options = {})
    {
        this.game = Game.getInstance()
        this.world = world
        this.paused = Boolean(options.paused)
        this.time = 0
        this.uTime = uniform(0)

        this.waypoints = this.resolveWaypoints()
        this.seriemaState = {
            waypointIndex: 0,
            position: this.waypoints[0].clone(),
            yaw: 0,
            fleeing: false,
            stridePhase: 0,
        }

        this.seriemaMesh = this.createSeriemaMesh()
        this.game.scene.add(this.seriemaMesh)

        this.butterflies = this.createButterflyData()
        this.butterflyMesh = this.createButterflyMesh(this.butterflies)
        this.game.scene.add(this.butterflyMesh)

        this.dummy = new THREE.Object3D()

        this.game.ticker.events.on('tick', () =>
        {
            this.update()
        }, 7)
    }

    resolveWaypoints()
    {
        const refs = []
        for(let i = 1; i <= 4; i++)
        {
            const ref = this.world?.references?.get(`refSeriema${i}`)
            if(ref?.position)
                refs.push(ref.position.clone())
        }
        if(refs.length >= 2)
            return refs

        // Fallback cerrado loop (Three.js Y-up)
        return [
            new THREE.Vector3(-4.0, 1.6, -34.5),
            new THREE.Vector3(0.5, 1.6, -36.8),
            new THREE.Vector3(5.5, 1.6, -38.4),
            new THREE.Vector3(10.0, 1.6, -39.8),
        ]
    }

    createSeriemaMesh()
    {
        const buffers = { positions: [], normals: [], colors: [] }

        // Long coral-red legs
        appendColoredBox(buffers, 0.045, 0.42, 0.045, -0.07, 0.21, 0.0, '#d9534f')
        appendColoredBox(buffers, 0.045, 0.42, 0.045,  0.07, 0.21, 0.0, '#d9534f')
        // Body
        appendColoredBox(buffers, 0.24, 0.22, 0.42, 0.0, 0.50, 0.0, '#d9c5a0')
        // Tail
        appendColoredBox(buffers, 0.14, 0.08, 0.34, 0.0, 0.54, 0.32, '#8b7355')
        // Neck & head
        appendColoredBox(buffers, 0.10, 0.32, 0.10, 0.0, 0.72, -0.16, '#e5d4b3')
        appendColoredBox(buffers, 0.14, 0.14, 0.16, 0.0, 0.90, -0.20, '#e5d4b3')
        // Iconic seriema crest
        appendColoredBox(buffers, 0.04, 0.14, 0.12, 0.0, 1.00, -0.23, '#4a3b2c')
        // Coral beak
        appendColoredBox(buffers, 0.05, 0.04, 0.14, 0.0, 0.88, -0.32, '#d9534f')

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3))
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3))
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(buffers.colors, 3))

        const material = new THREE.MeshStandardMaterial({
            name: 'seriemaMat',
            vertexColors: true,
            roughness: 0.78,
            metalness: 0.04,
        })

        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = 'origensSeriema'
        mesh.castShadow = true
        mesh.receiveShadow = false
        mesh.position.copy(this.seriemaState.position)
        return mesh
    }

    createButterflyData()
    {
        const rand = mulberry32(199409)
        const anchors = []

        const houseRef = this.world?.references?.get('refMilestone1994')
        if(houseRef?.position)
            anchors.push(houseRef.position.clone().add(new THREE.Vector3(1.8, 1.6, -1.2)))

        for(const wp of this.waypoints)
            anchors.push(wp.clone().add(new THREE.Vector3(0, 1.1, 0)))

        const orchardRef = this.world?.references?.get('refSignal11')
        if(orchardRef?.position)
            anchors.push(orchardRef.position.clone().add(new THREE.Vector3(0, 0.9, 0)))

        if(anchors.length === 0)
            anchors.push(new THREE.Vector3(0, 1.5, -10))

        const palette = [ '#f5c43d', '#5ab4e6', '#f28530' ]
        const list = []
        for(let i = 0; i < BUTTERFLY_COUNT; i++)
        {
            const anchor = anchors[i % anchors.length]
            list.push({
                cx: anchor.x + (rand() - 0.5) * 4.5,
                cy: anchor.y + rand() * 1.4,
                cz: anchor.z + (rand() - 0.5) * 4.5,
                radius: 0.5 + rand() * 1.1,
                speed: 0.8 + rand() * 0.9,
                phase: rand() * Math.PI * 2,
                color: palette[i % palette.length],
                scale: 0.85 + rand() * 0.45,
            })
        }
        return list
    }

    createButterflyMesh(butterflies)
    {
        // Double-wing quad pair in XZ, hinged at X = 0
        const positions = new Float32Array([
            0, 0, -0.07,   0.11, 0, -0.09,   0.10, 0,  0.08,   0, 0,  0.06,
            0, 0, -0.07,  -0.11, 0, -0.09,  -0.10, 0,  0.08,   0, 0,  0.06,
        ])
        const normals = new Float32Array(8 * 3)
        for(let i = 0; i < 8; i++)
            normals[i * 3 + 1] = 1

        const indices = [
            0, 1, 2,  0, 2, 3,
            4, 6, 5,  4, 7, 6,
        ]

        const phases = new Float32Array(butterflies.length)
        for(let i = 0; i < butterflies.length; i++)
            phases[i] = butterflies[i].phase

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
        geometry.setIndex(indices)
        geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))

        const material = new THREE.MeshBasicNodeMaterial({
            side: THREE.DoubleSide,
        })

        // Wing flap in TSL: hinge along X = 0
        const phase = attribute('aPhase', 'float')
        const flap = sin(this.uTime.mul(14.0).add(phase)).mul(0.65)
        const wingSign = sign(positionLocal.x)
        const wingDist = positionLocal.x.abs()
        material.positionNode = vec3(
            wingSign.mul(wingDist.mul(cos(flap))),
            positionLocal.y.add(wingDist.mul(sin(flap))),
            positionLocal.z
        )

        const mesh = new THREE.InstancedMesh(geometry, material, butterflies.length)
        mesh.name = 'origensButterflies'
        mesh.count = butterflies.length
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.frustumCulled = false

        const c = new THREE.Color()
        for(let i = 0; i < butterflies.length; i++)
        {
            c.set(butterflies[i].color)
            mesh.setColorAt(i, c)
        }
        if(mesh.instanceColor)
            mesh.instanceColor.needsUpdate = true

        return mesh
    }

    isPaused()
    {
        return Boolean(this.paused || this.game.ui?.options?.reducedMotion)
    }

    setPaused(paused)
    {
        this.paused = Boolean(paused)
    }

    update()
    {
        if(this.isPaused())
            return

        const dt = Math.min(this.game.ticker.delta, 0.05)
        this.time += dt
        this.uTime.value = this.time

        this.updateSeriema(dt)
        this.updateButterflies()
    }

    updateSeriema(dt)
    {
        const s = this.seriemaState
        const playerPos = this.game.world?.player?.model?.position
        if(playerPos)
        {
            const distToPlayer = Math.hypot(playerPos.x - s.position.x, playerPos.z - s.position.z)
            if(!s.fleeing && distToPlayer < FLEE_ENTER_DIST)
            {
                s.fleeing = true
                // Advance target to the waypoint farthest from Victor
                let bestIdx = (s.waypointIndex + 1) % this.waypoints.length
                let bestDist = -1
                for(let i = 0; i < this.waypoints.length; i++)
                {
                    const wp = this.waypoints[i]
                    const d = Math.hypot(wp.x - playerPos.x, wp.z - playerPos.z)
                    if(d > bestDist)
                    {
                        bestDist = d
                        bestIdx = i
                    }
                }
                s.waypointIndex = bestIdx
            }
            else if(s.fleeing && distToPlayer > FLEE_EXIT_DIST)
            {
                s.fleeing = false
            }
        }

        const target = this.waypoints[s.waypointIndex]
        const dx = target.x - s.position.x
        const dz = target.z - s.position.z
        const dist = Math.hypot(dx, dz)

        if(dist < 0.35)
        {
            s.waypointIndex = (s.waypointIndex + 1) % this.waypoints.length
        }
        else
        {
            const speed = s.fleeing ? SPRINT_SPEED : PATROL_SPEED
            const step = Math.min(dist, speed * dt)
            s.position.x += (dx / dist) * step
            s.position.z += (dz / dist) * step
            s.position.y = THREE.MathUtils.lerp(s.position.y, target.y, Math.min(1, dt * 6))

            const targetYaw = Math.atan2(-dx, -dz)
            let deltaYaw = targetYaw - s.yaw
            while(deltaYaw > Math.PI) deltaYaw -= Math.PI * 2
            while(deltaYaw < -Math.PI) deltaYaw += Math.PI * 2
            s.yaw += deltaYaw * Math.min(1, dt * 10)
        }

        s.stridePhase += dt * (s.fleeing ? 18 : 9)
        const bob = Math.abs(Math.sin(s.stridePhase)) * (s.fleeing ? 0.12 : 0.05)

        this.seriemaMesh.position.set(s.position.x, s.position.y + bob, s.position.z)
        this.seriemaMesh.rotation.set(s.fleeing ? -0.14 : 0, s.yaw, Math.sin(s.stridePhase) * 0.05)
    }

    updateButterflies()
    {
        for(let i = 0; i < this.butterflies.length; i++)
        {
            const b = this.butterflies[i]
            const t = this.time * b.speed + b.phase
            const x = b.cx + Math.cos(t) * b.radius
            const y = b.cy + Math.sin(t * 2.1) * 0.35
            const z = b.cz + Math.sin(t * 0.85) * b.radius
            const yaw = -t + Math.PI * 0.5

            this.dummy.position.set(x, y, z)
            this.dummy.rotation.set(0.15, yaw, 0)
            this.dummy.scale.setScalar(b.scale)
            this.dummy.updateMatrix()
            this.butterflyMesh.setMatrixAt(i, this.dummy.matrix)
        }
        this.butterflyMesh.instanceMatrix.needsUpdate = true
    }

    getStats()
    {
        return {
            drawCalls: 2,
            butterflies: this.butterflies.length,
            seriemaFleeing: this.seriemaState.fleeing,
            paused: this.isPaused(),
        }
    }

    dispose()
    {
        this.seriemaMesh.removeFromParent()
        this.seriemaMesh.geometry.dispose()
        this.seriemaMesh.material.dispose()
        this.butterflyMesh.removeFromParent()
        this.butterflyMesh.geometry.dispose()
        this.butterflyMesh.material.dispose()
    }
}
