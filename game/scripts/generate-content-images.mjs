// Gera as imagens de conteudo (projetos, lab, telas da maquina do tempo) como cards SVG -> PNG.
// Uso: node scripts/generate-content-images.mjs
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONT = "'Schibsted Grotesk', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
const C = { navy: '#12487a', deep: '#0b2f52', teal: '#34cfc4', sand: '#f4d38c', coral: '#ff5a36', white: '#f7fbff' }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Motivos decorativos (desenhados em 960x540)
const motifs = {
    contrast: (a, b) => `
        <rect x="560" y="120" width="170" height="170" rx="22" fill="${C.white}"/>
        <rect x="660" y="190" width="170" height="170" rx="22" fill="${C.deep}" stroke="${a}" stroke-width="4"/>
        <circle cx="700" cy="150" r="26" fill="${a}"/><circle cx="780" cy="330" r="26" fill="${b}"/>
        <text x="600" y="235" font-size="70" font-weight="800" fill="${C.deep}" font-family="${FONT}">Aa</text>
        <text x="700" y="305" font-size="70" font-weight="800" fill="${C.white}" font-family="${FONT}">Aa</text>`,
    snake: (a, b) => `
        <path d="M560 380 h140 v-90 h-90 v-80 h200 v140 h60" fill="none" stroke="${a}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="820" cy="350" r="16" fill="${b}"/><circle cx="805" cy="430" r="14" fill="${C.coral}"/>`,
    coin: (a, b) => `
        <circle cx="690" cy="260" r="110" fill="${b}"/><circle cx="690" cy="260" r="84" fill="none" stroke="${C.deep}" stroke-width="8"/>
        <text x="690" y="292" font-size="96" font-weight="800" text-anchor="middle" fill="${C.deep}" font-family="${FONT}">R$</text>
        <circle cx="820" cy="390" r="46" fill="${a}"/><circle cx="580" cy="400" r="30" fill="${C.coral}"/>`,
    pad: (a, b) => `
        <rect x="560" y="200" width="300" height="170" rx="70" fill="${C.white}"/>
        <rect x="610" y="262" width="70" height="22" rx="6" fill="${C.deep}"/><rect x="634" y="238" width="22" height="70" rx="6" fill="${C.deep}"/>
        <circle cx="770" cy="250" r="16" fill="${C.coral}"/><circle cx="805" cy="290" r="16" fill="${a}"/>`,
    bars: (a, b) => `
        <rect x="560" y="330" width="60" height="100" rx="8" fill="${a}"/><rect x="640" y="270" width="60" height="160" rx="8" fill="${b}"/>
        <rect x="720" y="200" width="60" height="230" rx="8" fill="${C.coral}"/><rect x="800" y="140" width="60" height="290" rx="8" fill="${C.white}"/>`,
    line: (a, b) => `
        <polyline points="560,400 640,320 720,350 800,230 870,170" fill="none" stroke="${a}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
        <g fill="${b}"><circle cx="640" cy="320" r="14"/><circle cx="720" cy="350" r="14"/><circle cx="800" cy="230" r="14"/><circle cx="870" cy="170" r="14"/></g>`,
    timeline: (a, b) => `
        <line x1="580" y1="270" x2="880" y2="270" stroke="${C.white}" stroke-width="8" stroke-linecap="round"/>
        <g fill="${a}"><circle cx="600" cy="270" r="22"/><circle cx="700" cy="270" r="22"/><circle cx="800" cy="270" r="22"/></g>
        <circle cx="870" cy="270" r="22" fill="${C.coral}"/>
        <rect x="580" y="170" width="90" height="50" rx="10" fill="${b}"/><rect x="740" y="320" width="90" height="50" rx="10" fill="${b}"/>`,
    code: (a, b) => `
        <path d="M640 200 L560 270 L640 340" fill="none" stroke="${a}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M780 200 L860 270 L780 340" fill="none" stroke="${b}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="740" y1="180" x2="680" y2="360" stroke="${C.coral}" stroke-width="18" stroke-linecap="round"/>`,
}

