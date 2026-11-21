import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { pngPixelHash } from '../scripts/audit-originality.mjs'
import { compressAssetFile, compressGlbBuffer, compressPngBuffer, runCompressCli } from '../scripts/compress.mjs'
import { hashAssets } from '../scripts/hash-assets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const gameDir = join(here, '..')

function parseGlbWithThree(_buffer)
{
    return new Promise((resolve, reject) =>
    {
        const loader = new GLTFLoader()
        loader.setMeshoptDecoder(MeshoptDecoder)
        const ab = _buffer.buffer.slice(_buffer.byteOffset, _buffer.byteOffset + _buffer.byteLength)
        loader.parse(ab, '', resolve, reject)
    })
}

function collectNodes(_scene)
{
    const map = new Map()
    _scene.updateMatrixWorld(true)
    _scene.traverse((obj) =>
    {
        if(obj !== _scene)
            map.set(obj.name, obj)
    })
    return map
}

test('T2.4 greybox.glb compresses >= 60% smaller, preserves all 66 nodes/refs/colliders/extras via Three.js MeshoptDecoder, and integrates with hashAssets manifest', async () =>
{
    const root = mkdtempSync(join(tmpdir(), 'compress-greybox-'))
    try
    {
        const srcGreybox = join(gameDir, 'static', 'eras', 'greybox', 'greybox.glb')
        const tmpStatic = join(root, 'static')
        const tmpOut = join(root, 'dist')
        const dstGreybox = join(tmpStatic, 'eras', 'greybox', 'greybox.glb')
        mkdirSync(dirname(dstGreybox), { recursive: true })
        copyFileSync(srcGreybox, dstGreybox)

        const origBytes = readFileSync(srcGreybox)
        const report = await compressAssetFile(dstGreybox, dstGreybox)
        const compBytes = readFileSync(dstGreybox)

        // 1. >= 60% size reduction on greybox.glb
        assert.equal(report.bytesIn, origBytes.byteLength)
        assert.equal(report.bytesOut, compBytes.byteLength)
        assert.ok(
            report.reductionPct >= 60,
            `Expected greybox.glb reduction >= 60%, got ${report.reductionPct}% (${report.bytesIn} B -> ${report.bytesOut} B)`,
        )

        // Original static/eras/greybox/greybox.glb must remain untouched
        assert.equal(readFileSync(srcGreybox).byteLength, origBytes.byteLength)

        // 2. Load both original and compressed GLBs via Three.js GLTFLoader + MeshoptDecoder
        const [origGltf, compGltf] = await Promise.all([
            parseGlbWithThree(origBytes),
            parseGlbWithThree(compBytes),
        ])

        const origNodes = collectNodes(origGltf.scene)
        const compNodes = collectNodes(compGltf.scene)
        assert.equal(origNodes.size, 66)
        assert.equal(compNodes.size, 66)

        // Every node name, parent hierarchy, reference empty, collider transform, and userData extra must be preserved
        for(const [name, origObj] of origNodes.entries())
        {
            const compObj = compNodes.get(name)
            assert.ok(compObj, `Missing node after meshopt compression: ${name}`)

            const origParent = origObj.parent === origGltf.scene ? '<scene>' : origObj.parent?.name
            const compParent = compObj.parent === compGltf.scene ? '<scene>' : compObj.parent?.name
            assert.equal(compParent, origParent, `Parent mismatch on node ${name}`)

            assert.deepEqual(compObj.userData, origObj.userData, `userData mismatch on node ${name}`)

            // Reference empties and primitive colliders keep exact local transforms
            if(/^(ref|cuboid|tube|cylinder|ball|hull|trimesh)/i.test(name) || !origObj.isMesh)
            {
                assert.ok(origObj.position.distanceTo(compObj.position) < 1e-4, `Position drift on ${name}`)
                assert.ok(origObj.scale.distanceTo(compObj.scale) < 1e-4, `Scale drift on ${name}`)
                assert.ok(Math.abs(Math.abs(origObj.quaternion.dot(compObj.quaternion)) - 1) < 1e-4, `Rotation drift on ${name}`)
            }

            if(origObj.isMesh)
            {
                assert.ok(compObj.isMesh, `Expected ${name} to remain a Mesh`)
                assert.equal(
                    compObj.geometry.attributes.position.count,
                    origObj.geometry.attributes.position.count,
                    `Vertex count mismatch on ${name}`,
                )
            }
        }

        // Explicitly check required reference points, colliders, and dynamic crates with userData.mass
        for(const refName of ['refRespawn', 'refCamera1', 'refCamera2', 'refPlatformPath1', 'refPlatformPath2', 'refLinePoint1', 'refLinePoint9'])
            assert.ok(compNodes.has(refName), `Missing reference node ${refName}`)

        for(let i = 1; i <= 4; i++)
        {
            const crate = compNodes.get(`crate${i}PhysicalDynamic`)
            assert.ok(crate, `Missing crate${i}PhysicalDynamic`)
            assert.equal(crate.userData.mass, 6)
            assert.equal(crate.userData.friction, 0.6)
            assert.equal(crate.userData.restitution, 0.1)
            assert.ok(compNodes.has(`cuboidCrate${i}`), `Missing cuboidCrate${i}`)
        }

        // Also verify t21b_shapes.glb (vertex colors COLOR_0, normals, UVs) when present
        const shapesPath = join(gameDir, 'blender', 'out', 't21b_shapes.glb')
        if(existsSync(shapesPath))
        {
            const shapesOrig = readFileSync(shapesPath)
            const shapesComp = await compressGlbBuffer(shapesOrig)
            assert.ok(shapesComp.byteLength < shapesOrig.byteLength * 0.5, 'Expected >50% reduction on t21b_shapes.glb')
            const [sOrigGltf, sCompGltf] = await Promise.all([
                parseGlbWithThree(shapesOrig),
                parseGlbWithThree(shapesComp),
            ])
            const sOrigNodes = collectNodes(sOrigGltf.scene)
            const sCompNodes = collectNodes(sCompGltf.scene)
            assert.equal(sCompNodes.size, sOrigNodes.size)
            for(const [name, oMesh] of sOrigNodes.entries())
            {
                const cMesh = sCompNodes.get(name)
                assert.ok(cMesh, `Missing shape node ${name}`)
                if(oMesh.isMesh)
                {
                    assert.deepEqual(
                        Object.keys(cMesh.geometry.attributes).sort(),
                        Object.keys(oMesh.geometry.attributes).sort(),
                        `Attributes mismatch on ${name}`,
                    )
                    assert.equal(
                        cMesh.geometry.attributes.position.count,
                        oMesh.geometry.attributes.position.count,
                        `Vertex count mismatch on ${name}`,
                    )
                }
            }
        }

        // 3. Manifest integration: hashAssets on compressed static dir emits hashed GLB and manifest entry
        const hashed = hashAssets({ staticDir: tmpStatic, outDir: tmpOut })
        const entry = hashed.assets['eras/greybox/greybox.glb']
        assert.ok(entry, 'eras/greybox/greybox.glb missing from asset manifest')
        assert.match(entry.file, /^assets\/greybox\.[0-9a-f]{8}\.glb$/)
        assert.equal(entry.bytes, compBytes.byteLength)

        const manifestFile = join(tmpOut, hashed.manifestName)
        assert.ok(existsSync(manifestFile), 'Manifest JSON file not written')
        const manifestJson = JSON.parse(readFileSync(manifestFile, 'utf8'))
        assert.equal(manifestJson.assets['eras/greybox/greybox.glb'].file, entry.file)

        const hashedGlbBytes = readFileSync(join(tmpOut, entry.file))
        assert.equal(hashedGlbBytes.byteLength, compBytes.byteLength)
        const manifestGltf = await parseGlbWithThree(hashedGlbBytes)
        assert.equal(collectNodes(manifestGltf.scene).size, 66)
    }
    finally
    {
        rmSync(root, { recursive: true, force: true })
    }
})

