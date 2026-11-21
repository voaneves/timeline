// Build-time asset compression: Meshopt GLB + lossless PNG optimization (plan T2.4, §5.7).
// CLI: node scripts/compress.mjs [--in <file|dir>] [--out <file|dir>] [--suffix -compressed] [--in-place] [--check] [--json]
//
// Preserves all glTF node names (ref*, cuboid*, trimesh*, hull*, cylinder*, tube*, ball*),
// empty reference nodes (never prunes leaf nodes), node.getExtras() (mass, friction,
// restitution, category, yaw, pitch, lookAt, etc.), COLOR_0 vertex colors, normals, UVs,
// animations, and unquantized parent-local positions for hull*/trimesh* colliders.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'
import { BufferUtils, Format, Logger, NodeIO, PropertyType } from '@gltf-transform/core'
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions'
import { dedup, meshopt } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_KEEP_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])

// CRC32 lookup table for valid PNG chunk construction
const CRC_TABLE = new Uint32Array(256)
for(let n = 0; n < 256; n++)
{
    let c = n
    for(let k = 0; k < 8; k++)
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    CRC_TABLE[n] = c >>> 0
}

function crc32(_buf)
{
    let c = 0xffffffff
    for(let i = 0; i < _buf.length; i++)
        c = CRC_TABLE[(c ^ _buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}

function makePngChunk(_type, _data)
{
    const len = _data.length
    const out = Buffer.alloc(12 + len)
    out.writeUInt32BE(len, 0)
    out.write(_type, 4, 4, 'latin1')
    if(len > 0)
        _data.copy(out, 8)
    const crc = crc32(out.subarray(4, 8 + len))
    out.writeUInt32BE(crc, 8 + len)
    return out
}

// Lossless PNG optimization in pure Node: keeps IHDR, PLTE, tRNS, IDAT, IEND,
// strips non-essential ancillary metadata chunks (tEXt, zTXt, iTXt, tIME, pHYs, etc.),
// re-deflates scanlines at zlib level 9, and picks whichever representation is smaller.
export function compressPngBuffer(_buffer)
{
    const buf = Buffer.isBuffer(_buffer) ? _buffer : Buffer.from(_buffer)
    if(buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG))
        throw new Error('compressPngBuffer: invalid PNG signature')

    let pos = 8
    let ihdr = null
    const paletteChunks = []
    const idatParts = []
    let sawIend = false

    while(pos + 8 <= buf.length)
    {
        const len = buf.readUInt32BE(pos)
        if(pos + 12 + len > buf.length)
            throw new Error('compressPngBuffer: truncated PNG chunk')
        const type = buf.toString('latin1', pos + 4, pos + 8)
        const data = buf.subarray(pos + 8, pos + 8 + len)

        if(type === 'IHDR')
            ihdr = Buffer.from(data)
        else if(type === 'PLTE' || type === 'tRNS')
            paletteChunks.push({ type, data: Buffer.from(data) })
        else if(type === 'IDAT')
            idatParts.push(data)
        else if(type === 'IEND')
        {
            sawIend = true
            break
        }
        pos += 12 + len
    }

    if(!ihdr || !idatParts.length || !sawIend)
        throw new Error('compressPngBuffer: missing required PNG chunks (IHDR/IDAT/IEND)')

    const origIdat = Buffer.concat(idatParts)
    const rawScanlines = inflateSync(origIdat)
    const redeflated = deflateSync(rawScanlines, { level: 9 })
    const bestIdat = redeflated.length < origIdat.length ? redeflated : origIdat

    const outChunks = [
        PNG_SIG,
        makePngChunk('IHDR', ihdr),
        ...paletteChunks.map(c => makePngChunk(c.type, c.data)),
        makePngChunk('IDAT', bestIdat),
        makePngChunk('IEND', Buffer.alloc(0)),
    ]
    const candidate = Buffer.concat(outChunks)
    return candidate.length < buf.length ? candidate : Buffer.from(buf)
}

function compactJsonNumbers(_value)
{
    if(typeof _value === 'number')
        return Number.isInteger(_value) ? _value : Number(_value.toFixed(6))
    if(Array.isArray(_value))
        return _value.map(compactJsonNumbers)
    if(_value && typeof _value === 'object')
    {
        const out = {}
        for(const [k, v] of Object.entries(_value))
            out[k] = compactJsonNumbers(v)
        return out
    }
    return _value
}

function packGlbFromJsonDoc(_json, _resources)
{
    const json = compactJsonNumbers(_json)
    for(const key of ['cameras', 'images', 'samplers', 'skins', 'textures', 'animations', 'extras'])
    {
        const val = json[key]
        if(val && (Array.isArray(val) ? val.length === 0 : Object.keys(val).length === 0))
            delete json[key]
    }

    const header = new Uint32Array([0x46546c67, 2, 12])
    const jsonText = JSON.stringify(json)
    const jsonChunkData = BufferUtils.pad(BufferUtils.encodeText(jsonText), 0x20)
    const jsonChunkHeader = BufferUtils.toView(new Uint32Array([jsonChunkData.byteLength, 0x4e4f534a]))
    const jsonChunk = BufferUtils.concat([jsonChunkHeader, jsonChunkData])
    header[2] += jsonChunk.byteLength

    const binBuffer = Object.values(_resources)[0]
    if(!binBuffer || !binBuffer.byteLength)
        return Buffer.from(BufferUtils.concat([BufferUtils.toView(header), jsonChunk]))

    const binChunkData = BufferUtils.pad(binBuffer, 0x00)
    const binChunkHeader = BufferUtils.toView(new Uint32Array([binChunkData.byteLength, 0x004e4942]))
    const binChunk = BufferUtils.concat([binChunkHeader, binChunkData])
    header[2] += binChunk.byteLength

    return Buffer.from(BufferUtils.concat([BufferUtils.toView(header), jsonChunk, binChunk]))
}

// Meshopt GLB compression using @gltf-transform/core, @gltf-transform/extensions,
// @gltf-transform/functions, and meshoptimizer.
// Notice: meshopt() internally runs reorder() + quantize() + EXTMeshoptCompression.
export async function compressGlbBuffer(_buffer, { level = 'medium' } = {})
{
    await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready])

    const inBytes = Buffer.isBuffer(_buffer) ? _buffer : Buffer.from(_buffer)
    const io = new NodeIO()
        .setLogger(new Logger(Logger.Verbosity.SILENT))
        .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
        .registerDependencies({
            'meshopt.encoder': MeshoptEncoder,
            'meshopt.decoder': MeshoptDecoder,
        })

    const document = await io.readBinary(new Uint8Array(inBytes.buffer, inBytes.byteOffset, inBytes.byteLength))
    const root = document.getRoot()

    // Preserve unquantized parent-local vertex positions for hull* and trimesh* physics collider nodes
    // so Objects.getFromModel() reads exact float32 positions in parent-local space.
    const rawColliderBackups = new Map()
    for(const node of root.listNodes())
    {
        if(/^(hull|trimesh)/i.test(node.getName()) && node.getMesh())
        {
            const mesh = node.getMesh()
            rawColliderBackups.set(node, {
                translation: node.getTranslation().slice(),
                rotation: node.getRotation().slice(),
                scale: node.getScale().slice(),
                primitives: mesh.listPrimitives().map((prim) =>
                {
                    const pos = prim.getAttribute('POSITION')
                    return pos ? new Float32Array(pos.getArray()) : null
                }),
            })
        }
    }

    // Strip redundant internal mesh and accessor names (preserving all Node, Scene, Material, Animation names)
    // so identical geometries can merge cleanly during deduplication and produce compact JSON.
    for(const mesh of root.listMeshes())
        mesh.setName('')
    for(const accessor of root.listAccessors())
        accessor.setName('')

    // Dedup accessors/meshes/textures/materials, then apply meshopt (which internally runs reorder + quantize).
    // Empty leaf reference nodes (refRespawn*, refCamera*, cuboid*, etc.) are never pruned.
    await document.transform(
        dedup({
            propertyTypes: [
                PropertyType.ACCESSOR,
                PropertyType.MESH,
                PropertyType.TEXTURE,
                PropertyType.MATERIAL,
            ],
        }),
        meshopt({
            encoder: MeshoptEncoder,
            level,
        }),
    )

    // Restore exact unquantized float32 positions and node TRS on hull* / trimesh* collider nodes
    for(const [node, backup] of rawColliderBackups.entries())
    {
        node.setTranslation(backup.translation)
        node.setRotation(backup.rotation)
        node.setScale(backup.scale)
        const srcMesh = node.getMesh()
        if(!srcMesh)
            continue
        const colliderMesh = srcMesh.listParents().filter(p => p.propertyType === PropertyType.NODE).length > 1
            ? srcMesh.clone()
            : srcMesh
        colliderMesh.listPrimitives().forEach((prim, index) =>
        {
            const rawPos = backup.primitives[index]
            const posAttr = prim.getAttribute('POSITION')
            if(rawPos && posAttr)
            {
                const restored = posAttr.clone()
                restored.setArray(rawPos).setNormalized(false)
                prim.setAttribute('POSITION', restored)
            }
        })
        node.setMesh(colliderMesh)
    }

    // Group vertex attribute accessors of equal byteStride into shared meshopt bufferViews
    // across primitives rather than one bufferView per primitive, saving ~6.5 KB of JSON + padding.
    const origSetHas = Set.prototype.has
    let jsonDoc
    try
    {
        Set.prototype.has = function(_value)
        {
            if(_value === 'ARRAY_BUFFER' && this.size === 1)
                return false
            return origSetHas.call(this, _value)
        }
        jsonDoc = await io.writeJSON(document, { format: Format.GLB })
    }
    finally
    {
        Set.prototype.has = origSetHas
    }

    return packGlbFromJsonDoc(jsonDoc.json, jsonDoc.resources)
}

