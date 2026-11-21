// Runtime Line ("a Linha") spline, ribbon visual, and airborne sensor envelope (T2.18a / T2.18c).
//
// Loads `origens_line_spline.json` (16 control points, 79.565 m) into a CatmullRomCurve3 and an arc-length
// parameterized LUT for O(1) `sampleAt(s)` and exact segment-projected `closestPoint(pos)`.
// Provides a 100% continuous sensor envelope (`radius = 0.75 m`) and a glowing/pulsing ribbon mesh.
import * as THREE from 'three/webgpu'
import { Game } from '../Game.js'
import { resolveAsset } from '../assetManifest.js'

const DEFAULT_PATH = 'eras/origens/origens_line_spline.json'
const DEFAULT_SENSOR_RADIUS = 0.75
const DEFAULT_LUT_SEGMENTS = 640
const IPE_GOLD = new THREE.Color('#f7c531')
const SIGNAL_RED = new THREE.Color('#ff2a2a')

export class Line
{
    constructor(options = {})
    {
        this.game = options.game ?? Game.getInstance?.() ?? null
        this.sensorRadius = options.sensorRadius ?? DEFAULT_SENSOR_RADIUS
        this.lutSegments = options.lutSegments ?? DEFAULT_LUT_SEGMENTS
        this.width = options.width ?? 0.35
        this.thickness = options.thickness ?? 0.04
        this.length = 0
        this.curve = null
        this.lut = []
        this.controlPoints = []
        this.milestones = []
        this.mesh = null
        this.glowMesh = null
        this.sensorBody = null
        this.sensorColliders = []
        this.grindActive = false
        this.grindProgress = 0
        this.pulseTime = 0

        if(options.data)
        {
            this.buildFromData(options.data)
            this.ready = Promise.resolve(this)
        }
        else if(options.url !== null)
        {
            this.ready = this.load(options.url ?? DEFAULT_PATH)
        }
        else
        {
            this.ready = Promise.resolve(this)
        }
    }

    async load(logicalPath = DEFAULT_PATH)
    {
        let url = new URL(logicalPath, document.baseURI).href
        if(this.game?.resourcesLoader)
        {
            try
            {
                const manifest = await this.game.resourcesLoader.getManifest()
                if(manifest?.assets?.[logicalPath])
                    url = resolveAsset(manifest, logicalPath, document.baseURI)
            }
            catch
            {
                // Fallback to direct static URL when manifest is absent (e.g. dev/debug)
            }
        }

        const response = await fetch(url)
        if(!response.ok)
            throw new Error(`Failed to load Line spline "${logicalPath}" (${response.status})`)

        const data = await response.json()
        this.buildFromData(data)
        return this
    }

    buildFromData(data)
    {
        this.width = data.width ?? this.width
        this.thickness = data.thickness ?? this.thickness

        const points = (data.controlPoints ?? []).map((cp) =>
        {
            const e = cp.engine ?? cp
            return new THREE.Vector3(e[0], e[1], e[2])
        })

        if(points.length < 2)
            throw new Error('Line spline requires at least 2 control points')

        this.controlPoints = points
        this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5)
        this.curve.arcLengthDivisions = Math.max(800, this.lutSegments * 2)

        const curveLength = this.curve.getLength()
        this.length = typeof data.length === 'number' && data.length > 0 ? data.length : curveLength

        // Build uniform arc-length LUT
        this.lut = []
        const count = this.lutSegments
        for(let i = 0; i <= count; i++)
        {
            const u = i / count
            const s = u * this.length
            const point = this.curve.getPointAt(u)
            const tangent = this.curve.getTangentAt(u).normalize()
            this.lut.push({ s, u, point, tangent })
        }

        // Precompute milestone arc-length positions for control points (every 3rd point + endpoints)
        this.milestones = []
        const cpList = data.controlPoints ?? []
        for(let i = 0; i < cpList.length; i++)
        {
            if(i === 0 || i === cpList.length - 1 || i % 3 === 0)
            {
                const p = points[i]
                const closest = this.closestPoint(p)
                this.milestones.push({
                    index: cpList[i].index ?? (i + 1),
                    name: cpList[i].name ?? `refLinePoint${String(i + 1).padStart(2, '0')}`,
                    s: closest.s,
                    progress: this.length > 0 ? closest.s / this.length : 0,
                    point: closest.point,
                })
            }
        }

