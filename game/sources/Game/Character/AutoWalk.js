import * as THREE from 'three/webgpu'
import { Events } from '../Events.js'
import { Game } from '../Game.js'
import { feel } from '../../data/feel.js'

const MILESTONE_CYCLE = [
    { id: 'e-1994-09', label: '1994 — Nasci em Araguaína/TO' },
    { id: 'e-2005-01', label: '2005 — Ponto Interativo' },
    { id: 'e-2011-12', label: '2011 — Ensino Médio' },
    { id: 'contato', label: 'Contato — Vamos conversar' },
]

const MILESTONE_ALIASES = new Map([
    [ '1994', 'e-1994-09' ],
    [ 'e-1994-09', 'e-1994-09' ],
    [ 'refmilestone1994', 'e-1994-09' ],
    [ '2005', 'e-2005-01' ],
    [ 'e-2005-01', 'e-2005-01' ],
    [ 'refmilestone2005', 'e-2005-01' ],
    [ '2011', 'e-2011-12' ],
    [ 'e-2011-12', 'e-2011-12' ],
    [ 'refmilestone2011', 'e-2011-12' ],
    [ 'contato', 'contato' ],
    [ 'contact', 'contato' ],
    [ 'pipecontact', 'contato' ],
    [ 'enddot', 'contato' ],
    [ 'refpipecontact', 'contato' ],
    [ 'refmilestonecontact', 'contato' ],
    [ 'refenddotsphere', 'contato' ],
    [ 'spawn', 'spawn' ],
    [ 'refrespawn', 'spawn' ],
    [ 'refrespawnorigens', 'spawn' ],
    [ 'busstop', 'busStop' ],
    [ 'refbusstoporigens', 'busStop' ],
])

const WAYPOINT_REACH_RADIUS = 0.8
const FINAL_REACH_RADIUS = 0.65

/**
 * Shortest-path navigation graph over `refNav01..12` + Line spline waypoints (T2.NAV).
 * Drives `Player.setWalkTarget` in fixed-step, handles small step jumps, `Cards` navigate events,
 * and `Tab` -> `Enter` accessible milestone cycling.
 */
export class AutoWalk
{
    constructor(world = null)
    {
        this.game = Game.getInstance()
        this.world = world || this.game?.world || null
        this.events = new Events()

        this.nodes = new Map()
        this.milestoneToNode = new Map()
        this.active = false
        this.target = null
        this.path = []
        this.waypointIndex = 0
        this.arrived = false

        this._cycleIndex = -1
        this._selectedMilestone = null
        this._jumpCooldown = 0
        this._disposed = false

        this.buildGraph()
        this.bindEvents()
        this.exposeDebugApi()
    }