function walkSupportedFiles(_target)
{
    const fullTarget = resolve(_target)
    if(!existsSync(fullTarget))
        throw new Error(`compress: input path does not exist: ${_target}`)
    const st = statSync(fullTarget)
    if(st.isFile())
        return [{ full: fullTarget, rel: basename(fullTarget) }]

    const out = []
    function walk(_dir)
    {
        for(const entry of readdirSync(_dir, { withFileTypes: true }))
        {
            const full = join(_dir, entry.name)
            if(entry.isDirectory())
                walk(full)
            else if(entry.isFile())
            {
                const ext = extname(entry.name).toLowerCase()
                if(ext === '.glb' || ext === '.png')
                    out.push({ full, rel: relative(fullTarget, full).split(sep).join('/') })
            }
        }
    }
    walk(fullTarget)
    return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

function resolveOutputPath(_entry, _inPath, { outPath = null, suffix = '', inPlace = false, isDirInput = false } = {})
{
    if(inPlace)
        return _entry.full

    const ext = extname(_entry.full)
    const stem = basename(_entry.full, ext)
    const suffixedName = `${stem}${suffix}${ext}`

    if(!outPath)
        return join(dirname(_entry.full), suffixedName)

    const resolvedOut = resolve(outPath)
    if(isDirInput)
    {
        const relDir = dirname(_entry.rel)
        return relDir === '.' ? join(resolvedOut, suffixedName) : join(resolvedOut, relDir, suffixedName)
    }

    if(existsSync(resolvedOut) && statSync(resolvedOut).isDirectory())
        return join(resolvedOut, suffixedName)

    if(!extname(resolvedOut))
        return join(resolvedOut, suffixedName)

    if(suffix)
    {
        const outExt = extname(resolvedOut)
        const outStem = basename(resolvedOut, outExt)
        return join(dirname(resolvedOut), `${outStem}${suffix}${outExt}`)
    }
    return resolvedOut
}

export async function compressAssetFile(_inFile, _outFile = _inFile, { check = false, level = 'medium' } = {})
{
    const fullIn = resolve(_inFile)
    const inBytes = readFileSync(fullIn)
    const ext = extname(fullIn).toLowerCase()

    let outBytes
    if(ext === '.glb')
        outBytes = await compressGlbBuffer(inBytes, { level })
    else if(ext === '.png')
        outBytes = compressPngBuffer(inBytes)
    else
        throw new Error(`compressAssetFile: unsupported extension "${ext}" (${_inFile})`)

    const bytesIn = inBytes.byteLength
    const bytesOut = outBytes.byteLength
    const savedBytes = bytesIn - bytesOut
    const reductionPct = bytesIn > 0 ? Number(((1 - bytesOut / bytesIn) * 100).toFixed(2)) : 0

    if(!check && _outFile)
    {
        const fullOut = resolve(_outFile)
        mkdirSync(dirname(fullOut), { recursive: true })
        writeFileSync(fullOut, outBytes)
    }

    return {
        input: _inFile,
        output: check ? null : _outFile,
        type: ext.slice(1),
        bytesIn,
        bytesOut,
        savedBytes,
        reductionPct,
    }
}

export async function runCompressCli(_argv = process.argv.slice(2))
{
    const opt = (_name, _def = null) =>
    {
        const i = _argv.indexOf(_name)
        return i >= 0 && i + 1 < _argv.length ? _argv[i + 1] : _def
    }
    const inPath = opt('--in', 'static')
    const outPath = opt('--out', null)
    const inPlace = _argv.includes('--in-place')
    const check = _argv.includes('--check')
    const asJson = _argv.includes('--json')
    const defaultSuffix = (!outPath && !inPlace && !check) ? '-compressed' : ''
    const suffix = opt('--suffix', defaultSuffix)

    const fullIn = resolve(inPath)
    const isDirInput = existsSync(fullIn) && statSync(fullIn).isDirectory()
    const entries = walkSupportedFiles(fullIn).filter(e => !suffix || !basename(e.full, extname(e.full)).endsWith(suffix))

    const files = []
    let totalIn = 0
    let totalOut = 0

    for(const entry of entries)
    {
        const targetOut = check ? null : resolveOutputPath(entry, fullIn, { outPath, suffix, inPlace, isDirInput })
        const res = await compressAssetFile(entry.full, targetOut, { check })
        res.name = entry.rel
        files.push(res)
        totalIn += res.bytesIn
        totalOut += res.bytesOut
    }

    const totalSaved = totalIn - totalOut
    const totalReductionPct = totalIn > 0 ? Number(((1 - totalOut / totalIn) * 100).toFixed(2)) : 0
    const summary = {
        count: files.length,
        bytesIn: totalIn,
        bytesOut: totalOut,
        savedBytes: totalSaved,
        reductionPct: totalReductionPct,
        check,
        files,
    }

    if(asJson)
        console.log(JSON.stringify(summary, null, 2))
    else
    {
        for(const f of files)
            console.log(`compress [${f.type}]: ${f.name} ${f.bytesIn} B -> ${f.bytesOut} B (${f.reductionPct}% smaller)`)
        console.log(`compress total: ${summary.count} file(s), ${totalIn} B -> ${totalOut} B (${totalReductionPct}% smaller)`)
    }

    return summary
}

if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
    runCompressCli().catch((err) =>
    {
        console.error(err)
        process.exit(1)
    })
}
