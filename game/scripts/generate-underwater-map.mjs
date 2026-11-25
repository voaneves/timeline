// Gera o minimapa top-down 1024x1024 do Mundo Subaquatico (Fase 7):
// map-underwater.png e map-underwater.webp em game/static/ui/map/
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'static/ui/map')

const SIZE = 1024
const WORLD_SIZE = 192

function sampleSeabedHeight(wx, wz)
{
    const r = Math.hypot(wx, wz)
    const tPlaza = Math.min(1, Math.max(0, (r - 12) / 14))
    const plazaClear = tPlaza * tPlaza * (3 - 2 * tPlaza)

    const dunes = Math.sin(wx * 0.075) * Math.cos(wz * 0.08) * 1.1
        + Math.sin(wx * 0.035 + wz * 0.045) * 0.7

    const tWall = Math.min(1, Math.max(0, (r - 74) / 18))
    const wall = tWall * tWall * 12.0

    return dunes * plazaClear + wall
}

function toPx(wx, wz)
{
    return {
        x: (wx / WORLD_SIZE + 0.5) * SIZE,
        y: (wz / WORLD_SIZE + 0.5) * SIZE
    }
}

const CAPSULES = [
    { x: -32, z: -10, label: 'GitOps',  color: '#34cfc4' },
    { x:  32, z: -12, label: 'Data',    color: '#ffd166' },
    { x: -28, z: -48, label: 'WebGPU',  color: '#7ce8ff' },
    { x:  28, z: -48, label: 'OSS',     color: '#ff9f68' },
]

const RINGS = [
    [ -14,   2 ],
    [ -28, -20 ],
    [ -16, -42 ],
    [   0, -56 ],
    [  18, -42 ],
    [  30, -20 ],
    [  22,   4 ],
    [   8,  10 ],
]

const ARCHES = [
    { x: 0, z: -28, rotY: 0 },
    { x: -38, z: -32, rotY: 0.7 },
]

