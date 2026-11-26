import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/**
 * Gera as 6 texturas RG HD (4x) de static/career/ (R = texto emissivo, G = contorno).
 * Calcula font-size pela largura util (sem depender de textLength ignorado pelo librsvg)
 * e valida automaticamente margem lateral vazia para garantir 0 recortes.
 */
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'career')
const flip = process.argv.includes('--flip')
const SCALE = 4

const blocks = [
    { file: 'careerHetic',           w: 316, h: 60, line1: 'ORIGENS · ARAGUAÍNA/TO',     line2: '1994–2011 · Ponto Interativo' },
    { file: 'careerUzik',            w: 168, h: 60, line1: 'UNICAMP',                    line2: '2012–2016 · ONGs · IC' },
    { file: 'careerImmersiveGarden', w: 340, h: 60, line1: 'COCA-COLA FEMSA & KRONES',   line2: '2017–2019 · Alemanha · Trainee' },
    { file: 'careerIRLTeacher',      w: 268, h: 92, line1: 'DAMÁSIO & DADOS',            line2: '2019–2021 · IBM Data Science' },
    { file: 'careerOnlineTeacher',   w: 332, h: 92, line1: 'APPS, WEB & SEBRAE',         line2: '2022–2024 · ALI · Casamento' },
    { file: 'careerFreelancer',      w: 240, h: 60, line1: 'TRANSFORMAÇÃO DIGITAL',      line2: '2022–HOJE · Open Source' }
]

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// Estima largura proporcional em Arial Bold maiusculo/misto com folga segura para evitar overflow
const estimateCharFactor = (text) =>
{
    const upperCount = (text.match(/[A-ZÀ-ÚMW]/g) || []).length
    const upperRatio = upperCount / Math.max(1, text.length)
    return 0.56 + upperRatio * 0.16
}

const fitFontSize = (text, targetPx, maxWidthPx) =>
{
    const factor = estimateCharFactor(text)
    const fitted = Math.floor(maxWidthPx / Math.max(1, text.length * factor))
    return Math.max(18, Math.min(targetPx, fitted))
}

const buildSvg = ({ w, h, line1, line2 }) =>
{
    const W = w * SCALE
    const H = h * SCALE
    const maxWidth = W * 0.84

    const size1 = fitFontSize(line1, Math.round(H * 0.34), maxWidth)
    const size2 = fitFontSize(line2, Math.round(H * 0.21), maxWidth)
    const y1 = Math.round(H * 0.36)
    const y2 = Math.round(H * 0.74)
    const strokeWidth = Math.max(6, Math.round(H * 0.045))

    const lines = [
        { text: line1, size: size1, y: y1 },
        { text: line2, size: size2, y: y2 }
    ]

    const texts = (fill, stroke) => lines.map(l =>
    {
        const strokeAttr = stroke
            ? ` stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"`
            : ' stroke="none"'
        return `<text x="${W / 2}" y="${l.y}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${l.size}" fill="${fill}"${strokeAttr}>${escape(l.text)}</text>`
    }).join('\n')

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#000000"/>
${texts('#00ff00', '#00ff00')}
${texts('#ff0000', null)}
</svg>`
}

for(const block of blocks)
{
    const W = block.w * SCALE
    const H = block.h * SCALE
    let image = sharp(Buffer.from(buildSvg(block)), { density: 96 }).resize(W, H).ensureAlpha()
    if(flip)
        image = image.flip()

    const target = path.join(outDir, `${block.file}.png`)
    await image.png({ compressionLevel: 9 }).toFile(target)

    // Verificacao de margem lateral vazia (3% esquerda e direita sem pixels nao-pretos)
    const { data, info } = await sharp(target).raw().toBuffer({ resolveWithObject: true })
    const marginCols = Math.max(4, Math.floor(info.width * 0.03))
    let edgeHits = 0
    for(let y = 0; y < info.height; y++)
    {
        for(let x = 0; x < marginCols; x++)
        {
            const iL = (y * info.width + x) * info.channels
            const iR = (y * info.width + (info.width - 1 - x)) * info.channels
            if(data[iL] > 10 || data[iL + 1] > 10 || data[iR] > 10 || data[iR + 1] > 10)
                edgeHits++
        }
    }
    if(edgeHits > 0)
        throw new Error(`Recorte detectado em ${block.file}.png (${edgeHits} pixels na margem lateral).`)

    console.log(`${block.file}.png ${info.width}x${info.height} ${info.channels}ch (marginCheck: OK)`)
}
