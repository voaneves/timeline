// Negative tests for scripts/audit-originality.mjs: plant "upstream" content in a temp tree and expect exit 1.
// The audit is pointed at the temp tree through AUDIT_GAME_DIR / AUDIT_REPO_ROOT / AUDIT_MANIFEST.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'audit-originality.mjs')
const sha = (b) => createHash('sha256').update(b).digest('hex')

const UPSTREAM_BYTES = Buffer.from('pretend upstream asset bytes, long enough to be hashed (>= 32 bytes)')

function png(width, height, filter) {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
    const crc = (buf) => { let c = 0xffffffff; for(const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
    const chunk = (type, data) => {
        const head = Buffer.alloc(4); head.writeUInt32BE(data.length)
        const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
        const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body))
        return Buffer.concat([head, body, tail])
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 0 // 8-bit grayscale
    const pixel = (x, y) => (x * 37 + y * 91 + 5) & 255
    const rows = []
    for(let y = 0; y < height; y++) {
        const row = [filter]
        for(let x = 0; x < width; x++) row.push(filter === 1 && x > 0 ? (pixel(x, y) - pixel(x - 1, y)) & 255 : pixel(x, y))
        rows.push(Buffer.from(row))
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}

function makeRoot(manifestExtra = {}) {
    const base = mkdtempSync(join(tmpdir(), 'orig-audit-'))
    const root = join(base, 'repo') // the manifest lives next to it, outside the scanned tree
    const game = join(root, 'game')
    mkdirSync(join(game, 'sources'), { recursive: true })
    writeFileSync(join(game, 'sources', 'main.js'), 'export const ok = 1 // our own code\n')
    const manifest = {
        commit: 'test',
        files: { 'static/Upstream-Distinct-Asset.bin': { sha256: sha(UPSTREAM_BYTES), size: UPSTREAM_BYTES.length } },
        ...manifestExtra,
    }
    writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest))
    return { root, game }
}

function audit(root, game) {
    const r = spawnSync(process.execPath, [SCRIPT], {
        encoding: 'utf8',
        env: { ...process.env, AUDIT_GAME_DIR: game, AUDIT_REPO_ROOT: root, AUDIT_MANIFEST: join(root, '..', 'manifest.json'), UPSTREAM: join(root, 'no-upstream') },
    })
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

test('clean tree passes', () => {
    const { root, game } = makeRoot()
    try { const r = audit(root, game); assert.equal(r.code, 0, r.out) } finally { rmSync(join(root, '..'), { recursive: true, force: true }) }
})

test('upstream-hashed file under a different name fails (exit 1)', () => {
    const { root, game } = makeRoot()
    try {
        writeFileSync(join(game, 'sources', 'renamed.bin'), UPSTREAM_BYTES)
        const r = audit(root, game)
        assert.equal(r.code, 1)
        assert.match(r.out, /identical to upstream file/)
    } finally { rmSync(join(root, '..'), { recursive: true, force: true }) }
})

test('upstream-hashed file in a repo-root folder (docs/) fails', () => {
    const { root, game } = makeRoot()
    try {
        mkdirSync(join(root, 'docs'))
        writeFileSync(join(root, 'docs', 'x.bin'), UPSTREAM_BYTES)
        assert.equal(audit(root, game).code, 1)
    } finally { rmSync(join(root, '..'), { recursive: true, force: true }) }
})

test('upstream bytes hidden in a base64 data URI fail', () => {
    const { root, game } = makeRoot()
    try {
        writeFileSync(join(game, 'sources', 'inline.js'), `export const img = 'data:application/octet-stream;base64,${UPSTREAM_BYTES.toString('base64')}'\n`)
        const r = audit(root, game)
        assert.equal(r.code, 1)
        assert.match(r.out, /embedded blob identical to upstream/)
    } finally { rmSync(join(root, '..'), { recursive: true, force: true }) }
})

test('upstream filename is matched case-insensitively', () => {
    const { root, game } = makeRoot()
    try {
        writeFileSync(join(game, 'sources', 'UPSTREAM-DISTINCT-ASSET.BIN'), 'something else entirely')
        assert.equal(audit(root, game).code, 1)
    } finally { rmSync(join(root, '..'), { recursive: true, force: true }) }
})

test('copy phrase split over lines / double spaces fails; concatenated identifier fails', () => {
    const { root, game } = makeRoot()
    try {
        writeFileSync(join(game, 'sources', 'copy.js'), 'export const t = `Wake\n   &   bake`\n')
        const r = audit(root, game)
        assert.equal(r.code, 1)
        assert.match(r.out, /upstream copy/)
        rmSync(join(game, 'sources', 'copy.js'))
        writeFileSync(join(game, 'sources', 'cat.js'), 'export const n = "B" + "runo"\n')
        assert.equal(audit(root, game).code, 1)
    } finally { rmSync(join(root, '..'), { recursive: true, force: true }) }
})

test('re-encoded PNG with the same pixels fails; different pixels pass', async () => {
    const mod = await import('../scripts/audit-originality.mjs')
    const upstreamPng = png(8, 8, 0)
    const px = mod.pngPixelHash(upstreamPng)
    assert.ok(px)
    assert.notEqual(sha(upstreamPng), sha(png(8, 8, 1)), 'different filter => different file bytes')
    assert.equal(mod.pngPixelHash(png(8, 8, 1)), px)
    const { root, game } = makeRoot({ pixels: { [px]: 'static/upstream.png' } })
    try {
        writeFileSync(join(game, 'sources', 'ours.png'), png(8, 8, 1))
        const r = audit(root, game)
        assert.equal(r.code, 1)
        assert.match(r.out, /same decoded pixels/)
        rmSync(join(game, 'sources', 'ours.png'))
        writeFileSync(join(game, 'sources', 'ours.png'), png(9, 8, 1))
        assert.equal(audit(root, game).code, 0)
    } finally { rmSync(join(root, '..'), { recursive: true, force: true }) }
})
