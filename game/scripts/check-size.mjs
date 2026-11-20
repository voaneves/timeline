// Size gate (plan T0.14, sections 6.5 + 7.4): gzip + brotli bytes of dist/ per category against budgets.json.
// Sources: dist/index.html (entry + modulepreload), dist/asset-manifest.*.json (hashed static assets), dist/assets/*.
// (Vite's own manifest is not enabled in vite.config.js; the HTML + file-name rules cover the same ground.)
// Related: `npm run gate:replay` runs the ghost determinism check (tools/capture/ghost-verify.mjs, headless Chrome); not part of `npm test`.
// CLI: node scripts/check-size.mjs [--dist dist] [--budgets budgets.json] [--json] [--debug]
// Categories flagged "prodForbidden" (debug-only chunks, test assets) FAIL when present in a production dist; --debug (dist-debug builds) allows them.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const KB = 1024

const gz = (_buf) => gzipSync(_buf, { level: 9 }).length
const br = (_buf) => brotliCompressSync(_buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: _buf.length } }).length

function walk(_dir, _out = [])
{
    for(const entry of readdirSync(_dir, { withFileTypes: true }))
    {
        const full = join(_dir, entry.name)
        if(entry.isDirectory()) walk(full, _out)
        else _out.push(full)
    }
    return _out
}

export function measure({ dist = 'dist', budgets })
{
    const root = resolve(dist)
    if(!existsSync(join(root, 'index.html')))
        throw new Error(`${root}/index.html not found: run "npm run build" first`)

    // Asset manifest maps logical names (e.g. "palette/palette.png") to hashed files
    const logical = new Map()
    for(const f of readdirSync(root).filter((n) => /^asset-manifest\..+\.json$/.test(n)))
    {
        const manifest = JSON.parse(readFileSync(join(root, f), 'utf8'))
        for(const [name, info] of Object.entries(manifest.assets ?? {})) logical.set(info.file, name)
    }

    const rules = budgets.categories.map((c) => ({ name: c.name, re: new RegExp(c.match, 'i') }))
    const categories = Object.fromEntries(budgets.categories.map((c) => [c.name, { files: [], raw: 0, gz: 0, br: 0 }]))
    const unclassified = []
    const ignored = []
    const ignoreRes = (budgets.ignore ?? []).map((m) => new RegExp(m, 'i'))
    const fileCat = new Map()

    for(const full of walk(root))
    {
        const rel = full.slice(root.length + 1).replaceAll('\\', '/')
        const name = logical.get(rel) ?? rel
        const rule = rules.find((r) => r.re.test(name) || r.re.test(rel))
        if(ignoreRes.some((r) => r.test(rel))) { ignored.push(rel); continue }
        if(!rule) { unclassified.push(rel); continue }
        fileCat.set(rel, rule.name)
        const buf = readFileSync(full)
        const cat = categories[rule.name]
        cat.files.push(rel)
        cat.raw += buf.length
        cat.gz += gz(buf)
        cat.br += br(buf)
    }

    const groups = {}
    for(const g of budgets.groups ?? [])
    {
        groups[g.name] = { gz: 0, br: 0, raw: 0 }
        for(const c of g.of)
        {
            groups[g.name].gz += categories[c]?.gz ?? 0
            groups[g.name].br += categories[c]?.br ?? 0
            groups[g.name].raw += categories[c]?.raw ?? 0
        }
    }

    // Files the entry HTML pulls in (script src, modulepreload, stylesheet) must be counted in "critical"
    const html = readFileSync(join(root, 'index.html'), 'utf8')
    const referenced = []
    for(const m of html.matchAll(/<(script|link)\b[^>]*>/gi))
    {
        const tag = m[0]
        if(m[1].toLowerCase() === 'link' && !/rel=["']?(modulepreload|stylesheet|preload)/i.test(tag)) continue
        const ref = tag.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1]
        if(!ref || /^(https?:)?\/\//i.test(ref) || ref.startsWith('data:')) continue
        referenced.push(ref.replace(/^\.?\//, '').split(/[?#]/)[0])
    }
    const critical = new Set((budgets.groups ?? []).find((g) => g.name === 'critical')?.of ?? [])
    const missing = (budgets.requiredFiles ?? []).filter((f) => !existsSync(join(root, f)))
    const referencedProblems = []
    for(const ref of referenced)
    {
        if(!existsSync(join(root, ref))) { referencedProblems.push(`${ref}: referenced by index.html but missing`); continue }
        const cat = fileCat.get(ref)
        if(!cat || !critical.has(cat)) referencedProblems.push(`${ref}: referenced by index.html but not counted in the critical group (category: ${cat ?? 'none'})`)
    }
    const prodForbidden = budgets.categories.filter((c) => c.prodForbidden).flatMap((c) => categories[c.name].files.map((f) => [f, c.name]))
    return { categories, groups, prodForbidden, unclassified, ignored, referenced, missing, referencedProblems }
}

// Structural failures (independent of byte budgets)
export function integrity(result, { debug = false } = {})
{
    const forbidden = debug ? [] : result.prodForbidden.map(([f, c]) => `${f}: category "${c}" is debug-only and must not ship in a production build`)
    return [
        ...forbidden,
        ...result.unclassified.map((f) => `unclassified file (add a category or an "ignore" entry in budgets.json): ${f}`),
        ...result.missing.map((f) => `required file missing from dist: ${f}`),
        ...result.referencedProblems,
    ]
}

export function evaluate(result, budgets)
{
    const rows = []
    const push = (kind, name, m, b) =>
    {
        if(!b) return
        const status = m.gz > b.failKB * KB ? 'FAIL' : m.gz > b.maxKB * KB ? 'WARN' : 'ok'
        rows.push({ kind, name, gz: m.gz, br: m.br, raw: m.raw, maxKB: b.maxKB, failKB: b.failKB, status })
    }
    for(const c of budgets.categories) push('category', c.name, result.categories[c.name], c.budget)
    for(const g of budgets.groups ?? []) push('group', g.name, result.groups[g.name], g.budget)
    return rows
}

const fmt = (_n) => (_n / KB).toFixed(1).padStart(9) + ' KB'

export function report(result, rows, opts)
{
    console.log('kind      name              gzip         brotli       budget(gz)   fail(gz)   status')
    for(const r of rows)
        console.log(`${r.kind.padEnd(9)} ${r.name.padEnd(16)} ${fmt(r.gz)} ${fmt(r.br)} ${String(r.maxKB).padStart(9)} KB ${String(r.failKB).padStart(7)} KB  ${r.status}`)
    for(const p of integrity(result, opts)) console.log('  FAIL', p)
}

if(process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
{
    const args = process.argv.slice(2)
    const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d)
    const budgets = JSON.parse(readFileSync(resolve(arg('--budgets', process.env.BUDGETS ?? 'budgets.json')), 'utf8'))
    const result = measure({ dist: arg('--dist', 'dist'), budgets: budgets.size })
    const rows = evaluate(result, budgets.size)
    const problems = integrity(result, { debug: args.includes('--debug') })
    if(args.includes('--json')) console.log(JSON.stringify({ rows, unclassified: result.unclassified, problems }, null, 2))
    else report(result, rows, { debug: args.includes('--debug') })
    const failed = rows.filter((r) => r.status === 'FAIL')
    if(failed.length || problems.length) { console.error(`size gate FAILED: ${[...failed.map((r) => r.name), ...problems].join('; ')}`); process.exit(1) }
    console.log('size gate passed')
}
