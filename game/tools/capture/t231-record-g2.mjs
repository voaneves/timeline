// T2.31 G2 comparison capture runner & gameplay script:
// - When run directly: builds dist-debug-t231, starts a single vite preview server on port 4220,
//   records 4 comparison videos (15s each, --capture cdp --encoder libx264) into tools/capture/runs/g2/,
//   stops only the preview server PID on exit, verifies all 4 video.mp4 via ffprobe,
//   and moves dist-debug-t231 to D:\GitHub\pode_apagar\timeline\t231\dist-debug-t231.
// - When imported as --script by record.mjs: drives Victor forward -> bump 1994 block -> house pop-up
//   -> jump -> glide -> grind on the Line across Origens.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FFPROBE } from './sheet.mjs'

export default async function origensG2Script({ page, mark, sleep, remaining })
{
    await page.waitForFunction(() => Boolean(window.game?.ready && window.game?.world?.player?.controller), null, { timeout: 20000 })
    mark('worldReady')

    // Install fixedTick steering pilot inside the page using real Inputs.applyAction
    await page.evaluate(() =>
    {
        const g = window.game
        const c = g.world.player.controller
        const body = c.body
        const A = (name, value) => g.inputs.applyAction(name, value ? 'start' : 'end', value ? 1 : 0, true)
        const held = { forward: false, backward: false, left: false, right: false, jump: false }
        const set = (name, on) => { if(held[name] !== on) { held[name] = on; A(name, on) } }
        const clearMove = () => { set('forward', false); set('backward', false); set('left', false); set('right', false) }

        const steerToward = (tx, tz, deadzone = 0.25) =>
        {
            const t = body.translation()
            const dx = tx - t.x
            const dz = tz - t.z
            const len = Math.hypot(dx, dz)
            if(len <= deadzone)
            {
                clearMove()
                return len
            }
            const th = g.view.spherical.theta
            const f = (dx * -Math.sin(th) + dz * -Math.cos(th)) / len
            const r = (dx * Math.cos(th) + dz * -Math.sin(th)) / len
            set('forward', f > 0.35)
            set('backward', f < -0.35)
            set('right', r > 0.35)
            set('left', r < -0.35)
            return len
        }

        const ref1994 = g.world.references?.get('refMilestone1994')?.position || { x: 0, y: 0, z: -3.2 }
        const lineSample = g.world.line?.sampleAt?.(2.0)?.point || { x: 4.5, y: 0.2, z: -5.6 }
        const setPieces = g.world.origensEra?.setPieces

        let phase = 'to1994'
        let phaseTicks = 0
        let jumpTicks = 0
        let dialogTicks = 0

        const unsub = g.ticker.events.on('fixedTick', () =>
        {
            phaseTicks++
            const t = body.translation()

            if(document.querySelector('dialog[open]'))
            {
                dialogTicks++
                if(dialogTicks >= 75)
                {
                    g.ui?.closeCard?.(true)
                    dialogTicks = 0
                }
            }
            else
            {
                dialogTicks = 0
            }

            if(phase === 'to1994')
            {
                const dist = steerToward(ref1994.x, ref1994.z, 0.3)
                if(setPieces?.housePopped)
                {
                    clearMove()
                    phase = 'houseWait'
                    phaseTicks = 0
                }
                else if(dist <= 2.3 && phaseTicks > 180)
                {
                    A('interact', true)
                    A('interact', false)
                }
                else if(phaseTicks > 480)
                {
                    // Fallback if obstructed
                    setPieces?.trigger1994?.()
                    clearMove()
                    phase = 'houseWait'
                    phaseTicks = 0
                }
            }
            else if(phase === 'houseWait')
            {
                clearMove()
                if(phaseTicks >= 260 && !document.querySelector('dialog[open]'))
                {
                    phase = 'toLine'
                    phaseTicks = 0
                }
            }
            else if(phase === 'toLine')
            {
                const dist = steerToward(lineSample.x, lineSample.z, 0.4)
                if(c.grind?.active)
                {
                    clearMove()
                    set('jump', false)
                    phase = 'grinding'
                    phaseTicks = 0
                }
                else if(dist < 2.8 && c.grounded && jumpTicks === 0)
                {
                    // Jump toward the Line and hold jump slightly to glide onto it
                    set('jump', true)
                    jumpTicks = 1
                }
                else if(jumpTicks > 0)
                {
                    jumpTicks++
                    if(jumpTicks > 55)
                    {
                        set('jump', false)
                        jumpTicks = 0
                    }
                }
                else if(phaseTicks > 480 && !c.grind?.active)
                {
                    // Align directly above Line start for guaranteed grind showcase
                    const s0 = g.world.line?.sampleAt?.(1.0)
                    if(s0)
                    {
                        const yaw = Math.atan2(-s0.tangent.x, -s0.tangent.z)
                        c.teleport(s0.point.x, s0.point.y + 0.9, s0.point.z, yaw)
                    }
                    phase = 'grinding'
                    phaseTicks = 0
                }
            }
            else if(phase === 'grinding')
            {
                clearMove()
                set('jump', false)
                if(!c.grind?.active && phaseTicks > 60 && c.grounded)
                {
                    // Continue running forward + celebratory jump after dismount
                    set('forward', true)
                    if(phaseTicks % 180 === 0)
                        set('jump', true)
                    else if(phaseTicks % 180 === 25)
                        set('jump', false)
                }
            }
        })

        window.__t231Cleanup = () =>
        {
            clearMove()
            set('jump', false)
            if(typeof unsub === 'function') unsub()
        }
    })

    mark('pilotStarted')
    while(remaining() > 300)
        await sleep(250)

    await page.evaluate(() => window.__t231Cleanup?.()).catch(() => {})
    mark('pilotEnded')
}

