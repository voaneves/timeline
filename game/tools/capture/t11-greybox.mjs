// T1.1 check: loads the greybox in a debug build (headed Chrome), reads the world through page evaluation and takes
// screenshots with the physics wireframe on, from refCamera1 / refCamera2.
// Usage: node tools/capture/t11-greybox.mjs [--backend webgl|webgpu] [--port 4181]   (needs dist-debug/ + asset manifest)
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const backend = arg('--backend', 'webgl')
const port = Number(arg('--port', '4181'))
const base = `http://127.0.0.1:${port}/`
const out = resolve('tools/capture/out')
mkdirSync(out, { recursive: true })

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync)
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--outDir', '../dist-debug', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
process.on('exit', () => { try { server.kill() } catch {} })
for(let i = 0; i < 60; i++) { try { if((await fetch(base)).ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }

const browser = await chromium.launch({ headless: false, executablePath: chrome, ignoreDefaultArgs: ['--enable-automation'], args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if(m.type() === 'error') errors.push(m.text()) })
page.on('response', (r) => { if(r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`) })

await page.goto(`${base}?expose&debug=physics${backend === 'webgl' ? '&webgl' : ''}`)
await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
await page.waitForTimeout(1500)

const read = () => page.evaluate(() => {
    const game = window.game
    const counts = {}
    const shapeNames = Object.fromEntries(Object.entries(game.RAPIER.ShapeType).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k]))
    for(const physical of game.physics.physicals)
        for(const collider of physical.colliders)
        {
            const name = shapeNames[collider.shapeType()] ?? 'other'
            counts[name] = (counts[name] ?? 0) + 1
        }
    const wire = game.physics.world.debugRender()
    const types = {}
    for(const physical of game.physics.physicals)
        types[physical.type] = (types[physical.type] ?? 0) + 1
    const platform = game.world.movingPlatform?.object.physical.body.translation()
    return {
        backend: game.rendering.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2',
        objects: game.objects.list.size,
        bodies: game.physics.physicals.length,
        bodyTypes: types,
        colliders: counts,
        colliderTotal: game.physics.physicals.reduce((s, p) => s + p.colliders.length, 0),
        wireframeActive: game.wireframe.active,
        wireframeSegments: wire.vertices.length / 6,
        refs: [...game.world.references.keys()],
        respawn: game.respawns.getDefault(),
        platform: platform && { x: platform.x, y: platform.y, z: platform.z },
        crateY: game.physics.physicals.filter((p) => p.type === 'dynamic').map((p) => +p.body.translation().y.toFixed(3)),
        drawables: (() => { let n = 0; game.scene.traverse((o) => { if(o.isMesh && o.visible) n++ }); return n })(),
    }
})

const first = await read()
await page.waitForTimeout(2500)
const second = await read()

// Free camera at refCamera1 / refCamera2 (look-at from the glb extras)
async function shot(name, ref)
{
    await page.evaluate((ref) =>
    {
        const game = window.game
        const r = game.world.references.get(ref)
        game.view.setMode(game.view.constructor.MODE_FREE)
        game.view.freeMode.setLookAt(r.position.x, r.position.y, r.position.z, ...r.userData.lookAt, false)
    }, ref)
    await page.waitForTimeout(800)
    await page.screenshot({ path: resolve(out, name) })
}
await shot('t11-greybox.png', 'refCamera1')
await shot('t11-greybox-cam2.png', 'refCamera2')
// Colliders only: visuals hidden (the Rapier wireframe is a LineSegments, kept), wide overview of the first 30 m
await page.evaluate(() =>
{
    const game = window.game
    game.scene.traverse((o) => { if(o.isMesh) o.visible = false })
    game.view.freeMode.setLookAt(13, 14, 12, 0, 0, -20, false)
})
await page.waitForTimeout(800)
await page.screenshot({ path: resolve(out, 't11-greybox-wireframe.png') })
await page.evaluate(() => window.game.physicsSmoke)
const smoke = await page.evaluate(() => window.__physicsSmoke ?? null)

const result = { first, second, platformMoved: JSON.stringify(first.platform) !== JSON.stringify(second.platform), smokePass: smoke?.pass ?? smoke?.passed ?? null, errors }
writeFileSync(resolve(out, `t11-greybox-${backend}.json`), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
await browser.close()
server.kill()
