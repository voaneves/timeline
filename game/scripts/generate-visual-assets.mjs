// Gera os assets visuais da Fase 2 (T2.3) por codigo (sharp + SVG), com a paleta costeira.
// Uso: node scripts/generate-visual-assets.mjs
// Gera: palette.png (ajuste cirurgico a partir de resources/palette-original.png), areas/satanStar.png,
// circuit/brand.png, ui/achievements/rewards/*.{png,webp}, ui/previews/*.{png,webp}, social/share-image.png
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stat = (...p) => path.join(root, 'static', ...p)
const FONT = "'Schibsted Grotesk', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
const C = { navy: '#12487a', deep: '#0b2f52', teal: '#34cfc4', sky: '#68e1fd', sand: '#f4d38c', cream: '#f7e5c2', coral: '#ff5a36', gold: '#ffd166', green: '#76c442', white: '#f7fbff' }

const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)
const saveBoth = async(buffer, dir, name, webpOptions = { quality: 88 }) =>
{
    fs.mkdirSync(dir, { recursive: true })
    await sharp(buffer).png({ compressionLevel: 9 }).toFile(path.join(dir, `${name}.png`))
    await sharp(buffer).webp(webpOptions).toFile(path.join(dir, `${name}.webp`))
}

// ---------------------------------------------------------------- palette.png
// Ajuste cirurgico: so swatches inteiros, sem anti-aliasing, mesmas posicoes (x, y). Sempre parte do original.
const paletteChanges = {
    '7c7691': [0x6f, 0x8a, 0xa3], // cinza arroxeado -> cinza azulado costeiro
    'abae2b': [0x9c, 0xc4, 0x3a], // oliva amarelado -> verde vivo (mesma familia)
}
const setPalette = async() =>
{
    const original = path.join(root, 'resources', 'palette-original.png')
    if(!fs.existsSync(original)) throw new Error('Falta resources/palette-original.png (backup da palette)')
    const { data, info } = await sharp(original).raw().toBuffer({ resolveWithObject: true })
    const out = Buffer.from(data)
    for(let i = 0; i < info.width * info.height; i++)
    {
        const o = i * info.channels
        const key = [data[o], data[o + 1], data[o + 2]].map(v => v.toString(16).padStart(2, '0')).join('')
        const next = paletteChanges[key]
        if(next) { out[o] = next[0]; out[o + 1] = next[1]; out[o + 2] = next[2] }
    }
    await sharp(out, { raw: { width: info.width, height: info.height, channels: info.channels } }).png({ compressionLevel: 9 }).toFile(stat('palette.png'))
}

