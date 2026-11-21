// T4.1 & T4.2 verification: Local Achievements + Cordel Teleport Map.
// Usage:
//   node tools/capture/t41-map-achievements.mjs [--dist dist-debug-t41] [--port 4223] [--skip-build]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t41')
const port = Number(arg('--port', '4223'))
const skipBuild = args.includes('--skip-build')
const base = `http://127.0.0.1:${port}/`

const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync)

if(!chrome)
    throw new Error('Chrome executable not found')

const viteBin = resolve('node_modules/vite/bin/vite.js')
if(!skipBuild)
{
    console.log(`building ${dist}...`)
    execFileSync(process.execPath, [ viteBin, 'build', '--mode', 'debug', '--outDir', `../${dist}` ], { stdio: 'inherit' })
    execFileSync(process.execPath, [ resolve('scripts/hash-assets.mjs'), '--out', dist, '--include-test' ], { stdio: 'inherit' })
}

const server = spawn(
    process.execPath,
    [ viteBin, 'preview', '--outDir', `../${dist}`, '--host', '127.0.0.1', '--port', String(port), '--strictPort' ],
    { stdio: 'ignore' }
)
const killServer = () => { try { server.kill() } catch {} }
process.on('exit', killServer)

let serverReady = false
for(let i = 0; i < 60; i++)
{
    try
    {
        if((await fetch(base)).ok)
        {
            serverReady = true
            break
        }
    }
    catch {}
    await new Promise((r) => setTimeout(r, 250))
}
if(!serverReady)
{
    killServer()
    throw new Error(`vite preview did not start on ${base}`)
}

const browser = await chromium.launch({
    headless: false,
    executablePath: chrome,
    ignoreDefaultArgs: [ '--enable-automation' ],
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist', '--mute-audio' ],
})

let allPassed = true
const check = (label, ok, detail = '') =>
{
    if(!ok) allPassed = false
    console.log(`${label}: ${ok ? 'PASS' : 'FAIL'}${detail ? ` (${detail})` : ''}`)
}