function moveToTrash(srcPath, destPath)
{
    if(!existsSync(srcPath)) return
    mkdirSync(dirname(destPath), { recursive: true })
    const target = existsSync(destPath) ? `${destPath}-${Date.now()}` : destPath
    try { renameSync(srcPath, target) }
    catch { cpSync(srcPath, target, { recursive: true }) }
}

function probeVideo(mp4Path)
{
    const res = spawnSync(FFPROBE, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames:format=duration,size',
        '-of', 'json',
        mp4Path,
    ], { encoding: 'utf8' })
    if(res.status !== 0)
        throw new Error(`ffprobe failed for ${mp4Path}: ${res.stderr}`)
    const data = JSON.parse(res.stdout)
    const stream = data.streams?.[0] ?? {}
    const format = data.format ?? {}
    const parseRate = (rate) =>
    {
        if(!rate || !rate.includes('/')) return Number(rate) || 0
        const [n, d] = rate.split('/').map(Number)
        return d ? +(n / d).toFixed(2) : 0
    }
    return {
        codec: stream.codec_name ?? null,
        width: stream.width ?? null,
        height: stream.height ?? null,
        rFps: parseRate(stream.r_frame_rate),
        avgFps: parseRate(stream.avg_frame_rate),
        nbFrames: Number(stream.nb_frames) || null,
        durationSec: format.duration ? +Number(format.duration).toFixed(2) : null,
        sizeBytes: format.size ? Number(format.size) : null,
    }
}

