// T2.19a + T2.19b + T2.19c verification:
//   1. Builds debug bundle into `dist-debug-t219` with `BUILD_ID=t219setp`.
//   2. Starts `vite preview` on port 4219 (killed by PID on exit).
//   3. Verifies `?era=origens&expose`:
//      - 0 console/page errors
//      - `window.__setPieces` exposes `{ housePopped, crtLit, capeloAttached, trigger1994, trigger2005, trigger2011, skip }`
//      - T2.19a (1994): trigger1994 -> housePopped === true, card e-1994-09 opens
//      - T2.19b (2005): trigger2005 -> crtLit === true, card e-2005-01 opens
//      - T2.19c (2011): trigger2011 -> capeloAttached === true, card e-2011-12 opens
//      - HUD progress reaches `Origens · 3/3`
//   4. Writes `tools/capture/out/t219-setpieces.json` + screenshots, and moves
//      `dist-debug-t219` to `D:\GitHub\pode_apagar\timeline\t219\dist-debug-t219`.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const dist = arg('--dist', 'dist-debug-t219')
const port = Number(arg('--port', '4219'))
const skipBuild = args.includes('--skip-build')
const keepDist = args.includes('--keep-dist')
const base = `http://127.0.0.1:${port}/`
const BUILD_ID = 't219setp'

const outDir = resolve('tools/capture/out')
const outJson = resolve(outDir, 't219-setpieces.json')
mkdirSync(outDir, { recursive: true })

const chromePath = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean).find((p) => existsSync(p))

if(!chromePath)
{
    console.error('Chrome executable not found (set CHROME_PATH)')
    process.exit(2)
}

function moveToTrash(srcPath, destPath)
{
    if(!existsSync(srcPath))
        return
    mkdirSync(dirname(destPath), { recursive: true })
    const target = existsSync(destPath) ? `${destPath}-${Date.now()}` : destPath
    try
    {
        renameSync(srcPath, target)
    }
    catch
    {
        cpSync(srcPath, target, { recursive: true })
    }
}

const viteBin = resolve('node_modules/vite/bin/vite.js')
const distAbs = resolve(dist)
const trashRoot = 'D:/GitHub/pode_apagar/timeline/t219'

if(!skipBuild)
{
    if(existsSync(distAbs))
        moveToTrash(distAbs, join(trashRoot, `prev-${dist}`))

    console.log(`[t219] Building debug bundle into ${dist} (BUILD_ID=${BUILD_ID})...`)
    const buildEnv = { ...process.env, BUILD_ID }
    execFileSync(
        process.execPath,
        [ viteBin, 'build', '--mode', 'debug', '--outDir', `../${dist}` ],
        { stdio: 'inherit', env: buildEnv }
    )
    execFileSync(
        process.execPath,
        [ resolve('scripts/hash-assets.mjs'), '--static', 'static', '--out', dist ],
        { stdio: 'inherit', env: buildEnv }
    )
}

if(!existsSync(resolve(dist, 'index.html')))
{
    console.error(`Missing build directory: ${resolve(dist)}`)
    process.exit(2)
}

const server = spawn(
    process.execPath,
    [ viteBin, 'preview', '--outDir', `../${dist}`, '--port', String(port), '--strictPort', '--host', '127.0.0.1' ],
    { stdio: 'ignore' }
)

const stopServer = () =>
{
    if(server.pid)
    {
        try
        {
            if(process.platform === 'win32')
                execFileSync('taskkill', [ '/PID', String(server.pid), '/T', '/F' ], { stdio: 'ignore' })
            else
                server.kill('SIGTERM')
        }
        catch {}
    }
}

let browser = null
try
{
    let serverReady = false
    const deadline = Date.now() + 15000
    while(Date.now() < deadline)
    {
        try
        {
            const r = await fetch(base)
            if(r.ok)
            {
                serverReady = true
                break
            }
        }
        catch {}
        await new Promise((r) => setTimeout(r, 200))
    }
    if(!serverReady)
        throw new Error(`Preview server did not start on ${base}`)

    browser = await chromium.launch({
        executablePath: chromePath,
        headless: true,
        args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
        ],
    })

    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (msg) =>
    {
        if(msg.type() === 'error')
            errors.push(`console.error: ${msg.text()}`)
    })

    await page.goto(`${base}?era=origens&expose`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(window.game?.ready && window.__setPieces), { timeout: 25000 })
    await page.waitForTimeout(400)

    // T2.19a: 1994 Casa Pop-up + Ipe
    await page.evaluate(() => window.__setPieces.trigger1994())
    await page.waitForTimeout(500)
    await page.screenshot({ path: resolve(outDir, 't219-1994-anim.png') })
    await page.evaluate(() => window.__setPieces.skip())
    await page.waitForFunction(() => Boolean(document.querySelector('.js-card-dialog')?.open), { timeout: 5000 })
    const card1994 = await page.evaluate(() => ({
        housePopped: window.__setPieces.housePopped,
        title: document.querySelector('.js-card-dialog .vn-card-title')?.textContent || null,
    }))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // T2.19b: 2005 CRT Ponto Interativo
    await page.evaluate(() => window.__setPieces.trigger2005())
    await page.waitForFunction(() => Boolean(document.querySelector('.js-card-dialog')?.open), { timeout: 8000 })
    await page.screenshot({ path: resolve(outDir, 't219-2005-crt.png') })
    const card2005 = await page.evaluate(() => ({
        crtLit: window.__setPieces.crtLit,
        title: document.querySelector('.js-card-dialog .vn-card-title')?.textContent || null,
    }))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // T2.19c: 2011 Capelo on head bone
    await page.evaluate(() => window.__setPieces.trigger2011())
    await page.waitForTimeout(450)
    await page.evaluate(() => window.__setPieces.skip())
    await page.waitForFunction(() => Boolean(document.querySelector('.js-card-dialog')?.open), { timeout: 5000 })
    await page.screenshot({ path: resolve(outDir, 't219-2011-capelo.png') })
    const card2011 = await page.evaluate(() => ({
        capeloAttached: window.__setPieces.capeloAttached,
        title: document.querySelector('.js-card-dialog .vn-card-title')?.textContent || null,
        hudEra: document.querySelector('.js-hud-era')?.textContent || null,
    }))
    await page.keyboard.press('Escape')

    const report = {
        errors,
        card1994,
        card2005,
        card2011,
        passed:
            errors.length === 0
            && card1994.housePopped === true
            && card2005.crtLit === true
            && card2011.capeloAttached === true
            && String(card2011.hudEra || '').includes('3/3'),
    }

    writeFileSync(outJson, JSON.stringify(report, null, 2))
    console.log('[t219] Report:', JSON.stringify(report, null, 2))

    if(!report.passed)
        process.exitCode = 1
}
finally
{
    if(browser)
        await browser.close().catch(() => {})
    stopServer()
    if(!keepDist && existsSync(distAbs))
        moveToTrash(distAbs, join(trashRoot, dist))
}