function splitTitle(title) {
    if (title.length <= 14 || !title.includes(' ')) return [title]
    const cut = title.lastIndexOf(' ', 14) > 0 ? title.lastIndexOf(' ', 14) : title.indexOf(' ')
    return [title.slice(0, cut), title.slice(cut + 1)]
}

function cardSvg({ w, h, title, subtitle, tag, motif, variant = 0, accent = C.teal }) {
    const grad = [[C.navy, C.deep], [C.deep, C.navy], [C.navy, '#0e5a7e']][variant % 3]
    const b = variant % 2 ? C.sand : C.teal
    const lines = splitTitle(title)
    const titleSize = lines.some((l) => l.length > 11) ? 76 : 92
    const ty = 260 - (lines.length - 1) * 40
    const titleSvg = lines.map((l, i) => `<text x="70" y="${ty + i * (titleSize + 6)}" font-size="${titleSize}" font-weight="800" fill="${C.white}" font-family="${FONT}">${esc(l)}</text>`).join('')
    const subY = ty + (lines.length - 1) * (titleSize + 6) + 70
    const tagY = ty - titleSize - 30
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 960 540">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${grad[0]}"/><stop offset="1" stop-color="${grad[1]}"/></linearGradient></defs>
  <rect width="960" height="540" fill="url(#g)"/>
  <path d="M0 470 Q 120 430 240 470 T 480 470 T 720 470 T 960 470 V540 H0Z" fill="${accent}" opacity=".28"/>
  <path d="M0 500 Q 120 465 240 500 T 480 500 T 720 500 T 960 500 V540 H0Z" fill="${accent}" opacity=".5"/>
  <circle cx="860" cy="80" r="46" fill="${C.sand}" opacity=".9"/>
  ${tag ? `<rect x="70" y="${tagY - 28}" width="${tag.length * 14 + 40}" height="40" rx="20" fill="${accent}"/><text x="90" y="${tagY}" font-size="22" font-weight="700" fill="${C.deep}" font-family="${FONT}">${esc(tag)}</text>` : ''}
  ${titleSvg}
  <text x="70" y="${subY}" font-size="34" fill="${C.sand}" font-family="${FONT}">${esc(subtitle)}</text>
  <rect x="70" y="${subY + 30}" width="120" height="8" rx="4" fill="${C.coral}"/>
  <g transform="translate(200 50) scale(.78)">${(motifs[motif] || motifs.code)(accent, b)}</g>
  <text x="70" y="515" font-size="22" fill="${C.white}" opacity=".7" font-family="${FONT}">voaneves.github.io</text>
</svg>`
}

const tasks = []
const add = (dir, name, opts, w = 960, h = 540) => tasks.push({ dir, name, w, h, svg: cardSvg({ w, h, ...opts }) })

// Projetos (16 imagens)
const projects = [
    ['dtcg-contrast', 'dtcg-contrast', 'Design Tokens', 'contrast', C.teal, ['Contraste WCAG · APCA', 'Tokens em OKLCH', 'Formato DTCG']],
    ['snake-arena', 'snake-arena', 'RL Benchmark', 'snake', C.teal, ['Agentes DQN em PyTorch', 'Arena de aprendizado', 'Reinforcement Learning']],
    ['meu-poupig', 'Meu Poupig', 'EdTech Game', 'coin', C.sand, ['Educação Financeira', 'HTML · CSS · JavaScript', 'Jogo para crianças']],
    ['js-games', 'js-games', 'Open Source', 'pad', C.teal, ['4 jogos clássicos', 'PWA · Vanilla JS', 'Zero frameworks']],
    ['xbox-sales', 'xbox-sales', 'Dashboard BI', 'bars', C.sand, ['Excel + VBA', 'CSV em 1 clique']],
    ['financial-sample', 'Financial Sample', 'Analytics', 'line', C.teal, ['Power BI', 'Dataset Microsoft']],
]
for (const [slug, title, tag, motif, accent, subs] of projects)
    subs.forEach((subtitle, i) => add('static/projects/images', `${slug}-${i + 1}`, { title, subtitle, tag, motif, variant: i, accent }))

// Lab (6 x 2)
const lab = [
    ['lab-dtcg', 'DTCG Contrast', 'OKLCH · WCAG · APCA', 'contrast', C.teal],
    ['lab-snake-dqn', 'Snake Arena', 'DQN · PyTorch', 'snake', C.teal],
    ['lab-js-games', 'JS Games', 'PWA · Vanilla JS', 'pad', C.sand],
    ['lab-poupig', 'Meu Poupig', 'Finanças para crianças', 'coin', C.sand],
    ['lab-timeline-2d', 'Timeline 2D', 'Acessível · #carreira', 'timeline', C.teal],
    ['lab-github', 'Código Aberto', 'github.com/voaneves', 'code', C.teal],
]
for (const [name, title, subtitle, motif, accent] of lab) {
    const o = { title, subtitle, tag: 'Lab & Dados', motif, accent }
    add('static/lab/images', name, o)
    add('static/lab/images', `${name}-mini`, o, 240, 136)
}

// Telas CRT da maquina do tempo (140x124)
function crt(title, sub, motif) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="124" viewBox="0 0 140 124">
  <rect width="140" height="124" fill="${C.deep}"/>
  <rect width="140" height="14" fill="${C.navy}"/>
  <rect x="6" y="4" width="6" height="6" fill="${C.coral}"/><rect x="16" y="4" width="6" height="6" fill="${C.sand}"/><rect x="26" y="4" width="6" height="6" fill="${C.teal}"/>
  ${motif}
  <text x="70" y="88" font-size="14" font-weight="800" text-anchor="middle" fill="${C.white}" font-family="${FONT}">${esc(title)}</text>
  <text x="70" y="102" font-size="9" text-anchor="middle" fill="${C.sand}" font-family="${FONT}">${esc(sub)}</text>
  <rect x="40" y="110" width="60" height="4" fill="${C.teal}"/>
</svg>`
}
const tl = `<line x1="24" y1="48" x2="116" y2="48" stroke="${C.white}" stroke-width="3"/><rect x="22" y="42" width="12" height="12" fill="${C.teal}"/><rect x="52" y="42" width="12" height="12" fill="${C.teal}"/><rect x="82" y="42" width="12" height="12" fill="${C.sand}"/><rect x="108" y="42" width="12" height="12" fill="${C.coral}"/>`
const pt = `<rect x="38" y="26" width="64" height="40" fill="${C.white}"/><rect x="42" y="30" width="56" height="26" fill="${C.navy}"/><rect x="52" y="68" width="36" height="4" fill="${C.sand}"/><rect x="62" y="36" width="6" height="14" fill="${C.teal}"/><rect x="74" y="42" width="6" height="8" fill="${C.coral}"/>`
tasks.push({ dir: 'static/timeMachine', name: 'timeMachineScreenFolio', w: 140, h: 124, svg: crt('Timeline 2D', 'voaneves.github.io', tl) })
tasks.push({ dir: 'static/timeMachine', name: 'timeMachineScreenMGS', w: 140, h: 124, svg: crt('Ponto Interativo', 'Marco · 2005', pt) })

for (const t of tasks) {
    const dir = path.join(root, t.dir)
    fs.mkdirSync(dir, { recursive: true })
    await sharp(Buffer.from(t.svg)).resize(t.w, t.h).png({ compressionLevel: 9 }).toFile(path.join(dir, `${t.name}.png`))
}
console.log(`${tasks.length} imagens geradas`)