test('T2.4 lossless PNG compression preserves 100% identical RGBA pixels on palette.png and strips ancillary metadata chunks', async () =>
{
    const root = mkdtempSync(join(tmpdir(), 'compress-png-'))
    try
    {
        const palettePath = join(gameDir, 'static', 'palette.png')
        const origPng = readFileSync(palettePath)
        const origPixelHash = pngPixelHash(origPng)
        assert.ok(origPixelHash, 'Failed to compute pixel hash on static/palette.png')

        // Direct optimization on palette.png preserves exact pixels and never inflates byte count
        const compPng = compressPngBuffer(origPng)
        assert.ok(compPng.byteLength <= origPng.byteLength)
        assert.equal(pngPixelHash(compPng), origPixelHash)

        // Inject ancillary tEXt + pHYs chunks before IDAT and verify compressPngBuffer strips them losslessly
        const textData = Buffer.from('Comment\0voaneves-timeline-metadata-chunk-for-test', 'latin1')
        const crcTable = new Uint32Array(256)
        for(let n = 0; n < 256; n++)
        {
            let c = n
            for(let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
            crcTable[n] = c >>> 0
        }
        const crc32 = (_b) =>
        {
            let c = 0xffffffff
            for(let i = 0; i < _b.length; i++) c = crcTable[(c ^ _b[i]) & 0xff] ^ (c >>> 8)
            return (c ^ 0xffffffff) >>> 0
        }
        const textChunk = Buffer.alloc(12 + textData.length)
        textChunk.writeUInt32BE(textData.length, 0)
        textChunk.write('tEXt', 4, 4, 'latin1')
        textData.copy(textChunk, 8)
        textChunk.writeUInt32BE(crc32(textChunk.subarray(4, 8 + textData.length)), 8 + textData.length)

        // Insert tEXt right after IHDR (8 byte sig + 25 byte IHDR = offset 33)
        const bloatedPng = Buffer.concat([origPng.subarray(0, 33), textChunk, origPng.subarray(33)])
        assert.equal(pngPixelHash(bloatedPng), origPixelHash)

        const bloatedFile = join(root, 'palette-bloated.png')
        const outFile = join(root, 'palette-clean.png')
        writeFileSync(bloatedFile, bloatedPng)

        const summary = await runCompressCli(['--in', bloatedFile, '--out', outFile, '--json'])
        assert.equal(summary.count, 1)
        assert.ok(summary.bytesOut < summary.bytesIn, 'Expected bloated PNG to shrink after stripping tEXt')
        const cleanedPng = readFileSync(outFile)
        assert.equal(pngPixelHash(cleanedPng), origPixelHash)
        assert.ok(!cleanedPng.toString('latin1').includes('voaneves-timeline-metadata-chunk-for-test'))
    }
    finally
    {
        rmSync(root, { recursive: true, force: true })
    }
})