const errors = []
try
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', (e) => errors.push(`pageerror: ${e}`))
    page.on('console', (m) => { if(m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
    page.on('response', (r) => { if(r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`) })

    await page.goto(`${base}?expose&webgl`)
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    await page.waitForFunction(() => window.__reveal?.completedAtMs !== null, null, { timeout: 5000 })

    // Clear any prior localStorage state for deterministic run
    await page.evaluate(() =>
    {
        localStorage.removeItem('vn-timeline-achievements')
        window.game.achievements.reset()
    })

    // 1. T4.1: 8 achievements defined & unlocking + toast + announcer + localStorage
    const defCount = await page.evaluate(() => window.game.achievements.getAll().length)
    check('achievements.defined_8', defCount === 8, `count=${defCount}`)

    await page.evaluate(() =>
    {
        window.game.achievements.unlock('first_step')
        window.game.ui.openProject('p-1')
        window.game.ui.closeCard(false)
    })

    const toastVisible = await page.locator('.js-achievement-toast.is-visible').isVisible()
    const announcerMsg = await page.evaluate(() => window.game.ui.announcer.lastMessage)
    const storedRaw = await page.evaluate(() => localStorage.getItem('vn-timeline-achievements'))
    const stored = storedRaw ? JSON.parse(storedRaw) : null
    check('achievements.toast_visible', toastVisible)
    check('achievements.announcer_notified', typeof announcerMsg === 'string' && announcerMsg.length > 0, announcerMsg)
    check('achievements.localStorage_persisted', Boolean(stored?.unlocked?.first_step && stored?.unlocked?.cartridge_explorer))

    // Menu achievements section
    await page.evaluate(() => window.game.ui.openMenu())
    const menuAchCount = await page.locator('.js-achievements-list .vn-achievement-item').count()
    const menuUnlockedCount = await page.locator('.js-achievements-list .vn-achievement-item.is-unlocked').count()
    const menuCounterText = await page.locator('.js-achievements-count').textContent()
    check('achievements.menu_section', menuAchCount === 8 && menuUnlockedCount >= 2, `${menuCounterText} (${menuUnlockedCount}/${menuAchCount})`)
    await page.keyboard.press('Escape')

    // Reload persistence check
    await page.reload()
    await page.waitForFunction(() => window.game?.ready === true, null, { timeout: 60000 })
    await page.waitForFunction(() => window.__reveal?.completedAtMs !== null, null, { timeout: 5000 })
    const persistedAfterReload = await page.evaluate(() =>
        window.game.achievements.isUnlocked('first_step') && window.game.achievements.isUnlocked('cartridge_explorer')
    )
    check('achievements.persisted_after_reload', persistedAfterReload)

    // 2. T4.2: Cordel Teleport Map
    const hudMapBox = await page.locator('.js-hud-map').boundingBox()
    check('map.hud_button_44px', Boolean(hudMapBox && hudMapBox.width >= 44 && hudMapBox.height >= 44),
        hudMapBox ? `${Math.round(hudMapBox.width)}x${Math.round(hudMapBox.height)}` : 'missing')

    // Open via M key
    await page.keyboard.press('KeyM')
    const mapOpenByKey = await page.evaluate(() => document.querySelector('.js-map-dialog')?.open === true)
    const svgPresent = await page.locator('.js-map-dialog .vn-map-svg').isVisible()
    const zoneCount = await page.locator('.js-map-zone').count()
    const zoneBoxesOk = await page.evaluate(() =>
    {
        const btns = Array.from(document.querySelectorAll('.js-map-zone'))
        return btns.length === 7 && btns.every((b) =>
        {
            const r = b.getBoundingClientRect()
            return r.width >= 44 && r.height >= 44
        })
    })
    check('map.open_by_M_key', mapOpenByKey && svgPresent && zoneCount === 7, `zones=${zoneCount}`)
    check('map.zone_buttons_44px', zoneBoxesOk)

    // Esc closes map and returns focus cleanly to canvas
    await page.keyboard.press('Escape')
    const closedAndFocused = await page.evaluate(() =>
    {
        const dlg = document.querySelector('.js-map-dialog')
        const canvas = document.querySelector('.js-canvas')
        return !dlg?.open && document.activeElement === canvas
    })
    check('map.esc_returns_focus', closedAndFocused)

    // Keyboard Tab + Arrow + Enter teleport
    await page.evaluate(() =>
    {
        window.__teleportEvents = []
        window.addEventListener('timeline:teleportEra', (e) => window.__teleportEvents.push(e.detail))
    })
    await page.keyboard.press('KeyM')
    // Tab past close button to first zone button, then ArrowRight through zones and Enter
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const activeBeforeEnter = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        cls: document.activeElement?.className,
        zone: document.activeElement?.dataset?.zoneId || null,
        open: document.querySelector('.js-map-dialog')?.open,
    }))
    console.log('activeBeforeEnter:', JSON.stringify(activeBeforeEnter))
    await page.keyboard.press('Enter')

    const kbTeleport = await page.evaluate(() => ({
        open: document.querySelector('.js-map-dialog')?.open,
        events: window.__teleportEvents,
    }))
    check('map.keyboard_tab_arrow_enter_teleport',
        !kbTeleport.open && kbTeleport.events.length === 1 && Boolean(kbTeleport.events[0]?.eraId),
        JSON.stringify(kbTeleport.events[0] || null))

    // Single-pointer click open & zone teleport
    await page.locator('.js-hud-map').click()
    const openByClick = await page.evaluate(() => document.querySelector('.js-map-dialog')?.open === true)
    await page.locator('.js-map-zone[data-zone-id="dados"]').click()
    const ptrTeleport = await page.evaluate(() => ({
        open: document.querySelector('.js-map-dialog')?.open,
        events: window.__teleportEvents,
    }))
    check('map.single_pointer_teleport',
        openByClick && !ptrTeleport.open && ptrTeleport.events.length === 2 && ptrTeleport.events[1]?.id === 'dados',
        JSON.stringify(ptrTeleport.events[1] || null))

    check('console.zero_errors', errors.length === 0, errors.join('; '))
}
finally
{
    await browser.close()
    killServer()
}

if(!allPassed)
    process.exit(1)
