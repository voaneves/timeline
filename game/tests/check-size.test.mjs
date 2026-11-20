import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { measure, evaluate, integrity } from '../scripts/check-size.mjs'
import { hashAssets, sanitizeBuildId } from '../scripts/hash-assets.mjs'

const budgets = JSON.parse(readFileSync(new URL('../budgets.json', import.meta.url), 'utf8')).size

const html = `<!DOCTYPE html><html><head>
<script type="module" crossorigin src="./assets/index-AAAA.js"></script>
<link rel="modulepreload" crossorigin href="./assets/Game-BBBB.js">
<link rel="stylesheet" crossorigin href="./assets/index-CCCC.css">
</head><body></body></html>`

const makeDist = (_extra = {}, _html = html) =>
{
    const dir = mkdtempSync(join(tmpdir(), 'size-gate-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), _html)
    writeFileSync(join(dir, 'LICENSES.md'), 'licences')
    writeFileSync(join(dir, 'assets', 'index-AAAA.js'), 'export{}')
    writeFileSync(join(dir, 'assets', 'Game-BBBB.js'), 'export{}')
    writeFileSync(join(dir, 'assets', 'index-CCCC.css'), 'a{}')
    for(const [name, buf] of Object.entries(_extra)) writeFileSync(join(dir, name), buf)
    return dir
}

const run = (_dir, _budgets = budgets) =>
{
    const result = measure({ dist: _dir, budgets: _budgets })
    return { rows: evaluate(result, _budgets), problems: integrity(result), result }
}

test('clean dist passes', () =>
{
    const dir = makeDist()
    const { rows, problems } = run(dir)
    assert.deepEqual(problems, [])
    assert.equal(rows.filter((r) => r.status === 'FAIL').length, 0)
    rmSync(dir, { recursive: true })
})

test('an unclassified dist file fails the gate', () =>
{
    const dir = makeDist({ 'assets/Surprise-XXXX.js': 'export{}' })
    const { problems } = run(dir)
    assert.ok(problems.some((p) => p.includes('Surprise-XXXX.js')))
    rmSync(dir, { recursive: true })
})

test('an unclassified file listed in "ignore" is allowed', () =>
{
    const dir = makeDist({ 'robots.txt': 'x' })
    assert.ok(run(dir).problems.length > 0)
    assert.deepEqual(run(dir, { ...budgets, ignore: ['^robots\.txt$'] }).problems, [])
    rmSync(dir, { recursive: true })
})

test('+500 KB code in the game chunk fails the size budget', () =>
{
    const dir = makeDist({ 'assets/Game-BBBB.js': randomBytes(500 * 1024) })
    const { rows } = run(dir)
    const failed = rows.filter((r) => r.status === 'FAIL').map((r) => r.name)
    assert.ok(failed.includes('game'), failed.join())
    assert.ok(failed.includes('mainJs'), failed.join())
    rmSync(dir, { recursive: true })
})

test('+500 KB in a new, unregistered chunk fails the gate', () =>
{
    const dir = makeDist({ 'assets/Extra-ZZZZ.js': randomBytes(500 * 1024) })
    assert.ok(run(dir).problems.some((p) => p.includes('Extra-ZZZZ.js')))
    rmSync(dir, { recursive: true })
})

test('a preloaded file outside the critical group fails', () =>
{
    const dir = makeDist({ 'assets/Ghost-DDDD.js': 'export{}' }, html.replace('</head>', '<link rel="modulepreload" href="./assets/Ghost-DDDD.js"></head>'))
    assert.ok(run(dir).problems.some((p) => p.includes('Ghost-DDDD.js') && p.includes('not counted')))
    rmSync(dir, { recursive: true })
})

test('a referenced file that is missing fails', () =>
{
    const dir = makeDist({}, html.replace('</head>', '<script type="module" src="./assets/Nope-1.js"></script></head>'))
    assert.ok(run(dir).problems.some((p) => p.includes('Nope-1.js') && p.includes('missing')))
    rmSync(dir, { recursive: true })
})

test('missing dist/LICENSES.md fails', () =>
{
    const dir = makeDist()
    rmSync(join(dir, 'LICENSES.md'))
    assert.ok(run(dir).problems.some((p) => p.includes('LICENSES.md')))
    rmSync(dir, { recursive: true })
})

test('hashAssets emits LICENSES.md into the output dir', () =>
{
    const root = mkdtempSync(join(tmpdir(), 'lic-'))
    mkdirSync(join(root, 'static'))
    writeFileSync(join(root, 'static', 'a.png'), 'x')
    hashAssets({ staticDir: join(root, 'static'), outDir: join(root, 'out') })
    assert.match(readFileSync(join(root, 'out', 'LICENSES.md'), 'utf8'), /Bruno Simon/)
    rmSync(root, { recursive: true })
})

test('BUILD_ID is restricted to alphanumerics', () =>
{
    assert.equal(sanitizeBuildId('7ebf1ed9'), '7ebf1ed9')
    for(const bad of ['../x', 'a.b', 'a"b', "a'b", '', 'a b', 'a/b', 'x'.repeat(65)])
        assert.throws(() => sanitizeBuildId(bad), bad)
})

test('3 MB planted lazyDebug chunk fails the size budget', () =>
{
    const dir = makeDist({ 'assets/PerfHud-ABCD.js': randomBytes(3 * 1024 * 1024) })
    const failed = run(dir).rows.filter((r) => r.status === 'FAIL').map((r) => r.name)
    assert.ok(failed.includes('lazyDebug'), failed.join())
    rmSync(dir, { recursive: true })
})

test('3 MB planted test asset fails the size budget', () =>
{
    const dir = makeDist({ 'probe-ab12.glb': randomBytes(3 * 1024 * 1024) })
    const failed = run(dir).rows.filter((r) => r.status === 'FAIL').map((r) => r.name)
    assert.ok(failed.includes('testAssets'), failed.join())
    rmSync(dir, { recursive: true })
})

test('debug-only chunks and test assets fail in a production dist, pass with debug', () =>
{
    const dir = makeDist({ 'assets/Inspector-ABCD.js': 'export{}', 'assets/PhysicsSmoke-ABCD.js': 'export{}', 'probe-ab12.glb': 'glb' })
    const result = measure({ dist: dir, budgets })
    const prod = integrity(result)
    for(const f of ['Inspector-ABCD.js', 'PhysicsSmoke-ABCD.js', 'probe-ab12.glb']) assert.ok(prod.some((p) => p.includes(f) && p.includes('debug-only')), f)
    assert.deepEqual(integrity(result, { debug: true }), [])
    rmSync(dir, { recursive: true })
})
