// Valida o contrato dos .glb (plano 3D, secao 6.3). Uso: node scripts/verify-glb.mjs [--strict]
// Erros fazem exit 1; pendencias (avisos) so fazem exit 1 com --strict.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const strict = process.argv.includes('--strict')
const errors = []
const warnings = []

const readHeader = (file) =>
{
    const buffer = readFileSync(resolve(root, file))
    if(buffer.readUInt32LE(0) !== 0x46546C67)
        throw new Error(`${file}: nao e um GLB`)
    const length = buffer.readUInt32LE(12)
    return JSON.parse(buffer.subarray(20, 20 + length).toString('utf8'))
}

const areasJson = readHeader('static/areas/areas.glb')
const respawnsJson = readHeader('static/respawns/respawnsReferences.glb')
const areaNames = new Set(areasJson.nodes.map(node => node.name))
const respawnNames = new Set(respawnsJson.nodes.map(node => node.name))

// 1. Grupos de area
const areas = [ 'landing', 'career', 'projects', 'lab', 'social', 'timeMachine', 'behindTheScene', 'achievements', 'circuit', 'bowling', 'cookie', 'altar', 'toilet' ]
for(const area of areas)
    if(!areaNames.has(area))
        errors.push(`grupo de area ausente: ${area}`)

// 2. refs criticos (prefixos que precisam existir em algum no)
const refs = [ 'refYear', 'refLine', 'refImages', 'refCenter', 'refZoneBounding', 'refZoneFrustum', 'refLettersPhysicalDynamic', 'refCounter', 'refAltar' ]
for(const ref of refs)
    if(![ ...areaNames ].some(name => name.startsWith(ref)))
        errors.push(`ref critico ausente: ${ref}*`)

// 3. nos legados (pendencia da T4.2 + limpeza Fase 5)
const legacy = [ ...areaNames ].filter(name => /^(baguira|sudo|boy|refSkullEyes)/.test(name))
if(legacy.length)
    warnings.push(`nos legados ainda presentes em areas.glb (${legacy.length}): ${legacy.join(', ')}`)

const terrainJson = readHeader('static/terrain/terrain.glb')
const terrainPosAccIdx = terrainJson.meshes?.[0]?.primitives?.[0]?.attributes?.POSITION
const terrainVertCount = terrainPosAccIdx !== undefined ? terrainJson.accessors?.[terrainPosAccIdx]?.count : 0
if(terrainVertCount !== 16641)
    errors.push(`terrain.glb deve ter 16641 vertices (129x129), encontrado: ${terrainVertCount}`)

// 4. respawns usados pelo Map.js
const respawns = [ 'achievements', 'altar', 'behindTheScene', 'bowling', 'career', 'circuit', 'cookie', 'lab', 'landing', 'projects', 'social', 'timeMachine' ]
for(const respawn of respawns)
    if(![ ...respawnNames ].some(name => name.toLowerCase() === `respawn${respawn}`.toLowerCase()))
        errors.push(`respawn ausente: respawn${respawn}`)

// 5. material palette, sem textura base64 embutida
if(!areasJson.materials.some(material => material.name === 'palette'))
    errors.push('material "palette" ausente')
for(const image of areasJson.images ?? [])
    if(image.uri?.startsWith('data:') && image.uri.length > 100_000)
        errors.push('imagem base64 grande embutida no areas.glb')

for(const message of errors)
    console.error(`ERRO: ${message}`)
for(const message of warnings)
    console.warn(`AVISO: ${message}`)

console.log(`verify:glb ${errors.length} erro(s), ${warnings.length} aviso(s)`)
process.exit(errors.length || (strict && warnings.length) ? 1 : 0)