// ---------------------------------------------------------------- satanStar.png (vortice geometrico, canal R)
const setVortex = async() =>
{
    const cx = 64, cy = 64
    let arms = ''
    const N = 5
    for(let a = 0; a < N; a++)
    {
        const pts = []
        for(let t = 0; t <= 1.0001; t += 0.04)
        {
            const r = 6 + t * 50
            const ang = (a / N) * Math.PI * 2 + t * 2.1
            pts.push(`${(cx + Math.cos(ang) * r).toFixed(2)},${(cy + Math.sin(ang) * r).toFixed(2)}`)
        }
        arms += `<polyline points="${pts.join(' ')}" fill="none" stroke="#fff" stroke-width="${a % 2 ? 4 : 5.5}" stroke-linecap="round"/>`
    }
    const star = []
    for(let i = 0; i < 10; i++)
    {
        const r = i % 2 ? 10 : 22
        const ang = -Math.PI / 2 + (i / 10) * Math.PI * 2
        star.push(`${(cx + Math.cos(ang) * r).toFixed(2)},${(cy + Math.sin(ang) * r).toFixed(2)}`)
    }
    const body = `<rect width="128" height="128" fill="#000"/>
        <circle cx="${cx}" cy="${cy}" r="60" fill="none" stroke="#fff" stroke-width="3"/>
        ${arms}
        <polygon points="${star.join(' ')}" fill="#000" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
        <circle cx="${cx}" cy="${cy}" r="3.5" fill="#fff"/>`
    const { data, info } = await sharp(svg(128, 128, body)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    // Canal R carrega a mascara; G e B espelham para evitar franjas se algum shader ler outro canal
    const out = Buffer.alloc(128 * 128 * 3)
    for(let i = 0; i < 128 * 128; i++) { const v = data[i * info.channels]; out[i * 3] = v; out[i * 3 + 1] = v; out[i * 3 + 2] = v }
    await sharp(out, { raw: { width: 128, height: 128, channels: 3 } }).png({ compressionLevel: 9 }).toFile(stat('areas', 'satanStar.png'))
}

// ---------------------------------------------------------------- circuit/brand.png (512x128)
const setBrand = async() =>
{
    const stripes = (color) => `
        <rect x="70" y="8" width="250" height="9" rx="4" fill="${color}" opacity="0.9"/>
        <rect x="395" y="8" width="105" height="9" rx="4" fill="${color}" opacity="0.9"/>
        <rect x="330" y="52" width="62" height="7" rx="3" fill="${color}" opacity="0.7"/>
        <rect x="420" y="84" width="90" height="9" rx="4" fill="${color}" opacity="0.9"/>
        <rect x="70" y="110" width="170" height="9" rx="4" fill="${color}" opacity="0.9"/>
        <rect x="280" y="110" width="120" height="9" rx="4" fill="${color}" opacity="0.9"/>`
    const body = `<rect width="512" height="128" fill="#16405f"/>
        ${stripes(C.teal)}
        <g transform="translate(14 14)">
            <circle cx="50" cy="50" r="46" fill="none" stroke="${C.sand}" stroke-width="8"/>
            <path d="M50 22 V50 L70 64" fill="none" stroke="${C.coral}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="50" cy="50" r="6" fill="${C.white}"/>
        </g>
        <text x="132" y="82" font-family="${FONT}" font-size="46" font-weight="800" fill="${C.white}" letter-spacing="1">TIMELINE</text>`
    fs.mkdirSync(stat('circuit'), { recursive: true })
    await sharp(svg(512, 128, body)).png({ compressionLevel: 9 }).toFile(stat('circuit', 'brand.png'))
}

// ---------------------------------------------------------------- pinturas do carro (thumbnails 80x80)
const paints = {
    red: ['#ff5a36', '#d92b4b'],
    orange: ['#1dd3c6', '#0d6e9e'],
    white: ['#fffaf0', '#d4cfc4'],
    black: ['#4a5568', '#1a202c'],
    flames: ['#ffd166', '#ff4d2e'],
    abyssal: ['#0a1f4d', '#050a24'],
}
const setRewards = async() =>
{
    for(const [key, [a, b]] of Object.entries(paints))
    {
        let extra = ''
        if(key === 'flames')
        {
            extra = `<path d="M0 80 C10 52 20 62 26 36 C32 54 42 44 44 18 C52 40 60 34 62 50 C68 40 74 46 80 28 V80 Z" fill="#ff4d2e" opacity="0.55"/>
                <path d="M0 80 C14 62 24 70 32 52 C38 66 48 58 52 40 C58 58 68 54 80 44 V80 Z" fill="#ffd166" opacity="0.5"/>`
        }
        else if(key === 'abyssal')
        {
            let stars = ''
            for(let i = 0; i < 26; i++)
            {
                const x = (Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * 80
                const y = (Math.sin(i * 78.233) * 24634.6345 % 1 + 1) % 1 * 80
                stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + (i % 3) * 0.5).toFixed(1)}" fill="${i % 4 === 0 ? '#2ae8ff' : '#fff'}" opacity="0.85"/>`
            }
            extra = `<radialGradient id="g" cx="50%" cy="50%" r="55%"><stop offset="60%" stop-color="#2ae8ff" stop-opacity="0"/><stop offset="100%" stop-color="#2ae8ff" stop-opacity="0.55"/></radialGradient>
                <rect width="80" height="80" fill="url(#g)"/>${stars}`
        }
        const body = `<defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
            <rect width="80" height="80" fill="url(#p)"/>${extra}`
        await saveBoth(await sharp(svg(80, 80, body)).png().toBuffer(), stat('ui', 'achievements', 'rewards'), key, { quality: 90 })
    }
}

// ---------------------------------------------------------------- previews 600x600 + share-image 1200x630
const monsterTruck = (x, y, s, body, trim) => `
    <g transform="translate(${x} ${y}) scale(${s})">
        <ellipse cx="0" cy="62" rx="120" ry="20" fill="#0b2f52" opacity="0.28"/>
        <path d="M-92 14 L-70 -20 L-16 -34 L38 -34 L76 -4 L96 6 L96 38 L-92 38 Z" fill="${body}"/>
        <path d="M-60 -16 L-12 -28 L10 -28 L10 0 L-64 0 Z" fill="#cfeefe" opacity="0.9"/>
        <path d="M18 -28 L38 -28 L64 -2 L18 0 Z" fill="#a8d4ff" opacity="0.9"/>
        <rect x="-96" y="30" width="196" height="16" rx="6" fill="${trim}"/>
        <rect x="76" y="14" width="22" height="8" rx="3" fill="#ffe066"/>
        <rect x="-98" y="14" width="10" height="8" rx="3" fill="#ff6f91"/>
        <g fill="#1a202c"><circle cx="-56" cy="46" r="30"/><circle cx="58" cy="46" r="30"/></g>
        <g fill="${C.sand}"><circle cx="-56" cy="46" r="13"/><circle cx="58" cy="46" r="13"/></g>
        <g fill="${trim}"><circle cx="-56" cy="46" r="5"/><circle cx="58" cy="46" r="5"/></g>
    </g>`

