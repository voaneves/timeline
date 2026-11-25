import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/**
 * Gera os rótulos de intro (static/intro/*Label.png), 256x128, em PT-BR.
 * Mesmo formato dos originais: texto branco sobre fundo preto opaco (o jogo lê só o canal R como máscara).
 * Texto via sharp (Pango) com a fonte Pally-Bold do projeto; seta e símbolos de botão via SVG.
 *
 * Uso: node scripts/generate-intro-labels.mjs
 * (os .ktx continuam EN até rodar `npm run compress`)
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'static', 'intro')
const fontfile = path.join(root, 'static', 'fonts', 'Pally-Bold.ttf')

const W = 256
const H = 128

// Seta desenhada à mão, canto inferior esquerdo (aponta para o botão de som)
const arrow = `<path d="M92 80 C 70 76, 44 84, 30 106" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
<path d="M30 106 L 48 104 M30 106 L 33 88" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`

const circleSymbol = (cx, cy, r, inner) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="4"/>${inner}`
const buttonA = (cx, cy, r) => circleSymbol(cx, cy, r, `<path d="M${cx - r * 0.45} ${cy + r * 0.5} L${cx} ${cy - r * 0.55} L${cx + r * 0.45} ${cy + r * 0.5} M${cx - r * 0.25} ${cy + r * 0.12} H${cx + r * 0.25}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`)
const buttonCross = (cx, cy, r) => circleSymbol(cx, cy, r, `<path d="M${cx - r * 0.45} ${cy - r * 0.45} L${cx + r * 0.45} ${cy + r * 0.45} M${cx + r * 0.45} ${cy - r * 0.45} L${cx - r * 0.45} ${cy + r * 0.45}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`)

// Linhas de texto: { text, size, x (centro), y (centro) }
const labels = [
    { file: 'mouseKeyboardLabel', lines: [ 'CLIQUE PARA', 'COMEÇAR' ] },
    { file: 'touchLabel', lines: [ 'TOQUE PARA', 'COMEÇAR' ] },
    { file: 'gamepadXboxLabel', lines: [ 'PRESSIONE', 'PARA COMEÇAR' ], symbol: buttonA, symbolAfterFirst: true },
    { file: 'gamepadPlaystationLabel', lines: [ 'PRESSIONE', 'PARA COMEÇAR' ], symbol: buttonCross, symbolAfterFirst: true }
]

const renderText = async (text, maxWidth, size) =>
{
    const render = (s) => sharp({
        text: {
            text: `<span foreground="white" size="${s * 1024}">${text}</span>`,
            fontfile,
            font: 'Pally Bold',
            rgba: true,
            dpi: 72
        }
    }).png().toBuffer({ resolveWithObject: true })

    let result = await render(size)
    while(result.info.width > maxWidth && size > 12)
    {
        size -= 2
        result = await render(size)
    }
    return { ...result, size }
}

const buildLabel = async ({ file, lines, symbol, symbolAfterFirst }) =>
{
    const areaLeft = 86
    const areaRight = W - 6
    const centerX = (areaLeft + areaRight) / 2
    const maxWidth = areaRight - areaLeft
    const symbolR = 17

    const composites = []

    // Tamanho comum às duas linhas (o menor que cabe em todas)
    let commonSize = 46
    for(let i = 0; i < lines.length; i++)
    {
        const reserve = (i === 0 && symbol && symbolAfterFirst) ? symbolR * 2 + 8 : 0
        const probe = await renderText(lines[i], maxWidth - reserve, 46)
        commonSize = Math.min(commonSize, probe.size)
    }
    const rowY = [ 8, 70 ]

    for(let i = 0; i < lines.length; i++)
    {
        const reserve = (i === 0 && symbol && symbolAfterFirst) ? symbolR * 2 + 8 : 0
        const { data, info } = await renderText(lines[i], maxWidth - reserve, commonSize)

        const left = Math.round(reserve ? areaLeft + (maxWidth - reserve - info.width) / 2 + 0 : centerX - info.width / 2)
        const top = Math.round(rowY[i] + (50 - info.height) / 2)
        composites.push({ input: data, left: Math.max(0, left), top: Math.max(0, top) })

        if(reserve)
        {
            // Símbolo à direita da primeira linha
            const cx = Math.max(0, left) + info.width + 8 + symbolR
            const cy = rowY[i] + 25
            composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${symbol(cx, cy, symbolR)}</svg>`), left: 0, top: 0 })
        }
    }

    composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${arrow}</svg>`), left: 0, top: 0 })

    const buffer = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
        .composite(composites)
        .removeAlpha()
        .ensureAlpha()
        .png()
        .toBuffer()

    fs.writeFileSync(path.join(outDir, `${file}.png`), buffer)
    console.log(`ok ${file}.png`)
}

for(const label of labels)
    await buildLabel(label)
