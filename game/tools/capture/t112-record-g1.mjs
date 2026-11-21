// T1.12 G1 comparison capture runner: starts a single vite preview server for dist-debug-t112,
// records 4 videos sequentially via record.mjs (on-foot vs vehicle x desktop vs portrait),
// kills only the preview server PID on exit, and verifies outputs via ffprobe.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FFPROBE } from './sheet.mjs'

const args = process.argv.slice(2)
const opt = (flag, fallback) => {
    const idx = args.indexOf(flag)
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback
}

const dist = opt('--dist', 'dist-debug-t112')
const port = Number(opt('--port', '4199'))
const outRoot = resolve(opt('--out', 'tools/capture/runs/g1'))
const seconds = Number(opt('--seconds', '15'))
const captureMode = opt('--capture', 'ddagrab')
const encoder = opt('--encoder', 'h264_amf')
const base = `http://127.0.0.1:${port}/`

const CASES = [
    {
        name: 'foot-desktop',
        profile: 'desktop',
        seconds,
        url: `${base}?expose&ghost=greybox-keyboard`,
    },
    {
        name: 'foot-portrait',
        profile: 'mobile',
        seconds,
        url: `${base}?expose&q=1&webgl&ghost=greybox-keyboard`,
    },
    {
        name: 'vehicle-desktop',
        profile: 'desktop',
        seconds,
        url: `${base}?expose&loco=vehicle&ghost=vehicle`,
    },
    {
        name: 'vehicle-portrait',
        profile: 'mobile',
        seconds,
        url: `${base}?expose&q=1&webgl&loco=vehicle&ghost=vehicle`,
    },
]

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
    const parseRate = (rate) => {
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

const server = spawn(
    process.execPath,
    [resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
)
console.log(`[t112] started vite preview (pid=${server.pid}) serving ${dist} on ${base}`)

const stopServer = async () => {
    if(server.exitCode !== null || server.killed) return
    const closed = new Promise((r) => server.once('close', r))
    try { server.kill('SIGTERM') } catch {}
    await Promise.race([closed, new Promise((r) => setTimeout(r, 2000))])
    if(server.exitCode === null)
    {
        try { server.kill('SIGKILL') } catch {}
    }
    console.log(`[t112] stopped vite preview (pid=${server.pid}, exitCode=${server.exitCode})`)
}

process.on('SIGINT', async () => { await stopServer(); process.exit(130) })
process.on('SIGTERM', async () => { await stopServer(); process.exit(143) })

const summary = []
let failed = false

try
{
    await waitForServer(base)
    console.log(`[t112] server ready at ${base}`)

    for(const item of CASES)
    {
        console.log(`\n[t112] recording ${item.name} (${item.profile}, ${item.seconds}s, ${captureMode}/${encoder}) -> ${item.url}`)
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
    console.error('[t112] error:', err)
}
finally
{
    await stopServer()
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

console.log('\n[t112] verification summary:')
console.log(JSON.stringify(summary, null, 2))

const allValid = summary.every((s) => s.filesOk && s.probe && Math.round(s.probe.avgFps) === 60 && s.probe.durationSec > 0)
if(!allValid)
{
    console.error('[t112] validation failed: one or more captures missing files or not 60 fps')
    process.exit(1)
}
