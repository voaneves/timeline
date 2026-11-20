// Reads the 2D page (source of truth) and writes sources/data/content.json.
// Usage: node scripts/extract-content.mjs [--check] [path/to/index.html]
//   env INDEX_HTML overrides the input; --check prints JSON to stdout instead of writing.
// Needs the `linkedom` package (resolved normally; LINKEDOM_DIR=<dir with node_modules> as fallback).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_INPUT = resolve(here, '..', '..', 'index.html')
export const DEFAULT_OUTPUT = resolve(here, '..', 'sources', 'data', 'content.json')

async function loadLinkedom() {
    try { return await import('linkedom') }
    catch (error) {
        if(!process.env.LINKEDOM_DIR) throw error
        const req = createRequire(join(resolve(process.env.LINKEDOM_DIR), 'noop.js'))
        return await import(pathToFileURL(req.resolve('linkedom')).href)
    }
}

const text = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

export async function extractContent(html) {
    const { parseHTML } = await loadLinkedom()
    const { document } = parseHTML(html)

    const eras = [...document.querySelectorAll('#carreira .era')].map((era) => {
        const h3 = era.querySelector('h3')
        return {
            n: Number(era.getAttribute('data-era')),
            id: h3?.id ?? null,
            name: era.getAttribute('data-era-name') ?? text(h3),
            years: text(era.querySelector('.era-years')),
            entries: [...era.querySelectorAll('article.entry')].map((a) => ({
                id: a.id,
                datetime: a.querySelector('time')?.getAttribute('datetime') ?? '',
                label: text(a.querySelector('time')),
                title: text(a.querySelector('h4')),
                body: [...a.querySelectorAll('p')].map(text).filter(Boolean).join('\n'),
            })),
        }
    })

    const projects = [...document.querySelectorAll('#projetos article.project')].map((p) => {
        const links = [...p.querySelectorAll('.links a')]
        const live = links.find((a) => a.classList.contains('btn-primary'))
        const repo = links.find((a) => !a.classList.contains('btn-primary'))
        return {
            id: p.id,
            title: text(p.querySelector('h3')),
            summary: text(p.querySelector('p:not(.meta)')),
            stack: [...p.querySelectorAll('.stack li')].map(text),
            live: live?.getAttribute('href') ?? null,
            repo: repo?.getAttribute('href') ?? null,
        }
    })

    const sec = document.querySelector('#contato')
    const contact = {
        id: 'contato',
        title: text(sec?.querySelector('h2')),
        text: text(sec?.querySelector('.contact-card > p')),
        links: [...(sec?.querySelectorAll('.contact-links a') ?? [])].map((a) => ({
            label: text(a),
            href: a.getAttribute('href'),
        })),
    }

    return { eras, projects, contact }
}

export function readInput(path = process.env.INDEX_HTML || DEFAULT_INPUT) {
    return readFileSync(path, 'utf8')
}

if(import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const args = process.argv.slice(2)
    const check = args.includes('--check')
    const input = args.find((a) => !a.startsWith('--'))
    const data = await extractContent(readInput(input))
    const json = JSON.stringify(data, null, 2) + '\n'
    if(check) process.stdout.write(json)
    else {
        mkdirSync(dirname(DEFAULT_OUTPUT), { recursive: true })
        writeFileSync(DEFAULT_OUTPUT, json)
        const n = data.eras.reduce((s, e) => s + e.entries.length, 0)
        console.log(`content.json: ${data.eras.length} eras, ${n} entries, ${data.projects.length} projects, ${data.contact.links.length} contact links`)
    }
}