async function waitForServer(url, timeoutMs = 15000)
{
    const deadline = Date.now() + timeoutMs
    while(Date.now() < deadline)
    {
        try
        {
            const res = await fetch(url)
            if(res.ok) return
        }
        catch {}
        await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`Preview server did not respond at ${url} within ${timeoutMs} ms`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if(isMain)
{
    const args = process.argv.slice(2)
    const opt = (flag, fallback) =>
    {
        const idx = args.indexOf(flag)
        return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
    }
    const skipBuild = args.includes('--skip-build')
    const keepDist = args.includes('--keep-dist')
    const dist = opt('--dist', 'dist-debug-t231')
    const port = Number(opt('--port', '4220'))
    const outRoot = resolve(opt('--out', 'tools/capture/runs/g2'))
    const seconds = Number(opt('--seconds', '15'))
    const captureMode = opt('--capture', 'cdp')
    const encoder = opt('--encoder', 'libx264')
    const base = `http://127.0.0.1:${port}/`
    const viteBin = resolve('node_modules/vite/bin/vite.js')
    const distAbs = resolve(dist)
    const trashRoot = 'D:/GitHub/pode_apagar/timeline/t231'
    const scriptSelf = resolve('tools/capture/t231-record-g2.mjs')

    if(!skipBuild)
    {
        if(existsSync(distAbs))
            moveToTrash(distAbs, join(trashRoot, `prev-${dist}`))
        console.log(`[t231] Building debug bundle into ${dist}...`)
        const buildEnv = { ...process.env, BUILD_ID: 't231g2' }
        execFileSync(process.execPath, [ viteBin, 'build', '--mode', 'debug', '--outDir', `../${dist}` ], { stdio: 'inherit', env: buildEnv })
        execFileSync(process.execPath, [ resolve('scripts/hash-assets.mjs'), '--static', 'static', '--out', dist ], { stdio: 'inherit', env: buildEnv })
    }

    if(!existsSync(resolve(dist, 'index.html')))
    {
        console.error(`[t231] Missing build directory: ${distAbs}`)
        process.exit(2)
    }

    const CASES = [
        {
            name: 'origens-desktop-webgpu',
            profile: 'desktop',
            seconds,
            url: `${base}?expose`,
        },
        {
            name: 'origens-desktop-webgl',
            profile: 'desktop',
            seconds,
            url: `${base}?expose&webgl`,
        },
        {
            name: 'origens-mobile-portrait',
            profile: 'mobile',
            seconds,
            url: `${base}?expose&q=1&webgl`,
        },
        {
            name: 'origens-mobile-landscape',
            profile: 'desktop',
            seconds,
            url: `${base}?expose&q=1&webgl`,
        },
    ]

    const server = spawn(
        process.execPath,
        [ viteBin, 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    console.log(`[t231] started vite preview (pid=${server.pid}) serving ${dist} on ${base}`)

    const stopServer = async () =>
    {
        if(server.exitCode !== null || server.killed) return
        const closed = new Promise((r) => server.once('close', r))
        try { server.kill('SIGTERM') } catch {}
        await Promise.race([ closed, new Promise((r) => setTimeout(r, 2000)) ])
        if(server.exitCode === null)
        {
            try { server.kill('SIGKILL') } catch {}
        }
        console.log(`[t231] stopped vite preview (pid=${server.pid}, exitCode=${server.exitCode})`)
    }

    process.on('SIGINT', async () => { await stopServer(); process.exit(130) })
    process.on('SIGTERM', async () => { await stopServer(); process.exit(143) })

    const summary = []
    let failed = false

    try
    {
        await waitForServer(base)
        console.log(`[t231] server ready at ${base}`)

        for(const item of CASES)
        {
            console.log(`\n[t231] recording ${item.name} (${item.profile}, ${item.seconds}s, ${captureMode}/${encoder}) -> ${item.url}`)
            const rec = spawnSync(
                process.execPath,
                [
                    resolve('tools/capture/record.mjs'),
                    '--profile', item.profile,
                    '--seconds', String(item.seconds),
                    '--name', item.name,
                    '--out', outRoot,
                    '--capture', captureMode,
                    '--encoder', encoder,
                    '--script', scriptSelf,
                    '--url', item.url,
                ],
                { stdio: 'inherit' },
            )
            if(rec.status !== 0)
                throw new Error(`record.mjs failed for ${item.name} with exit code ${rec.status}`)
        }
    }
    catch(err)
    {
        failed = true
        console.error('[t231] error:', err)
    }
    finally
    {
        await stopServer()
        if(!keepDist && existsSync(distAbs))
        {
            moveToTrash(distAbs, join(trashRoot, dist))
            console.log(`[t231] moved ${dist} -> ${join(trashRoot, dist)}`)
        }
    }

    if(failed) process.exit(1)

    for(const item of CASES)
    {
        const dir = join(outRoot, item.name)
        const mp4Path = join(dir, 'video.mp4')
        const metricsPath = join(dir, 'metrics.json')
        const sheetPath = join(dir, 'sheet.png')

        const hasMp4 = existsSync(mp4Path) && statSync(mp4Path).size > 0
        const hasMetrics = existsSync(metricsPath) && statSync(metricsPath).size > 0
        const hasSheet = existsSync(sheetPath) && statSync(sheetPath).size > 0
        const probe = hasMp4 ? probeVideo(mp4Path) : null
        const metrics = hasMetrics ? JSON.parse(readFileSync(metricsPath, 'utf8')) : null

        summary.push({
            name: item.name,
            profile: item.profile,
            captureMode: metrics?.captureMode ?? captureMode,
            encoder: metrics?.encoder ?? encoder,
            filesOk: hasMp4 && hasMetrics && hasSheet,
            probe,
            avgFps: metrics?.avgFps ?? null,
            frameTimeMs: metrics?.frameTimeMs ?? null,
            drawCalls: metrics?.drawCalls ?? null,
            transferMb: metrics?.transfer?.mb ?? null,
            sheetPath,
        })
    }

    console.log('\n[t231] verification summary:')
    console.log(JSON.stringify(summary, null, 2))

    const allValid = summary.every((s) => s.filesOk && s.probe && Math.round(s.probe.avgFps) === 60 && s.probe.nbFrames > 0 && s.probe.durationSec > 0)
    if(!allValid)
    {
        console.error('[t231] validation failed: one or more captures missing files, 0 frames, or not 60 fps')
        process.exit(1)
    }
}