async function main()
{
    const rgba = Buffer.alloc(SIZE * SIZE * 4)

    // 1. Base batimetrica + causticas suaves top-down
    for(let py = 0; py < SIZE; py++)
    {
        const wz = (py / SIZE - 0.5) * WORLD_SIZE
        for(let px = 0; px < SIZE; px++)
        {
            const wx = (px / SIZE - 0.5) * WORLD_SIZE
            const h = sampleSeabedHeight(wx, wz)
            const r = Math.hypot(wx, wz)

            // Gradiente batimetrico: centro turquesa luminoso -> abismo azul nas paredes do recife
            const caustics = Math.pow(
                Math.max(0, Math.sin(wx * 0.16 + Math.cos(wz * 0.14) * 1.4) * Math.cos(wz * 0.15 - Math.sin(wx * 0.11) * 1.2)),
                2
            )

            const ridge = Math.min(1, Math.max(0, (h + 1.5) / 10.0))
            const rimMask = Math.min(1, Math.max(0, (r - 68) / 26))

            // Cores base: areia clara turquesa no centro, paredao azul profundo na borda
            let R = 16 + (1 - rimMask) * (24 + caustics * 32) + Math.max(0, h) * 3.8
            let G = 68 + (1 - rimMask) * (76 + caustics * 55) + Math.max(0, h) * 5.2
            let B = 108 + (1 - rimMask) * (62 + caustics * 52) + Math.max(0, h) * 4.5

            // Anel suave na praca central (Beacon + slalom start)
            const plazaGlow = Math.exp(-(r * r) / (26 * 26)) * 22
            R += plazaGlow * 0.5
            G += plazaGlow * 1.1
            B += plazaGlow * 1.2

            // Escurecer levemente o paredao externo para contrastar o recife
            R *= 1 - rimMask * 0.35
            G *= 1 - rimMask * 0.32
            B *= 1 - rimMask * 0.18

            // Curvas de nivel sutis
            const contour = Math.abs((h * 1.4) - Math.round(h * 1.4)) < 0.06 ? 1 : 0
            if(contour)
            {
                R += 12
                G += 26
                B += 30
            }

            const idx = (py * SIZE + px) * 4
            rgba[idx + 0] = Math.max(0, Math.min(255, Math.round(R)))
            rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(G)))
            rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(B)))
            rgba[idx + 3] = 255
        }
    }

    // 2. Camada vetorial SVG (rota do circuito 3D, argolas, arcos, 4 capsulas e farol central)
    const ringPts = RINGS.map(([ x, z ]) => toPx(x, z))
    const ringPath = ringPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z'
    const beacon = toPx(0, 24)

    // Vegetacao kelp em manchas suaves
    let kelpSvg = ''
    for(let i = 0; i < 42; i++)
    {
        const ang = i * 2.39996
        const rad = 18 + ((i * 19) % 48)
        const wx = Math.cos(ang) * rad
        const wz = Math.sin(ang) * rad
        if(Math.hypot(wx, wz - 24) < 10)
            continue
        const p = toPx(wx, wz)
        const radPx = 10 + (i % 4) * 5
        kelpSvg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${radPx}" fill="rgba(46, 178, 128, 0.28)" stroke="rgba(124, 242, 189, 0.25)" stroke-width="1"/>`
    }

    const archSvg = ARCHES.map((a) =>
    {
        const p = toPx(a.x, a.z)
        const deg = (-a.rotY * 180) / Math.PI
        return `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${deg.toFixed(1)})">
            <rect x="-24" y="-6" width="48" height="12" rx="6" fill="#2d4c66" stroke="#8beeff" stroke-width="2" opacity="0.85"/>
        </g>`
    }).join('\n')

    const ringSvg = ringPts.map((p, i) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10" fill="rgba(10,36,64,0.65)" stroke="${i === 0 ? '#ffe066' : '#34cfc4'}" stroke-width="3"/>
         <text x="${p.x.toFixed(1)}" y="${(p.y + 3.5).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="#ffffff">${i + 1}</text>`
    ).join('\n')

    const capSvg = CAPSULES.map((c) =>
    {
        const p = toPx(c.x, c.z)
        return `<g>
            <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="13" fill="rgba(6, 26, 48, 0.85)" stroke="${c.color}" stroke-width="3"/>
            <polygon points="${p.x.toFixed(1)},${(p.y - 6).toFixed(1)} ${(p.x + 6).toFixed(1)},${p.y.toFixed(1)} ${p.x.toFixed(1)},${(p.y + 6).toFixed(1)} ${(p.x - 6).toFixed(1)},${p.y.toFixed(1)}" fill="${c.color}"/>
        </g>`
    }).join('\n')

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
        <defs>
            <radialGradient id="beaconGlow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#9beeff" stop-opacity="0.85"/>
                <stop offset="100%" stop-color="#9beeff" stop-opacity="0"/>
            </radialGradient>
        </defs>
        <circle cx="${SIZE / 2}" cy="${SIZE / 2}" r="395" fill="none" stroke="rgba(139, 238, 255, 0.16)" stroke-width="2" stroke-dasharray="10 8"/>
        ${kelpSvg}
        <path d="${ringPath}" fill="none" stroke="rgba(52, 207, 196, 0.55)" stroke-width="4" stroke-dasharray="9 7"/>
        ${archSvg}
        ${ringSvg}
        ${capSvg}
        <circle cx="${beacon.x.toFixed(1)}" cy="${beacon.y.toFixed(1)}" r="34" fill="url(#beaconGlow)"/>
        <circle cx="${beacon.x.toFixed(1)}" cy="${beacon.y.toFixed(1)}" r="12" fill="#e9f4ff" stroke="#ffd166" stroke-width="3.5"/>
    </svg>`

    const composed = await sharp(rgba, { raw: { width: SIZE, height: SIZE, channels: 4 } })
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png({ compressionLevel: 9 })
        .toBuffer()

    await sharp(composed).toFile(resolve(outDir, 'map-underwater.png'))
    await sharp(composed).webp({ quality: 90 }).toFile(resolve(outDir, 'map-underwater.webp'))

    console.log('Generated map-underwater.png and map-underwater.webp cleanly.')
}

main().catch((err) =>
{
    console.error(err)
    process.exit(1)
})
