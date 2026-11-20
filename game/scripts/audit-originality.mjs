// Originality audit: fails (exit 1) if anything from the upstream folio-2025 (Bruno Simon, MIT)
// static/ or resources/ trees, or its identifiers / copy, shows up in our sources, static or dist.
//
//   node scripts/audit-originality.mjs                    audit
//   node scripts/audit-originality.mjs --update-manifest  rebuild scripts/upstream-hashes.json (hashes only)
//   env UPSTREAM=<path to the read-only clone>, AUDIT_ROOTS=a,b (extra roots, relative to game/)
//
// Allowlist: lines with the attribution header ("Adapted from folio-2025 by Bruno Simon (MIT)"),
// and anything under three/examples/jsm/libs/** (or byte-identical to a file there).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve, join, relative, basename, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const GAME = resolve(here, '..')
const MANIFEST = join(here, 'upstream-hashes.json')
const UPSTREAM = resolve(process.env.UPSTREAM || join(GAME, '..', '..', '..', '_vendor', 'folio-2025'))
const UPSTREAM_DIRS = ['static', 'resources']
const MIN_HASHED_SIZE = 32 // ignore trivially small files (empty, one-liners) to avoid coincidental matches
const SKIP_DIRS = new Set(['node_modules', '.git'])

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.svg', '.webmanifest', '.glsl', '.wgsl', '.txt', '.plist'])
const HEADER = /Adapted from folio-2025 by Bruno Simon \(MIT\)/
const THREE_LIBS = /(^|[\\/])three[\\/]examples[\\/]jsm[\\/]libs[\\/]/

// Identifiers that only make sense if upstream content leaked in.
const IDENTIFIERS = [
    /bruno/i,
    /folio/i,
    /\bbsky\.social\b/i,
    /three\.?js[- ]?journey/i,
    /\bPally\b/,
]
// Distinctive upstream copy (achievement titles / strings). Short curated list, not the upstream text.
const COPY_PHRASES = [
    'I’m going on an adventure', 'I\'m going on an adventure',
    'But can you fix the wifi',
    'I\'m a bit of a scientist myself',
    'Wake & bake', 'Making some dough', 'So baked right now', 'Cookie Clicker',
    'Great Explosion Murder God Dynamight',
    'Flip of faith', 'Under the sea', 'Participation medal',
    'Early Bird gets the Worm',
    'One for the god of Chaos', 'Witness a cataclysm',
    'Do you want to build a snowman', 'singing in the rain', '1.21 Gigawatts',
    'You’re my only fan', 'Clean your room', 'Up up down down',
    'Let\'s go bowling', 'Do not disturb', 'Honk me like one of your french driver',
].map((s) => s.toLowerCase())

const GENERIC_STEMS = new Set(['index', 'default', 'favicon', 'manifest', 'readme', 'license', 'texture', 'material', 'normal', 'diffuse'])

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const posix = (p) => p.split(sep).join('/')

function* walk(dir) {
    if(!existsSync(dir)) return
    for(const name of readdirSync(dir)) {
        if(SKIP_DIRS.has(name)) continue
        const full = join(dir, name)
        const st = statSync(full)
        if(st.isDirectory()) yield* walk(full)
        else if(st.isFile()) yield full
    }
}

function buildManifest() {
    if(!existsSync(UPSTREAM)) throw new Error(`upstream clone not found: ${UPSTREAM}`)
    const files = {}
    for(const dir of UPSTREAM_DIRS) {
        for(const file of walk(join(UPSTREAM, dir))) {
            const buf = readFileSync(file)
            files[posix(relative(UPSTREAM, file))] = { sha256: sha256(buf), size: buf.length }
        }
    }
    let commit = 'unknown'
    try { commit = execFileSync('git', ['-C', UPSTREAM, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}
    const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    const manifest = {
        note: 'sha256 manifest of folio-2025 static/ and resources/ (hashes only, no content). Regenerate: node scripts/audit-originality.mjs --update-manifest',
        upstream: 'https://github.com/brunosimon/folio-2025',
        commit,
        count: Object.keys(sorted).length,
        files: sorted,
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n')
    console.log(`manifest: ${manifest.count} files @ ${commit} -> ${posix(relative(GAME, MANIFEST))}`)
}

function loadThreeLibHashes() {
    const set = new Set()
    for(const base of [join(GAME, 'node_modules', 'three', 'examples', 'jsm', 'libs'), join(GAME, '..', 'node_modules', 'three', 'examples', 'jsm', 'libs')]) {
        for(const file of walk(base)) set.add(sha256(readFileSync(file)))
    }
    return set
}

function audit() {
    if(!existsSync(MANIFEST)) { console.error(`missing ${MANIFEST}; run --update-manifest`); process.exit(2) }
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    const byHash = new Map()
    const names = new Set()
    for(const [path, { sha256: h, size }] of Object.entries(manifest.files)) {
        if(size >= MIN_HASHED_SIZE) byHash.set(h, path)
        const stem = basename(path, extname(path))
        if(stem.length >= 8 && !GENERIC_STEMS.has(stem.toLowerCase())) names.add(basename(path))
    }
    const threeLibs = loadThreeLibHashes()

    const roots = ['sources', 'static', 'dist', ...(process.env.AUDIT_ROOTS ? process.env.AUDIT_ROOTS.split(',') : [])]
    const findings = []
    let scanned = 0
    const flag = (file, kind, detail) => findings.push(`${posix(relative(GAME, file))}: ${kind}: ${detail}`)

    for(const root of roots) {
        for(const file of walk(join(GAME, root))) {
            scanned++
            if(THREE_LIBS.test(file)) continue
            const buf = readFileSync(file)
            const h = sha256(buf)
            if(buf.length >= MIN_HASHED_SIZE && byHash.has(h) && !threeLibs.has(h)) {
                flag(file, 'identical to upstream file', byHash.get(h))
                continue
            }
            if(names.has(basename(file))) flag(file, 'same filename as upstream asset', basename(file))
            if(!TEXT_EXT.has(extname(file).toLowerCase())) continue
            const lines = buf.toString('utf8').split(/\r?\n/)
            lines.forEach((line, i) => {
                if(HEADER.test(line)) return
                const where = `line ${i + 1}`
                for(const re of IDENTIFIERS) if(re.test(line)) flag(file, 'upstream identifier', `${where} ${re}`)
                const lower = line.toLowerCase()
                for(const phrase of COPY_PHRASES) if(lower.includes(phrase)) flag(file, 'upstream copy', `${where} "${phrase}"`)
                for(const token of line.match(/[\w.\-]+\.[a-z0-9]{2,5}/gi) ?? []) if(names.has(token)) flag(file, 'upstream asset filename', `${where} ${token}`)
            })
        }
    }

    if(findings.length) {
        console.error(`audit-originality: FAIL (${findings.length} finding(s), ${scanned} files scanned)`)
        for(const f of findings) console.error('  ' + f)
        process.exit(1)
    }
    console.log(`audit-originality: OK (${scanned} files scanned, ${Object.keys(manifest.files).length} upstream hashes @ ${manifest.commit})`)
}

if(process.argv.includes('--update-manifest')) buildManifest()
else audit()
