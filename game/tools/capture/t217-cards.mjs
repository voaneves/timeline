// T2.17 + T2.26 verification: Accessible <dialog> milestone/contact cards, focus management,
// HUD touch targets (>= 44x44) at 1280x720 and 390x844, Lista de marcos, and Menu options.
// Usage:
//   node tools/capture/t217-cards.mjs [--dist dist-debug-t217] [--port 4207] [--skip-build]
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
const dist = arg('--dist', 'dist-debug-t217')
const port = Number(arg('--port', '4207'))
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

const content = JSON.parse(readFileSync(resolve('sources/data/content.json'), 'utf8'))
const origens = content.eras[0].entries

const browser = await chromium.launch({
    headless: false,
    executablePath: chrome,
    ignoreDefaultArgs: [ '--enable-automation' ],
    args: [ '--use-angle=d3d11', '--ignore-gpu-blocklist' ],
})

const assert = (cond, msg) =>
{
    if(!cond)
        throw new Error(`ASSERTION FAILED: ${msg}`)
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

    // 1. Test all 3 Origens milestone cards (1994, 2005, 2011)
    for(const entry of origens)
    {
        const opened = await page.evaluate((id) => window.game.ui.openMilestone(id), entry.id)
        assert(opened === true, `openMilestone(${entry.id}) returned true`)

        const cardState = await page.evaluate(() =>
        {
            const d = document.querySelector('.js-card-dialog')
            const h2 = d?.querySelector('h2')
            const time = d?.querySelector('time')
            return {
                open: Boolean(d?.open),
                h2Text: h2?.textContent?.trim(),
                datetime: time?.getAttribute('datetime'),
                activeIsH2: document.activeElement === h2,
            }
        })

        assert(cardState.open, `dialog open for ${entry.id}`)
        assert(cardState.datetime === entry.datetime, `datetime mismatch for ${entry.id}: ${cardState.datetime}`)
        assert(cardState.h2Text === entry.title, `h2 mismatch for ${entry.id}: ${cardState.h2Text}`)
        assert(cardState.activeIsH2, `activeElement is h2 for ${entry.id}`)

        // Keyboard input blocked while dialog[open]
        await page.keyboard.down('KeyW')
        const pressedCount = await page.evaluate(() => window.game.inputs.keyboard.pressed.length)
        await page.keyboard.up('KeyW')
        assert(pressedCount === 0, `keyboard blocked while dialog[open] for ${entry.id}`)

        // Escape closes card and restores focus to .js-canvas
        await page.keyboard.press('Escape')
        const afterEsc = await page.evaluate(() => ({
            open: Boolean(document.querySelector('.js-card-dialog')?.open),
            activeIsCanvas: document.activeElement === document.querySelector('.js-canvas'),
        }))
        assert(!afterEsc.open, `Escape closed card for ${entry.id}`)
        assert(afterEsc.activeIsCanvas, `focus returned to .js-canvas after Escape for ${entry.id}`)
    }

    // 2. Test Contact card + pointer close (must not show keyboard focus ring on canvas)
    await page.evaluate(() => window.game.ui.openContact())
    const contactState = await page.evaluate(() =>
    {
        const d = document.querySelector('.js-card-dialog')
        const h2 = d?.querySelector('h2')
        return {
            open: Boolean(d?.open),
            h2Text: h2?.textContent?.trim(),
            activeIsH2: document.activeElement === h2,
            linkCount: d?.querySelectorAll('.vn-card-link').length || 0,
        }
    })
    assert(contactState.open, 'contact dialog opened')
    assert(contactState.h2Text === content.contact.title, `contact h2 mismatch: ${contactState.h2Text}`)
    assert(contactState.activeIsH2, 'activeElement is h2 on contact card')
    assert(contactState.linkCount === content.contact.links.length, 'contact links rendered')

    await page.locator('.js-card-close').click()
    const afterPointerClose = await page.evaluate(() =>
    {
        const canvas = document.querySelector('.js-canvas')
        return {
            open: Boolean(document.querySelector('.js-card-dialog')?.open),
            activeIsCanvas: document.activeElement === canvas,
            hasKeyboardRing: canvas?.classList.contains('is-keyboard-focus'),
        }
    })
    assert(!afterPointerClose.open, 'pointer close closed contact card')
    assert(afterPointerClose.activeIsCanvas, 'pointer close restored focus to .js-canvas')
    assert(!afterPointerClose.hasKeyboardRing, 'pointer close did NOT add is-keyboard-focus')

    // 3. Test Lista de marcos + Menu
    await page.locator('.js-hud-list').click()
    const listCounts = await page.evaluate(() =>
    {
        const d = document.querySelector('.js-list-dialog')
        return {
            open: Boolean(d?.open),
            items: d?.querySelectorAll('.vn-list-item').length || 0,
            gotoBtns: d?.querySelectorAll('button[data-action="goto"]').length || 0,
            openBtns: d?.querySelectorAll('button[data-action="open"]').length || 0,
        }
    })
    assert(listCounts.open, 'Lista de marcos opened')
    assert(listCounts.items === 22, `expected 22 list items (15+6+1), got ${listCounts.items}`)
    assert(listCounts.gotoBtns === 22 && listCounts.openBtns === 22, 'each list item has Ir até and Abrir')
    await page.keyboard.press('Escape')

    await page.locator('.js-hud-menu').click()
    assert(await page.locator('.js-menu-dialog').evaluate((d) => d.open), 'Menu dialog opened')
    await page.locator('.js-opt-assist').click()
    await page.locator('.js-menu-quality').selectOption('1')
    const menuState = await page.evaluate(() => ({
        assist: window.game.ui.options.assistMode,
        qualityLevel: window.game.quality.level,
    }))
    assert(menuState.assist === true, 'assistMode toggled on')
    assert(menuState.qualityLevel === 1, 'quality changed to 1')
    await page.keyboard.press('Escape')

    // 4. Assert HUD button bounding boxes >= 44x44 in 1280x720 and 390x844
    for(const vp of [ { width: 1280, height: 720 }, { width: 390, height: 844 } ])
    {
        await page.setViewportSize(vp)
        const boxes = await page.evaluate(() =>
        {
            return [ ...document.querySelectorAll('.vn-hud-btn') ].map((el) =>
            {
                const r = el.getBoundingClientRect()
                return { text: el.textContent.trim(), width: r.width, height: r.height, right: r.right }
            })
        })
        for(const b of boxes)
        {
            assert(b.width >= 44 && b.height >= 44, `HUD btn "${b.text}" at ${vp.width}x${vp.height} too small: ${b.width}x${b.height}`)
            assert(b.right <= vp.width + 1, `HUD btn "${b.text}" overflows viewport ${vp.width}: right=${b.right}`)
        }
    }

    assert(errors.length === 0, `unexpected errors: ${errors.join(' | ')}`)
    console.log('t217-cards PASS: all Origens cards, Contact, Lista de marcos, Menu, focus management, and >=44px HUD targets verified with 0 errors.')
}
finally
{
    await browser.close()
    killServer()
}