const tree = (x, y, s, c1, c2) => `
    <g transform="translate(${x} ${y}) scale(${s})">
        <rect x="-8" y="0" width="16" height="70" rx="5" fill="#8a5a3c"/>
        <circle cx="0" cy="-12" r="52" fill="${c1}"/><circle cx="-34" cy="12" r="34" fill="${c1}"/><circle cx="34" cy="12" r="34" fill="${c1}"/>
        <circle cx="-12" cy="-28" r="22" fill="${c2}" opacity="0.8"/><circle cx="24" cy="-2" r="14" fill="${c2}" opacity="0.8"/>
    </g>`

// Motivo central por area (desenhado em torno de (300, 270))
const previewMotifs = {
    home: () => tree(210, 215, 1.2, '#ff6f91', '#ffb3c6') + `<rect x="330" y="300" width="130" height="14" rx="6" fill="#8a5a3c"/><rect x="340" y="262" width="110" height="34" rx="8" fill="#b3957a"/><rect x="342" y="314" width="10" height="26" fill="#6b4630"/><rect x="438" y="314" width="10" height="26" fill="#6b4630"/>`,
    achievements: () => `<path d="M230 150 h140 v70 a70 70 0 0 1 -140 0 Z" fill="${C.gold}"/><path d="M230 165 h-36 a36 36 0 0 0 36 56 M370 165 h36 a36 36 0 0 1 -36 56" fill="none" stroke="${C.gold}" stroke-width="14" stroke-linecap="round"/><rect x="284" y="288" width="32" height="44" fill="#f2b705"/><rect x="246" y="332" width="108" height="26" rx="8" fill="#b3957a"/><path d="M300 170 l14 30 33 4 -25 22 8 32 -30 -17 -30 17 8 -32 -25 -22 33 -4 Z" fill="#fff3db"/>`,
    controls: () => `<rect x="180" y="200" width="240" height="140" rx="60" fill="#f7fbff"/><rect x="226" y="248" width="14" height="44" fill="${C.navy}"/><rect x="211" y="263" width="44" height="14" fill="${C.navy}"/><circle cx="352" cy="252" r="14" fill="${C.coral}"/><circle cx="384" cy="282" r="14" fill="${C.teal}"/><circle cx="320" cy="282" r="14" fill="${C.gold}"/>`,
    options: () => `<g fill="none" stroke="#f7fbff" stroke-width="16" stroke-linecap="round"><path d="M200 220 H400 M200 280 H400 M200 340 H400"/></g><circle cx="270" cy="220" r="20" fill="${C.coral}"/><circle cx="340" cy="280" r="20" fill="${C.gold}"/><circle cx="250" cy="340" r="20" fill="${C.teal}"/>`,
    circuit: () => `<path d="M180 330 C170 220 260 180 330 210 C400 240 420 320 360 350 C300 380 190 380 180 330 Z" fill="none" stroke="#3d4a5a" stroke-width="48"/><path d="M180 330 C170 220 260 180 330 210 C400 240 420 320 360 350 C300 380 190 380 180 330 Z" fill="none" stroke="#f7fbff" stroke-width="4" stroke-dasharray="14 12"/><rect x="236" y="192" width="14" height="54" fill="#fff"/><path d="M236 192 h14 v14 h-14 z M250 206 h14 v14 h-14 z" fill="#1a202c"/>`,
    behindTheScene: () => `<g fill="none" stroke="#f7fbff" stroke-width="10" stroke-linejoin="round"><path d="M300 150 L420 220 V330 L300 400 L180 330 V220 Z"/><path d="M180 220 L300 290 L420 220 M300 290 V400"/></g><circle cx="300" cy="290" r="18" fill="#2ad4d9"/>`,
    easter: () => `<ellipse cx="300" cy="280" rx="74" ry="98" fill="#ffb3c6"/><path d="M228 262 q18 -22 36 0 t36 0 t36 0 t36 0" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/><path d="M230 308 q18 -22 36 0 t36 0 t36 0 t34 0" fill="none" stroke="${C.teal}" stroke-width="10" stroke-linecap="round"/><circle cx="276" cy="230" r="8" fill="${C.gold}"/><circle cx="332" cy="338" r="8" fill="${C.gold}"/>`,
    whispers: () => `<path d="M170 210 a60 60 0 0 1 60 -60 h140 a60 60 0 0 1 60 60 v70 a60 60 0 0 1 -60 60 h-90 l-60 50 v-50 a60 60 0 0 1 -50 -60 Z" fill="#f7fbff"/><circle cx="250" cy="245" r="14" fill="${C.teal}"/><circle cx="300" cy="245" r="14" fill="${C.gold}"/><circle cx="350" cy="245" r="14" fill="${C.coral}"/>`,
}

