// Parity between the 2D page (index.html) and sources/data/content.json.
// INDEX_HTML=<path> points the test at another copy of the page (used to prove it fails on divergence).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { extractContent, readInput, DEFAULT_OUTPUT } from '../scripts/extract-content.mjs'

const html = readInput()
const committed = JSON.parse(readFileSync(DEFAULT_OUTPUT, 'utf8'))
const fresh = await extractContent(html)
// Independent of the parser: ids straight from the raw markup.
const rawIds = (re) => [...html.matchAll(re)].map((m) => m[1])

test('counts: 5 eras, 15 entries, 6 projects, contact', () => {
    assert.equal(committed.eras.length, 5)
    assert.equal(committed.eras.flatMap((e) => e.entries).length, 15)
    assert.equal(committed.projects.length, 6)
    assert.ok(committed.contact.text.length > 0)
    assert.ok(committed.contact.links.length >= 1)
})

test('entry ids match the DOM ids', () => {
    const ids = committed.eras.flatMap((e) => e.entries.map((x) => x.id))
    assert.deepEqual(ids, rawIds(/<article[^>]*\bid="(e-[^"]+)"/g))
})

test('project ids match the DOM ids', () => {
    assert.deepEqual(committed.projects.map((p) => p.id), rawIds(/<article[^>]*\bid="(p-[^"]+)"/g))
})

test('contact section exists in the DOM', () => {
    assert.ok(/<section[^>]*\bid="contato"/.test(html))
})

test('every entry and project is complete', () => {
    for(const e of committed.eras.flatMap((e) => e.entries)) assert.ok(e.id && e.datetime && e.label && e.title, e.id)
    for(const p of committed.projects) assert.ok(p.id && p.title && p.summary && p.stack.length && p.live && p.repo, p.id)
})

test('content.json is up to date with index.html (run: npm run content)', () => {
    assert.deepEqual(committed, fresh)
})