    buildGraph()
    {
        this.nodes.clear()
        this.milestoneToNode.clear()

        const refs = this.world?.references
        if(!refs)
            return

        // 1. Collect canonical refNav01..12 nodes
        const navEntries = []
        for(const [ name, entry ] of refs.entries())
        {
            const m = /^refNav(\d{2})$/i.exec(name)
            if(m)
                navEntries.push({ name, entry })
        }

        // Fallback if only single-digit refNav1..9 were exported
        if(navEntries.length === 0)
        {
            for(const [ name, entry ] of refs.entries())
            {
                if(/^refNav\d+$/i.test(name))
                    navEntries.push({ name, entry })
            }
        }

        for(const { name, entry } of navEntries)
        {
            const ud = entry.userData || {}
            const node = {
                id: name,
                nodeId: ud.nodeId || name,
                position: entry.position.clone(),
                targetMilestone: ud.targetMilestone || '',
                role: ud.role || '',
                edges: new Map(),
            }
            this.nodes.set(name, node)

            if(node.targetMilestone)
                this.milestoneToNode.set(node.targetMilestone.toLowerCase(), name)
        }

        // 2. Wire bidirectional edges from `neighbors` / `links`
        for(const { name, entry } of navEntries)
        {
            const node = this.nodes.get(name)
            const ud = entry.userData || {}
            const neighborList = []

            if(Array.isArray(ud.links))
                neighborList.push(...ud.links)
            if(typeof ud.neighbors === 'string' && ud.neighbors.trim())
                neighborList.push(...ud.neighbors.split(',').map((s) => s.trim()).filter(Boolean))

            for(const nbName of neighborList)
            {
                const nb = this.nodes.get(nbName)
                if(!nb || nb === node)
                    continue
                const dist = node.position.distanceTo(nb.position)
                const dy = Math.abs(node.position.y - nb.position.y)
                const weight = dy > 1.0 ? dist * 3.0 : dist
                node.edges.set(nb.id, weight)
                nb.edges.set(node.id, weight)
            }
        }

        // 3. Line spline waypoints (`refLinePoint01..16`) connected sequentially and to nearby refNav nodes
        const linePoints = []
        for(const [ name, entry ] of refs.entries())
        {
            const m = /^refLinePoint(\d{2})$/i.exec(name)
            if(!m || this.nodes.has(name))
                continue

            const lpNode = {
                id: name,
                nodeId: name,
                index: Number(m[1]),
                position: entry.position.clone(),
                targetMilestone: '',
                role: 'linePoint',
                edges: new Map(),
            }
            this.nodes.set(name, lpNode)
            linePoints.push(lpNode)
        }

        linePoints.sort((a, b) => a.index - b.index)
        for(let i = 0; i < linePoints.length - 1; i++)
        {
            const a = linePoints[i]
            const b = linePoints[i + 1]
            const d = a.position.distanceTo(b.position)
            a.edges.set(b.id, d)
            b.edges.set(a.id, d)
        }

        for(const lpNode of linePoints)
        {
            for(const navNode of this.nodes.values())
            {
                if(navNode.role === 'linePoint')
                    continue
                const d = lpNode.position.distanceTo(navNode.position)
                if(d <= 6.5)
                {
                    lpNode.edges.set(navNode.id, d)
                    navNode.edges.set(lpNode.id, d)
                }
            }
        }
    }

    resolveGoalNode(milestoneId)
    {
        if(!milestoneId)
            return null

        const raw = String(milestoneId).trim()
        const lower = raw.toLowerCase()

        if(this.nodes.has(raw))
            return this.nodes.get(raw)

        const aliased = MILESTONE_ALIASES.get(lower) || lower
        const mappedName = this.milestoneToNode.get(aliased.toLowerCase())
        if(mappedName && this.nodes.has(mappedName))
            return this.nodes.get(mappedName)

        for(const node of this.nodes.values())
        {
            if(node.id.toLowerCase() === lower || node.nodeId.toLowerCase() === lower)
                return node
        }

        return null
    }

    findNearestNode(pos)
    {
        let best = null
        let bestDist = Infinity
        for(const node of this.nodes.values())
        {
            if(node.role === 'linePoint')
                continue
            const d = Math.hypot(node.position.x - pos.x, node.position.z - pos.z)
            if(d < bestDist)
            {
                bestDist = d
                best = node
            }
        }
        return best
    }

    shortestPath(startNode, goalNode)
    {
        if(!startNode || !goalNode)
            return []
        if(startNode === goalNode)
            return [ startNode ]

        const dist = new Map()
        const prev = new Map()
        const unvisited = new Set(this.nodes.keys())

        for(const id of unvisited)
            dist.set(id, Infinity)
        dist.set(startNode.id, 0)

        while(unvisited.size > 0)
        {
            let uId = null
            let minD = Infinity
            for(const id of unvisited)
            {
                const d = dist.get(id)
                if(d < minD)
                {
                    minD = d
                    uId = id
                }
            }

            if(uId === null || minD === Infinity)
                break
            if(uId === goalNode.id)
                break

            unvisited.delete(uId)
            const uNode = this.nodes.get(uId)
            for(const [ vId, weight ] of uNode.edges.entries())
            {
                if(!unvisited.has(vId))
                    continue
                const alt = minD + weight
                if(alt < dist.get(vId))
                {
                    dist.set(vId, alt)
                    prev.set(vId, uId)
                }
            }
        }

        if(dist.get(goalNode.id) === Infinity)
            return []

        const result = []
        let cur = goalNode.id
        while(cur)
        {
            result.unshift(this.nodes.get(cur))
            cur = prev.get(cur)
        }
        return result
    }

