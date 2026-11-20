import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { hashAssets, computeBuildId } from '../scripts/hash-assets.mjs'
import { fetchManifest, resolveAsset } from '../sources/Game/assetManifest.js'

const serve = (_dir) => new Promise(resolve =>
{
    const server = http.createServer((req, res) =>
    {
        const file = join(_dir, decodeURIComponent(req.url.split('?')[0]))
        if(!existsSync(file) || !extname(file)) { res.writeHead(404); res.end(); return }
        res.writeHead(200); res.end(readFileSync(file))
    }).listen(0, '127.0.0.1', () => resolve(server))
})

test('changing a glb changes its hashed name and manifest; old build still resolves old assets', async () =>
{
    const root = mkdtempSync(join(tmpdir(), 'hash-assets-'))
    const staticDir = join(root, 'static'), outDir = join(root, 'out')
    mkdirSync(join(staticDir, 'test'), { recursive: true })
    writeFileSync(join(staticDir, 'test', 'probe.glb'), Buffer.from('glTF-version-one'))
    writeFileSync(join(staticDir, 'test', 'other.png'), Buffer.from('png'))

    const a = hashAssets({ staticDir, outDir })
    writeFileSync(join(staticDir, 'test', 'probe.glb'), Buffer.from('glTF-version-two'))
    const b = hashAssets({ staticDir, outDir }) // same out dir: additive, like a deploy over the previous one

    assert.notEqual(a.buildId, b.buildId)
    assert.notEqual(a.manifestName, b.manifestName)
    assert.match(a.assets['test/probe.glb'].file, /^assets\/probe\.[0-9a-f]{8}\.glb$/)
    assert.notEqual(a.assets['test/probe.glb'].file, b.assets['test/probe.glb'].file)
    assert.equal(a.assets['test/other.png'].file, b.assets['test/other.png'].file) // untouched asset keeps its name
    assert.equal(computeBuildId(staticDir), b.buildId)
    assert.equal(readdirSync(outDir).filter(f => f.startsWith('asset-manifest.')).length, 2)

    const server = await serve(outDir)
    const base = `http://127.0.0.1:${server.address().port}/`
    try
    {
        for(const [ build, text ] of [ [ a, 'glTF-version-one' ], [ b, 'glTF-version-two' ] ])
        {
            const manifest = await fetchManifest(build.buildId, base) // what each JS bundle does with its embedded id
            const res = await fetch(resolveAsset(manifest, 'test/probe.glb', base))
            assert.equal(await res.text(), text)
        }
        assert.throws(() => resolveAsset({ buildId: 'x', assets: {} }, 'nope.glb', base), /not in manifest/)
    }
    finally { server.close() }
})