        this.buildVisual()
        this.buildSensorColliders()
    }

    // Arc-length lookup: returns { s, u, point: { x, y, z }, tangent: { x, y, z } }
    sampleAt(s)
    {
        if(this.lut.length === 0)
            return null

        const clamped = Math.max(0, Math.min(this.length, s))
        const u = this.length > 0 ? clamped / this.length : 0
        const exactIdx = u * this.lutSegments
        const i0 = Math.min(this.lutSegments - 1, Math.floor(exactIdx))
        const i1 = i0 + 1
        const alpha = exactIdx - i0

        const a = this.lut[i0]
        const b = this.lut[i1]

        const px = a.point.x + (b.point.x - a.point.x) * alpha
        const py = a.point.y + (b.point.y - a.point.y) * alpha
        const pz = a.point.z + (b.point.z - a.point.z) * alpha

        let tx = a.tangent.x + (b.tangent.x - a.tangent.x) * alpha
        let ty = a.tangent.y + (b.tangent.y - a.tangent.y) * alpha
        let tz = a.tangent.z + (b.tangent.z - a.tangent.z) * alpha
        const tLen = Math.hypot(tx, ty, tz) || 1
        tx /= tLen
        ty /= tLen
        tz /= tLen

        return {
            s: clamped,
            u,
            point: { x: px, y: py, z: pz },
            tangent: { x: tx, y: ty, z: tz },
        }
    }

    // Exact segment-projected closest point on the LUT (zero blind spots between samples)
    closestPoint(pos)
    {
        if(this.lut.length < 2)
            return null

        const qx = pos.x
        const qy = pos.y
        const qz = pos.z

        let bestDistSq = Infinity
        let bestS = 0
        let bestX = 0
        let bestY = 0
        let bestZ = 0
        let bestTx = 0
        let bestTy = 0
        let bestTz = - 1

        for(let i = 0; i < this.lut.length - 1; i++)
        {
            const a = this.lut[i]
            const b = this.lut[i + 1]
            const abx = b.point.x - a.point.x
            const aby = b.point.y - a.point.y
            const abz = b.point.z - a.point.z
            const abLenSq = abx * abx + aby * aby + abz * abz

            let t = 0
            if(abLenSq > 1e-12)
            {
                const aqx = qx - a.point.x
                const aqy = qy - a.point.y
                const aqz = qz - a.point.z
                t = Math.max(0, Math.min(1, (aqx * abx + aqy * aby + aqz * abz) / abLenSq))
            }

            const cx = a.point.x + abx * t
            const cy = a.point.y + aby * t
            const cz = a.point.z + abz * t
            const dx = qx - cx
            const dy = qy - cy
            const dz = qz - cz
            const distSq = dx * dx + dy * dy + dz * dz

            if(distSq < bestDistSq)
            {
                bestDistSq = distSq
                bestS = a.s + (b.s - a.s) * t
                bestX = cx
                bestY = cy
                bestZ = cz
                bestTx = a.tangent.x + (b.tangent.x - a.tangent.x) * t
                bestTy = a.tangent.y + (b.tangent.y - a.tangent.y) * t
                bestTz = a.tangent.z + (b.tangent.z - a.tangent.z) * t
            }
        }

        const tLen = Math.hypot(bestTx, bestTy, bestTz) || 1
        return {
            s: bestS,
            u: this.length > 0 ? bestS / this.length : 0,
            distance: Math.sqrt(bestDistSq),
            point: { x: bestX, y: bestY, z: bestZ },
            tangent: { x: bestTx / tLen, y: bestTy / tLen, z: bestTz / tLen },
        }
    }

    // Sensor check: returns closest hit if `pos` is within `radius` (default 0.75 m), else null
    detect(pos, radius = this.sensorRadius)
    {
        const hit = this.closestPoint(pos)
        if(!hit || hit.distance > radius)
            return null
        return hit
    }

    buildVisual()
    {
        if(!this.game?.scene || this.lut.length < 2)
            return

        if(this.mesh)
            this.game.scene.remove(this.mesh)
        if(this.glowMesh)
            this.game.scene.remove(this.glowMesh)

        const geometry = this.createRibbonGeometry(this.width, this.thickness)
        this.ribbonMaterial = new THREE.MeshStandardMaterial({
            name: 'lineRibbon',
            color: IPE_GOLD.clone(),
            emissive: SIGNAL_RED.clone(),
            emissiveIntensity: 0.35,
            roughness: 0.35,
            metalness: 0.1,
        })
        this.mesh = new THREE.Mesh(geometry, this.ribbonMaterial)
        this.mesh.name = 'OrigensLineRibbon'
        this.game.scene.add(this.mesh)

        // Subtle additive glow sheath pulsing during grind
        const glowGeo = this.createRibbonGeometry(this.width * 1.35, this.thickness * 1.8)
        this.glowMaterial = new THREE.MeshBasicMaterial({
            name: 'lineRibbonGlow',
            color: IPE_GOLD.clone(),
            transparent: true,
            opacity: 0.14,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        })
        this.glowMesh = new THREE.Mesh(glowGeo, this.glowMaterial)
        this.glowMesh.name = 'OrigensLineRibbonGlow'
        this.game.scene.add(this.glowMesh)

        if(this.game.ticker && !this._tickerBound)
        {
            this._tickerBound = true
            this.game.ticker.events.on('tick', () => this.updateVisual(), 6)
        }
    }

    createRibbonGeometry(width, thickness)
    {
        const halfW = width * 0.5
        const halfT = thickness * 0.5
        const positions = []
        const normals = []
        const indices = []

        const up = new THREE.Vector3(0, 1, 0)
        const right = new THREE.Vector3()
        const tangent = new THREE.Vector3()
        const binormal = new THREE.Vector3()

        // 4-vertex rectangular cross-section per LUT sample (top-left, top-right, bottom-right, bottom-left)
        for(let i = 0; i < this.lut.length; i++)
        {
            const sample = this.lut[i]
            tangent.set(sample.tangent.x, sample.tangent.y, sample.tangent.z).normalize()
            right.crossVectors(tangent, up)
            if(right.lengthSq() < 1e-6)
                right.set(1, 0, 0)
            else
                right.normalize()
            binormal.crossVectors(right, tangent).normalize()

            const cx = sample.point.x
            const cy = sample.point.y
            const cz = sample.point.z

            const corners = [
                [ - halfW, + halfT ],
                [ + halfW, + halfT ],
                [ + halfW, - halfT ],
                [ - halfW, - halfT ],
            ]
            for(const [ rx, uy ] of corners)
            {
                positions.push(
                    cx + right.x * rx + binormal.x * uy,
                    cy + right.y * rx + binormal.y * uy,
                    cz + right.z * rx + binormal.z * uy
                )
                normals.push(binormal.x, binormal.y, binormal.z)
            }
        }

        for(let i = 0; i < this.lut.length - 1; i++)
        {
            const a = i * 4
            const b = (i + 1) * 4
            // Top face (0-1), Right face (1-2), Bottom face (2-3), Left face (3-0)
            for(let side = 0; side < 4; side++)
            {
                const nextSide = (side + 1) % 4
                const a0 = a + side
                const a1 = a + nextSide
                const b0 = b + side
                const b1 = b + nextSide
                indices.push(a0, b0, a1, a1, b0, b1)
            }
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
        geometry.setIndex(indices)
        geometry.computeVertexNormals()
        return geometry
    }

    buildSensorColliders()
    {
        const RAPIER = this.game?.RAPIER
        const world = this.game?.physics?.world
        if(!RAPIER || !world || this.lut.length < 2)
            return

        if(this.sensorBody)
        {
            world.removeRigidBody(this.sensorBody)
            this.sensorBody = null
            this.sensorColliders = []
        }

        this.sensorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())

        // Coarse sensor capsules along the spline (zero-group sensor so KCC/floor raycasts never block on it)
        const stride = Math.max(1, Math.floor(this.lut.length / 80))
        for(let i = 0; i < this.lut.length - 1; i += stride)
        {
            const a = this.lut[i].point
            const b = this.lut[Math.min(this.lut.length - 1, i + stride)].point
            const desc = RAPIER.ColliderDesc
                .capsule(Math.max(0.05, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * 0.5), this.sensorRadius)
                .setSensor(true)
                .setCollisionGroups(0)
                .setTranslation((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5)
            this.sensorColliders.push(world.createCollider(desc, this.sensorBody))
        }
    }

    setGrindVisualState(active, progress = 0)
    {
        this.grindActive = Boolean(active)
        this.grindProgress = progress
    }

    updateVisual()
    {
        const dt = this.game?.ticker?.delta ?? 0
        this.pulseTime += dt

        if(this.ribbonMaterial)
        {
            const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * (this.grindActive ? 14 : 3.2))
            this.ribbonMaterial.emissiveIntensity = this.grindActive ? (0.85 + 0.65 * pulse) : (0.25 + 0.15 * pulse)
        }
        if(this.glowMaterial)
        {
            const pulse = 0.5 + 0.5 * Math.sin(this.pulseTime * 16)
            this.glowMaterial.opacity = this.grindActive ? (0.35 + 0.25 * pulse) : 0.12
            this.glowMaterial.color.copy(IPE_GOLD).lerp(SIGNAL_RED, this.grindActive ? pulse * 0.55 : 0.15)
        }
    }
}
