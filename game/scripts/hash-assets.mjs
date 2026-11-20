// Content-hashed asset naming + manifest (plan T0.15, risk R13).
// static/** -> <out>/assets/<name>.<hash8>.<ext>, plus <out>/asset-manifest.<buildId>.json.
// Additive within one output folder (never deletes). Note: vite empties dist/ and previews are orphan single commits, so deployed OLD builds are not kept; clients recover via the loader retry + page reload.
// CLI: node scripts/hash-assets.mjs [--static static] [--out dist] [--no-verify] [--include-test]
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sha = (_buffer) => createHash('sha256').update(_buffer).digest('hex')

function walk(_dir, _root = _dir, _out = [])
{
    if(!existsSync(_dir))
        return _out
    for(const entry of readdirSync(_dir, { withFileTypes: true }))
    {
        const full = join(_dir, entry.name)
        if(entry.isDirectory())
            walk(full, _root, _out)
        else if(entry.isFile())
            _out.push({ full, name: relative(_root, full).split(sep).join('/') })
    }
    return _out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

// static/test/** (probe glb etc.) is test-only: skipped unless includeTest (CLI: --include-test, for debug builds)
function walkAssets(_staticDir, _includeTest)
{
    return walk(resolve(_staticDir)).filter(f => _includeTest || !f.name.startsWith('test/'))
}

// BUILD_ID ends up in a file name and in the JS bundle: alphanumerics only (no path separators, dots, quotes).
export function sanitizeBuildId(_id)
{
    if(typeof _id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(_id))
        throw new Error(`BUILD_ID must match /^[A-Za-z0-9]{1,64}$/ (got ${JSON.stringify(_id)})`)
    return _id
}

// Deterministic id of the asset set (names + contents). BUILD_ID env overrides it.
export function computeBuildId(_staticDir = 'static', _includeTest = true)
{
    if(process.env.BUILD_ID)
        return sanitizeBuildId(process.env.BUILD_ID)
    const h = createHash('sha256')
    for(const file of walkAssets(_staticDir, _includeTest))
        h.update(`${file.name}\0${sha(readFileSync(file.full))}\n`)
    return h.digest('hex').slice(0, 8)
}

export function hashAssets({ staticDir = 'static', outDir = 'dist', includeTest = true, buildId = computeBuildId(staticDir, includeTest), licensesFile = fileURLToPath(new URL('../LICENSES.md', import.meta.url)) } = {})
{
    sanitizeBuildId(buildId)
    const assetsDir = join(resolve(outDir), 'assets')
    mkdirSync(assetsDir, { recursive: true })

    const assets = {}
    for(const file of walkAssets(staticDir, includeTest))
    {
        const buffer = readFileSync(file.full)
        const ext = extname(file.full)
        const hashed = `${basename(file.full, ext)}.${sha(buffer).slice(0, 8)}${ext}`
        copyFileSync(file.full, join(assetsDir, hashed))
        assets[file.name] = { file: `assets/${hashed}`, bytes: buffer.length }
    }

    const manifestName = `asset-manifest.${buildId}.json`
    writeFileSync(join(resolve(outDir), manifestName), JSON.stringify({ buildId, assets }, null, 2) + '\n')

    // Licence texts must ship with the bundle (MIT / Apache-2.0 notices): dist/LICENSES.md on every build
    const licenses = resolve(licensesFile)
    if(existsSync(licenses))
        copyFileSync(licenses, join(resolve(outDir), 'LICENSES.md'))
    return { buildId, manifestName, assets }
}

// buildId must be embedded in the (Vite-hashed) JS, otherwise the loader can't find its manifest.
function verifyEmbedded(_outDir, _buildId)
{
    const dir = join(resolve(_outDir), 'assets')
    if(!existsSync(dir))
        return false
    return readdirSync(dir).some(name => name.endsWith('.js') && readFileSync(join(dir, name), 'utf8').includes(_buildId))
}

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
    const args = process.argv.slice(2)
    const opt = (_name, _def) => { const i = args.indexOf(_name); return i >= 0 ? args[i + 1] : _def }
    const staticDir = opt('--static', 'static')
    const outDir = opt('--out', 'dist')
    const includeTest = args.includes('--include-test')
    const result = hashAssets({ staticDir, outDir, includeTest })
    console.log(`hash-assets: ${Object.keys(result.assets).length} asset(s) -> ${outDir}/${result.manifestName}`)
    if(!args.includes('--no-verify') && !verifyEmbedded(outDir, result.buildId))
    {
        console.error(`hash-assets: buildId ${result.buildId} not found in any ${outDir}/assets/*.js (run vite build first, same static/ and BUILD_ID)`)
        process.exit(1)
    }
}