const previewBase = () =>
{
    let grid = ''
    for(let gx = 0; gx < 8; gx++) for(let gy = 0; gy < 8; gy++)
    {
        const x = 40 + gx * 78, y = 30 + gy * 78
        grid += `<path d="M${x - 5} ${y - 5} l10 10 m0 -10 l-10 10" stroke="#f7fbff" stroke-width="2" opacity="0.28"/>`
    }
    return `<defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2ad4d9"/><stop offset="1" stop-color="#12487a"/></linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0.7" stop-color="#fff3db" stop-opacity="0.9"/><stop offset="1" stop-color="#68e1fd" stop-opacity="0"/></radialGradient>
        <radialGradient id="ground" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#f7e5c2"/><stop offset="1" stop-color="#f4d38c"/></radialGradient>
    </defs>
    <rect width="600" height="600" fill="url(#sky)"/>${grid}
    <ellipse cx="300" cy="402" rx="262" ry="148" fill="url(#glow)"/>
    <ellipse cx="300" cy="396" rx="238" ry="128" fill="url(#ground)" stroke="#fff" stroke-width="5"/>
    <ellipse cx="300" cy="396" rx="238" ry="128" fill="none" stroke="#34cfc4" stroke-width="2" opacity="0.6"/>`
}

const setPreviews = async() =>
{
    for(const [name, motif] of Object.entries(previewMotifs))
    {
        const body = previewBase() + motif() + monsterTruck(330, 440, 0.8, name === 'circuit' ? '#1dd3c6' : '#ff5a36', '#1a202c')
        await saveBoth(await sharp(svg(600, 600, body)).png().toBuffer(), stat('ui', 'previews'), name, { quality: 86 })
    }
}

const setShare = async() =>
{
    let dots = ''
    for(let i = 0; i < 40; i++) dots += `<circle cx="${(i * 197) % 1200}" cy="${(i * 89) % 630}" r="${2 + (i % 3)}" fill="#fff" opacity="0.18"/>`
    const body = `<defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#68e1fd"/><stop offset="0.62" stop-color="#2ad4d9"/><stop offset="1" stop-color="#12487a"/></linearGradient>
        <linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e5c2"/><stop offset="1" stop-color="#f4d38c"/></linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#sky)"/>${dots}
    <circle cx="980" cy="150" r="70" fill="#fff3db"/>
    <path d="M0 470 C200 420 380 450 560 430 C760 410 980 450 1200 420 V630 H0 Z" fill="#76c442"/>
    <path d="M0 520 C220 480 420 510 640 490 C860 470 1020 500 1200 480 V630 H0 Z" fill="url(#road)"/>
    <path d="M0 560 C240 530 440 550 660 535 C860 520 1020 545 1200 530" fill="none" stroke="#fff" stroke-width="6" stroke-dasharray="26 22" opacity="0.7"/>
    ${tree(1060, 330, 1.5, '#2fa866', '#6cd464')}${tree(900, 380, 1.0, '#f2b705', '#ffe066')}${tree(1130, 400, 0.9, '#ff6f91', '#ffb3c6')}
    ${monsterTruck(760, 470, 1.55, '#ff5a36', '#1a202c')}
    <text x="70" y="250" font-family="${FONT}" font-size="104" font-weight="800" fill="#f7fbff">Victor Neves</text>
    <text x="74" y="322" font-family="${FONT}" font-size="46" font-weight="600" fill="#0b2f52">Linha do tempo e projetos</text>
    <rect x="74" y="352" width="190" height="10" rx="5" fill="#ff5a36"/>`
    fs.mkdirSync(stat('social'), { recursive: true })
    await sharp(svg(1200, 630, body)).png({ compressionLevel: 9 }).toFile(stat('social', 'share-image.png'))
}

await setPalette()
await setVortex()
await setBrand()
await setRewards()
await setPreviews()
await setShare()
console.log('Assets visuais gerados.')