    getPlayerPosition()
    {
        const player = this.world?.player
        if(player?.controller?.body)
            return player.controller.body.translation()
        return player?.model?.position || null
    }

    goTo(milestoneId)
    {
        if(this._disposed)
            return false

        if(this.nodes.size === 0)
            this.buildGraph()

        const goalNode = this.resolveGoalNode(milestoneId)
        const playerPos = this.getPlayerPosition()
        if(!goalNode || !playerPos)
            return false

        const startNode = this.findNearestNode(playerPos)
        const nodePath = this.shortestPath(startNode, goalNode)
        if(nodePath.length === 0)
            return false

        // Skip startNode if the player is already between startNode and nodePath[1]
        let startIndex = 0
        if(nodePath.length >= 2)
        {
            const a = nodePath[0].position
            const b = nodePath[1].position
            const abx = b.x - a.x
            const abz = b.z - a.z
            const apx = playerPos.x - a.x
            const apz = playerPos.z - a.z
            if(abx * apx + abz * apz > 0)
                startIndex = 1
        }

        this.path = nodePath.slice(startIndex).map((n) => ({
            id: n.id,
            x: n.position.x,
            y: n.position.y,
            z: n.position.z,
        }))
        this.target = String(milestoneId)
        this.waypointIndex = 0
        this.active = true
        this.arrived = false
        this._jumpCooldown = 0

        const wp = this.path[0]
        this.world?.player?.setWalkTarget?.(wp.x, wp.y, wp.z)
        this.events.trigger('start', [ { target: this.target, path: this.path } ])
        return true
    }

    cancel()
    {
        if(!this.active)
            return
        this.active = false
        this.world?.player?.clearWalkTarget?.()
        this.events.trigger('cancel', [ { target: this.target } ])
    }

    hasManualMoveInput()
    {
        const actions = this.game?.inputs?.actions
        if(!actions)
            return false
        if(
            actions.get('forward')?.active ||
            actions.get('backward')?.active ||
            actions.get('left')?.active ||
            actions.get('right')?.active
        )
            return true

        const stick = actions.get('moveStick')?.value
        return Boolean(stick && typeof stick === 'object' && stick.active && Math.hypot(stick.x, stick.y) > 0.1)
    }

    fixedUpdate()
    {
        if(!this.active || this._disposed)
            return

        const player = this.world?.player
        const controller = player?.controller
        if(!player || !controller)
            return

        if(this.game?.inputs?.locked)
            return

        // If the Contact pipe warp started (e.g. arrived at refPipeContact), complete navigation cleanly
        if(this.world?.origensEra?.gameplay?.warpState)
        {
            this.active = false
            this.arrived = true
            player.clearWalkTarget()
            this.announceArrival()
            return
        }

        if(this.hasManualMoveInput())
        {
            this.cancel()
            return
        }

        if(this._jumpCooldown > 0)
            this._jumpCooldown--

        const wp = this.path[this.waypointIndex]
        if(!wp)
        {
            this.active = false
            this.arrived = true
            player.clearWalkTarget()
            this.announceArrival()
            return
        }

        const pos = controller.body.translation()
        const feetY = pos.y - (feel.body.halfHeight + feel.body.radius)
        const distXZ = Math.hypot(wp.x - pos.x, wp.z - pos.z)
        const isLast = this.waypointIndex === this.path.length - 1
        const reachRadius = isLast ? FINAL_REACH_RADIUS : WAYPOINT_REACH_RADIUS

        if(distXZ <= reachRadius)
        {
            this.waypointIndex++
            if(this.waypointIndex >= this.path.length)
            {
                this.active = false
                this.arrived = true
                player.clearWalkTarget()
                this.announceArrival()
                return
            }

            const nextWp = this.path[this.waypointIndex]
            player.setWalkTarget(nextWp.x, nextWp.y, nextWp.z)
            return
        }

        // Keep Player walkTarget synced to current waypoint
        if(
            !player.walkTarget ||
            player.walkTarget.x !== wp.x ||
            player.walkTarget.z !== wp.z
        )
        {
            player.setWalkTarget(wp.x, wp.y, wp.z)
        }

        // Jump smoothly over small steps or if stuck against a curb
        const needsStepJump = (wp.y - feetY > 0.25 && distXZ < 3.0) || player.walkTargetStuckSteps >= 10
        if(needsStepJump && controller.grounded && this._jumpCooldown === 0)
        {
            player.jumpLatch = true
            player.walkTargetStuckSteps = 0
            this._jumpCooldown = 36 // ~0.3s at 120Hz
        }
    }

