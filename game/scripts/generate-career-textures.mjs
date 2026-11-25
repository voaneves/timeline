import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/**
 * Gera as 6 texturas RG de static/career/ (R = texto emissivo, G = contorno).
 * As imagens ficam na mesma orientacao das originais (Game.js usa flipY = false).
 * Se aparecer invertido verticalmente no jogo, rode com --flip.
 */
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'career')
const flip = process.argv.includes('--flip')

const blocks = [
    { file: 'careerHetic',           w: 316, h: 60, line1: 'ORIGENS · ARAGUAÍNA/TO',     line2: '1994–2011 · Blog Ponto Interativo' },
    { file: 'careerUzik',            w: 168, h: 60, line1: 'UNICAMP',                    line2: '2012–2016 · ONGs · IC · Jr. MTE' },
    { file: 'careerImmersiveGarden', w: 340, h: 60, line1: 'COCA-COLA FEMSA & KRONES',   line2: '2017–2019 · Alemanha · Trainee' },
    { file: 'careerIRLTeacher',      w: 268, h: 92, line1: 'DAMÁSIO & DADOS',            line2: '2019–2021 · IBM Data Science' },
    { file: 'careerOnlineTeacher',   w: 332, h: 92, line1: 'APPS, WEB & SEBRAE',         line2: '2022–2024 · ALI · Casamento' },
    { file: 'careerFreelancer',      w: 240, h: 60, line1: 'TRANSFORMAÇÃO DIGITAL',      line2: '2022–HOJE · Produtos & Open Source' }
]

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const buildSvg = ({ w, h, line1, line2 }) =>
{
    const pad = 8
    const maxWidth = w - pad * 2
    const lines = [
        { text: line1, size: Math.round(h * 0.36), y: h * 0.42, weight: 700 },
        { text: line2, size: Math.round(h * 0.22), y: h * 0.80, weight: 700 }
    ]
    const strokeWidth = Math.max(2, h * 0.06)

    const texts = (fill, stroke) => lines.map(l =>
    {
        // Estimativa de largura; se estourar, comprime com textLength.
        const estimated = l.text.length * l.size * 0.58
        const fit = estimated > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : ''
        const strokeAttr = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"` : ' stroke="none"'
        return `<text x="${w / 2}" y="${l.y}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-weight="${l.weight}" font-size="${l.size}"${fit} fill="${fill}"${strokeAttr}>${escape(l.text)}</text>`
    }).join('')

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="#000000"/>
${texts('#00ff00', '#00ff00')}
${texts('#ff0000', null)}
</svg>`
}

for(const block of blocks)
{
    let image = sharp(Buffer.from(buildSvg(block)), { density: 72 }).resize(block.w, block.h).ensureAlpha()
    if(flip)
        image = image.flip()
    const target = path.join(outDir, `${block.file}.png`)
    await image.png().toFile(target)
    const meta = await sharp(target).metadata()
    console.log(`${block.file}.png ${meta.width}x${meta.height} ${meta.channels}ch`)
}
