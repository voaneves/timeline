// Originality audit: fails (exit 1) if anything from the upstream folio-2025 (Bruno Simon, MIT)
// static/ or resources/ trees, or its identifiers / copy, shows up in our files.
//
//   node scripts/audit-originality.mjs                    audit
//   node scripts/audit-originality.mjs --update-manifest  rebuild scripts/upstream-hashes.json (hashes only)
//   env UPSTREAM=<path to the read-only clone>, AUDIT_ROOTS=a,b (extra roots, relative to game/)
//   env AUDIT_GAME_DIR / AUDIT_REPO_ROOT / AUDIT_MANIFEST override the scanned trees and the manifest (used by the tests).
//
// What is scanned
//   - EVERY file under game/ (not only sources/static/dist), plus the repo root: top-level files and the
//     assets/, src/, scripts/, tokens/ and docs/ folders. Skipped: node_modules and .git only directly at the game root / repo root (never nested), game/ when scanning the
//     repo root (it is its own tree), and scripts/upstream-hashes.json (the manifest itself).
//   - docs/ (repo root) and attribution documents (NOTICE.md, LICENSES.md, LICENSE, README.md; only at the repo root and the game/ root) legitimately
//     name the upstream author, so text phrases / identifiers are NOT checked there; byte hashes and decoded
//     blobs still are. tools/capture/ (baselines of the reference site) and tests/ get the same treatment. This script and its tests name the identifiers on purpose and get the same treatment.
//
// Checks
//   1. sha256 of every file against the upstream manifest (static/ + resources/, >= 32 bytes).
//   2. Filenames are compared case-insensitively with the upstream asset names (distinctive stems only).
//   3. Text files (.js .mjs .css .html .json .svg .md .glsl .wgsl ...): identifiers (author, repo, site, mascot),
//      curated upstream copy phrases (whitespace-collapsed, case and curly-quote insensitive, so line breaks or
//      double spaces do not hide them), and references to upstream asset filenames.
//   4. Embedded blobs: base64 data URIs and long base64 runs inside text files are decoded and hashed against the
//      manifest; decoded text is re-scanned for identifiers and phrases (one level, no nested encodings).
//   5. PNG: besides the file hash, a hash of the decoded, unfiltered pixel bytes (+ width, height, colour type,
//      bit depth) is compared, which catches a re-compressed copy of an upstream image. Upstream pixel hashes
//      come from manifest.pixels when present, else are computed from the UPSTREAM clone if it exists, else this
//      check is skipped (reported on stdout).
//   6. Binary files: strong upstream identifiers (author handle, repo name) are searched as raw bytes.
//
// Known limits (best effort, NOT a proof of originality)
//   - Identifier concatenation is only partly handled: "B"+"runo", 'B' + 'runo', `B` + `runo` and unicode / hex escapes
//     (backslash-u0042, backslash-x42 followed by "runo") are folded before matching, but String.fromCharCode, array joins, reversed or XOR-ed
//     strings and any computed construction are not.
//   - Recompression of non-PNG images (webp, jpg, ktx2), re-exported or re-ordered GLB/FBX, re-encoded audio,
//     re-saved .blend files, a texture with one pixel changed, or PNGs converted to another colour type or
//     bit depth, all hash differently and pass. Perceptual similarity is out of scope.
//   - Interlaced (Adam7) PNGs are not pixel-hashed. Blobs compressed (gzip/deflate) before base64 are not decoded.
//   - Copy phrases are a short curated list, not the upstream text; paraphrases are not detected.
//
// Allowlist: a line that is exactly one comment holding the attribution header ("Adapted from folio-2025 by Bruno Simon (MIT)", nothing else on the line),
// and anything under three/examples/jsm/libs/** (or byte-identical to a file there).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { inflateSync } from 'node:zlib'
import { dirname, resolve, join, relative, basename, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const GAME = resolve(process.env.AUDIT_GAME_DIR || join(here, '..'))
const REPO = resolve(process.env.AUDIT_REPO_ROOT || join(GAME, '..'))
const MANIFEST = resolve(process.env.AUDIT_MANIFEST || join(here, 'upstream-hashes.json'))
const UPSTREAM = resolve(process.env.UPSTREAM || join(here, '..', '..', '..', '..', '_vendor', 'folio-2025'))
const UPSTREAM_DIRS = ['static', 'resources']
const MIN_HASHED_SIZE = 32 // ignore trivially small files (empty, one-liners) to avoid coincidental matches
const SKIP_DIRS = new Set(['node_modules', '.git'])
const REPO_FOLDERS = ['assets', 'src', 'scripts', 'tokens', 'docs']

const TEXT_EXT = new Set([
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss', '.html', '.htm', '.json', '.svg', '.webmanifest',
    '.glsl', '.wgsl', '.frag', '.vert', '.txt', '.plist', '.md', '.mdx', '.yml', '.yaml', '.toml', '.xml', '.csv',
    '.py', '.ps1', '.sh', '.bat', '.map', '.gltf', '.mtl', '.obj',
])
// A line is exempt only if it is exactly one comment holding the header and nothing else.
const HEADER_LINE = /^\s*(?:\/\/+|\/\*+|\*+|#+|<!--)\s*Adapted from folio-2025 by Bruno Simon,? \(?MIT\)?(?:\s+[—–-]+\s+https:\/\/github\.com\/brunosimon\/folio-2025\/?)?\s*(?:\*+\/|-->)?\s*$/i
// The same phrase inside the root package.json "description" string (only that phrase is stripped; the rest of the line is still checked).
const HEADER_IN_DESCRIPTION = /("description"\s*:\s*"[^"\n]*?)Adapted from folio-2025 by Bruno Simon,? \(?MIT\)?/i
const THREE_LIBS = /(^|[\\/])three[\\/]examples[\\/]jsm[\\/]libs[\\/]/
const ATTRIBUTION_DOCS = new Set(['notice.md', 'licenses.md', 'license', 'license.md', 'readme.md'])
const GENERATED_ATTRIBUTION = new Set(['dist/licenses.md']) // posix, lowercase, relative to game/: emitted by scripts/hash-assets.mjs
const SELF_FILES = new Set(['scripts/audit-originality.mjs']) // posix path relative to game/
// Reference tooling and tests that legitimately name the upstream site/author (baseline captures of the reference site, attribution asserts).
// Identifier checks are off there; hashes, copy phrases and blobs are still checked.
const IDENT_ALLOWED = /^(?:tools\/capture\/|tests\/)/
const SELF_TEST = /^tests\/originality[^/]*$/i

// Identifiers that only make sense if upstream content leaked in.
const IDENTIFIERS = [
    /bruno/i,
    /folio/i,
    /\bbsky\.social\b/i,
    /three\.?js[- ]?journey/i,
    /\bPally\b/,
]
// Strong identifiers also searched as raw bytes in binaries.
const BINARY_IDENTIFIERS = [/brunosimon/i, /bruno[ _-]?simon/i, /folio-2025/i]
// Distinctive upstream copy (achievement titles / strings). Short curated list, not the upstream text.
// Stored normalised (see normalize()): lowercase, straight quotes, single spaces.
const COPY_PHRASES_RAW = [
    'I’m going on an adventure',
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
]

const GENERIC_STEMS = new Set(['index', 'default', 'favicon', 'manifest', 'readme', 'license', 'apple-touch-icon', 'texture', 'material', 'normal', 'diffuse'])

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const posix = (p) => p.split(sep).join('/')

// Lowercase, curly -> straight quotes, every whitespace run (incl. NBSP, newlines) -> one space.
function normalize(s) {
    return s.toLowerCase().replace(/[‘’‚′]/g, '\'').replace(/[“”„″]/g, '"').replace(/\s+/g, ' ')
}
const COPY_PHRASES = [...new Set(COPY_PHRASES_RAW.map(normalize))]

// `skip` names are skipped only directly under the walk root (e.g. game/node_modules), never in nested folders.
function* walk(dir, skip = SKIP_DIRS, atRoot = true) {
    if(!existsSync(dir)) return
    for(const name of readdirSync(dir)) {
        if(atRoot && skip.has(name)) continue
        const full = join(dir, name)
        let st
        try { st = statSync(full) } catch { continue }
        if(st.isDirectory()) yield* walk(full, skip, false)
        else if(st.isFile()) yield full
    }
}

// --- PNG pixel hash (no dependencies) -------------------------------------------------------------
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a, b, c) {
    const p = a + b - c
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

// Returns a sha256 over (width, height, colour type, bit depth, unfiltered scanlines) or null if unsupported.
export function pngPixelHash(buf) {
    try {
        if(buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null
        let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0
        const idat = []
        while(pos + 8 <= buf.length) {
            const len = buf.readUInt32BE(pos)
            const type = buf.toString('latin1', pos + 4, pos + 8)
            const data = buf.subarray(pos + 8, pos + 8 + len)
            if(type === 'IHDR') {
                width = data.readUInt32BE(0); height = data.readUInt32BE(4)
                depth = data[8]; ctype = data[9]; interlace = data[12]
            } else if(type === 'IDAT') idat.push(data)
            else if(type === 'IEND') break
            pos += 12 + len
        }
        if(!width || !height || interlace || !CHANNELS[ctype] || !idat.length) return null
        const bpp = Math.max(1, (CHANNELS[ctype] * depth) >> 3) // bytes per pixel for filtering
        const stride = Math.ceil((width * CHANNELS[ctype] * depth) / 8)
        const raw = inflateSync(Buffer.concat(idat))
        if(raw.length < (stride + 1) * height) return null
        const out = Buffer.alloc(stride * height)
        for(let y = 0; y < height; y++) {
            const filter = raw[y * (stride + 1)]
            const src = y * (stride + 1) + 1
            const dst = y * stride
            for(let x = 0; x < stride; x++) {
                const cur = raw[src + x]
                const a = x >= bpp ? out[dst + x - bpp] : 0
                const b = y > 0 ? out[dst - stride + x] : 0
                const c = x >= bpp && y > 0 ? out[dst - stride + x - bpp] : 0
                let v
                switch(filter) {
                    case 0: v = cur; break
                    case 1: v = cur + a; break
                    case 2: v = cur + b; break
                    case 3: v = cur + ((a + b) >> 1); break
                    case 4: v = cur + paeth(a, b, c); break
                    default: return null
                }
                out[dst + x] = v & 255
            }
        }
        const h = createHash('sha256')
        h.update(`${width}x${height}:${ctype}:${depth}:`)
        h.update(out)
        return h.digest('hex')
    } catch { return null }
}

// --- manifest ------------------------------------------------------------------------------------------
function buildManifest() {
    if(!existsSync(UPSTREAM)) throw new Error(`upstream clone not found: ${UPSTREAM}`)
    const files = {}
    const pixels = {}
    for(const dir of UPSTREAM_DIRS) {
        for(const file of walk(join(UPSTREAM, dir))) {
            const buf = readFileSync(file)
            const key = posix(relative(UPSTREAM, file))
            files[key] = { sha256: sha256(buf), size: buf.length }
            if(extname(file).toLowerCase() === '.png') {
                const px = pngPixelHash(buf)
                if(px) pixels[px] = key
            }
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
        pixels: Object.fromEntries(Object.entries(pixels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n')
    console.log(`manifest: ${manifest.count} files, ${Object.keys(pixels).length} png pixel hashes @ ${commit} -> ${posix(relative(GAME, MANIFEST))}`)
}

function loadThreeLibHashes() {
    const set = new Set()
    for(const base of [join(GAME, 'node_modules', 'three', 'examples', 'jsm', 'libs'), join(REPO, 'node_modules', 'three', 'examples', 'jsm', 'libs')]) {
        for(const file of walk(base, new Set(['.git']))) set.add(sha256(readFileSync(file)))
    }
    return set
}

// --- text helpers --------------------------------------------------------------------------------------
// Fold trivial string tricks so the identifier / phrase regexes still see the joined word:
//   "B" + "runo"  ->  Bruno      Bruno -> Bruno     \x42runo -> Bruno
function foldObfuscation(text) {
    return text
        .replace(/["'`]\s*\+\s*["'`]/g, '')
        .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_, h) => safeChar(parseInt(h, 16)))
        .replace(/\\u([0-9a-f]{4})/gi, (_, h) => safeChar(parseInt(h, 16)))
        .replace(/\\x([0-9a-f]{2})/gi, (_, h) => safeChar(parseInt(h, 16)))
}
function safeChar(cp) { try { return String.fromCodePoint(cp) } catch { return '' } }

const DATA_URI = /data:[a-z0-9.+\-/]*(?:;[a-z0-9=.+\-]+)*;base64,([A-Za-z0-9+/_\-]+={0,2})/gi
const B64_RUN = /[A-Za-z0-9+/]{64,}={0,2}/g

function decodeBlobs(text) {
    const blobs = []
    const seen = new Set()
    const add = (b64) => {
        if(seen.has(b64)) return
        seen.add(b64)
        try {
            const buf = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
            if(buf.length >= MIN_HASHED_SIZE) blobs.push(buf)
        } catch {}
    }
    for(const m of text.matchAll(DATA_URI)) add(m[1])
    for(const m of text.matchAll(B64_RUN)) add(m[0])
    return blobs
}

const looksTextual = (buf) => { const n = Math.min(buf.length, 4096); for(let i = 0; i < n; i++) if(buf[i] === 0) return false; return true }

function textFindings(text, names, { identifiers }) {
    const out = []
    const folded = foldObfuscation(text)
    if(identifiers) {
        // Skip lines carrying the attribution header; check original and folded text.
        const lines = text.split(/\r?\n/)
        const flines = folded.split(/\r?\n/)
        const lineCount = Math.max(lines.length, flines.length)
        for(let i = 0; i < lineCount; i++) {
            const a = lines[i] ?? '', b = flines[i] ?? ''
            if(HEADER_LINE.test(a)) continue
            for(const re of IDENTIFIERS) {
                if(re.test(a)) out.push(['upstream identifier', `line ${i + 1} ${re}`])
                else if(a !== b && re.test(b)) out.push(['upstream identifier (obfuscated)', `line ${i + 1} ${re}`])
            }
        }
    }
    // Copy phrases on the whole normalised text (survives wrapped lines, double spaces, curly quotes).
    const flat = normalize(folded.split(/\r?\n/).filter((l) => !HEADER_LINE.test(l)).join('\n'))
    for(const phrase of COPY_PHRASES) if(flat.includes(phrase)) out.push(['upstream copy', `"${phrase}"`])
    if(identifiers) {
        for(const token of folded.match(/[\w.\-]+\.[a-z0-9]{2,5}/gi) ?? []) {
            if(names.has(token.toLowerCase())) out.push(['upstream asset filename', token])
        }
    }
    return out
}

// --- audit ---------------------------------------------------------------------------------------------
function audit() {
    if(!existsSync(MANIFEST)) { console.error(`missing ${MANIFEST}; run --update-manifest`); process.exit(2) }
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    const byHash = new Map()
    const names = new Set() // lowercase basenames
    for(const [path, { sha256: h, size }] of Object.entries(manifest.files)) {
        if(size >= MIN_HASHED_SIZE) byHash.set(h, path)
        const stem = basename(path, extname(path))
        if(stem.length >= 8 && !GENERIC_STEMS.has(stem.toLowerCase())) names.add(basename(path).toLowerCase())
    }
    const threeLibs = loadThreeLibHashes()

    // Upstream PNG pixel hashes: manifest first, else computed from the clone, else skipped.
    let pixelHashes = new Map(Object.entries(manifest.pixels ?? {}))
    let pixelNote = 'png pixel check: manifest.pixels'
    if(!pixelHashes.size) {
        if(existsSync(UPSTREAM)) {
            for(const dir of UPSTREAM_DIRS) for(const file of walk(join(UPSTREAM, dir))) {
                if(extname(file).toLowerCase() !== '.png') continue
                const px = pngPixelHash(readFileSync(file))
                if(px) pixelHashes.set(px, posix(relative(UPSTREAM, file)))
            }
            pixelNote = `png pixel check: computed from ${UPSTREAM}`
        } else pixelNote = 'png pixel check: SKIPPED (no manifest.pixels and no upstream clone)'
    }

    // Scan list: [file, { base, hashOnly }]
    const targets = []
    const push = (file, base, hashOnly = false) => targets.push({ file, base, hashOnly })
    for(const file of walk(GAME)) {
        if(posix(relative(GAME, file)) === posix(relative(GAME, MANIFEST))) continue
        push(file, GAME)
    }
    for(const extra of process.env.AUDIT_ROOTS ? process.env.AUDIT_ROOTS.split(',') : []) {
        const dir = join(GAME, extra)
        if(!resolve(dir).startsWith(GAME + sep)) for(const file of walk(dir)) push(file, GAME)
    }
    if(existsSync(REPO) && REPO !== GAME) {
        for(const name of readdirSync(REPO)) {
            const full = join(REPO, name)
            let st
            try { st = statSync(full) } catch { continue }
            if(st.isFile()) push(full, REPO)
        }
        for(const folder of REPO_FOLDERS) {
            for(const file of walk(join(REPO, folder))) push(file, REPO, folder === 'docs')
        }
    }

    const findings = []
    const seen = new Set()
    let scanned = 0
    const flag = (rel, kind, detail) => {
        const line = `${rel}: ${kind}: ${detail}`
        if(!seen.has(line)) { seen.add(line); findings.push(line) }
    }

    for(const { file, base, hashOnly } of targets) {
        const rel = (base === GAME ? '' : '../') + posix(relative(base, file))
        const relGame = posix(relative(GAME, file))
        if(seen.has('@' + file)) continue
        seen.add('@' + file)
        scanned++
        if(THREE_LIBS.test(file)) continue
        const ext = extname(file).toLowerCase()
        const buf = readFileSync(file)
        const h = sha256(buf)
        if(buf.length >= MIN_HASHED_SIZE && byHash.has(h) && !threeLibs.has(h)) {
            flag(rel, 'identical to upstream file', byHash.get(h))
            continue
        }
        if(ext === '.png' && pixelHashes.size) {
            const px = pngPixelHash(buf)
            if(px && pixelHashes.has(px)) { flag(rel, 'same decoded pixels as upstream png', pixelHashes.get(px)); continue }
        }
        const isText = TEXT_EXT.has(ext)
        const lowerName = basename(file).toLowerCase()
        const skipText = hashOnly || SELF_FILES.has(relGame) || SELF_TEST.test(relGame)
        // Attribution docs are exempt only at the repo root and the game/ root, not in subfolders.
        const rootLevel = !posix(relative(base, file)).includes('/')
        const attribution = (ATTRIBUTION_DOCS.has(lowerName) && rootLevel) || GENERATED_ATTRIBUTION.has(relGame.toLowerCase()) || IDENT_ALLOWED.test(relGame)
        if(!hashOnly && names.has(lowerName)) flag(rel, 'same filename as upstream asset', basename(file))

        if(!isText) {
            // Binary: raw-byte identifier search (strong identifiers only).
            if(!hashOnly) {
                const latin = buf.toString('latin1')
                for(const re of BINARY_IDENTIFIERS) if(re.test(latin)) flag(rel, 'upstream identifier in binary', `${re}`)
            }
            // Unknown / no-extension / binary files: also scan as text (latin1 and utf8) for upstream copy phrases.
            if(!skipText) {
                for(const enc of ['latin1', 'utf8']) for(const [kind, detail] of textFindings(buf.toString(enc), names, { identifiers: false })) flag(rel, `${kind} (in non-text file)`, detail)
            }
            continue
        }

        let text = buf.toString('utf8')
        if(rootLevel && lowerName === 'package.json') text = text.replace(HEADER_IN_DESCRIPTION, '$1attribution')
        if(!skipText) {
            for(const [kind, detail] of textFindings(text, names, { identifiers: !attribution })) flag(rel, kind, detail)
        }
        // Embedded blobs: hash everywhere (even hash-only docs / attribution), re-scan decoded text where text is checked.
        for(const blob of decodeBlobs(text)) {
            const bh = sha256(blob)
            if(byHash.has(bh) && !threeLibs.has(bh)) { flag(rel, 'embedded blob identical to upstream file', byHash.get(bh)); continue }
            if(pixelHashes.size && blob.subarray(0, 8).equals(PNG_SIG)) {
                const px = pngPixelHash(blob)
                if(px && pixelHashes.has(px)) { flag(rel, 'embedded png has same pixels as upstream', pixelHashes.get(px)); continue }
            }
            if(!skipText && looksTextual(blob)) {
                for(const [kind, detail] of textFindings(blob.toString('utf8'), names, { identifiers: !attribution })) flag(rel, `${kind} (in base64 blob)`, detail)
            }
        }
    }

    console.log(pixelNote)
    if(findings.length) {
        console.error(`audit-originality: FAIL (${findings.length} finding(s), ${scanned} files scanned)`)
        for(const f of findings) console.error('  ' + f)
        process.exit(1)
    }
    console.log(`audit-originality: OK (${scanned} files scanned, ${Object.keys(manifest.files).length} upstream hashes @ ${manifest.commit})`)
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if(process.argv.includes('--update-manifest')) buildManifest()
    else audit()
}