    announceArrival()
    {
        const entry = MILESTONE_CYCLE.find((m) => m.id === MILESTONE_ALIASES.get(String(this.target).toLowerCase()))
        const label = entry ? entry.label : (this.target || 'destino')
        this.game?.ui?.announcer?.announce(`Chegou a ${label}`)
        this.events.trigger('arrive', [ { target: this.target, path: this.path } ])
    }

    bindEvents()
    {
        this._onFixedTick = () => this.fixedUpdate()
        this.game?.ticker?.events?.on('fixedTick', this._onFixedTick, 1)

        this._onCardsNavigate = (detail) =>
        {
            if(detail?.id)
                this.goTo(detail.id)
        }
        this.game?.ui?.cards?.events?.on('navigate', this._onCardsNavigate)

        this._onWindowNavigate = (event) =>
        {
            const id = event?.detail?.id
            if(id)
                this.goTo(id)
        }
        if(typeof window !== 'undefined')
            window.addEventListener('timeline:navigate', this._onWindowNavigate)

        this._onKeyDown = (event) =>
        {
            if(this.game?.ui?.cards?.isOpen?.() || document.querySelector('dialog[open]'))
                return
            if(event.ctrlKey || event.metaKey || event.altKey)
                return

            if(event.code === 'Tab')
            {
                event.preventDefault()
                const dir = event.shiftKey ? -1 : 1
                this._cycleIndex = (this._cycleIndex + dir + MILESTONE_CYCLE.length) % MILESTONE_CYCLE.length
                this._selectedMilestone = MILESTONE_CYCLE[this._cycleIndex]
                this.game?.ui?.announcer?.announce(
                    `Marco selecionado: ${this._selectedMilestone.label}. Pressione Enter para ir até lá.`
                )
            }
            else if(event.code === 'Enter' && this._selectedMilestone)
            {
                this.goTo(this._selectedMilestone.id)
            }
        }
        if(typeof window !== 'undefined')
            window.addEventListener('keydown', this._onKeyDown)
    }

    exposeDebugApi()
    {
        if(typeof window === 'undefined')
            return

        const self = this
        window.__nav = {
            goTo: (milestoneId) => self.goTo(milestoneId),
            cancel: () => self.cancel(),
            get active() { return self.active },
            get target() { return self.target },
            get path() { return self.path },
            get arrived() { return self.arrived },
            get nodes() { return Array.from(self.nodes.keys()) },
        }
    }

    dispose()
    {
        this._disposed = true
        this.cancel()

        if(this._onFixedTick)
            this.game?.ticker?.events?.off('fixedTick', this._onFixedTick)
        if(this._onCardsNavigate)
            this.game?.ui?.cards?.events?.off('navigate', this._onCardsNavigate)

        if(typeof window !== 'undefined')
        {
            window.removeEventListener('timeline:navigate', this._onWindowNavigate)
            window.removeEventListener('keydown', this._onKeyDown)
            if(window.__nav)
                delete window.__nav
        }
    }
}
