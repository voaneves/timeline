import path from 'path'
import { fileURLToPath } from 'url'
import { spawn, spawnSync } from 'node:child_process'
import { glob } from 'glob'
import sharp from 'sharp'

const isWin = process.platform === 'win32'
const gameDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const toPosix = (p) => p.split('\\').join('/')

// Uso: node scripts/compress.js <pasta> [subpasta]   (ex.: static, static/career, ou sources)
const baseArg = process.argv[2]
if(!baseArg)
{
    console.error('Uso: node scripts/compress.js <pasta> [subpasta]')
    process.exit(1)
}
const subArg = process.argv[3] || ''
const directory = toPosix(path.resolve(gameDirectory, baseArg, subArg))
const MAX_CONCURRENCY = 4

// gltf-transform local (.cmd no Windows)
const gltfTransformBin = path.join(gameDirectory, 'node_modules', '.bin', isWin ? 'gltf-transform.cmd' : 'gltf-transform')

const run = (command, args) => new Promise((resolve) =>
{
    // .cmd no Windows exige shell; os argumentos aqui nao tem espacos nem metacaracteres, exceto caminhos (entre aspas).
    const quoted = isWin ? args.map(a => /\s/.test(String(a)) ? `"${a}"` : String(a)) : args
    const child = spawn(isWin ? `"${command}"` : command, quoted, { shell: isWin })
    child.stdout.on('data', data => console.log(`stdout: ${data}`))
    child.stderr.on('data', data => console.error(`stderr: ${data}`))
    child.on('error', error => { console.error(`erro: ${error.message}`); resolve(1) })
    child.on('close', code => resolve(code))
})

// Executa tarefas com no maximo MAX_CONCURRENCY em paralelo
const runPool = async(tasks) =>
{
    let next = 0
    const worker = async() =>
    {
        while(next < tasks.length)
        {
            const task = tasks[next++]
            await task()
        }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, tasks.length) }, worker))
}

const hasToktx = () =>
{
    const result = spawnSync(isWin ? 'where' : 'which', [ 'toktx' ], { stdio: 'ignore' })
    return result.status === 0
}

/**
 * Models
 */
{
    const files = (await glob(`${directory}/**/*.glb`)).map(toPosix).filter(p => !/-(draco|ktx|compressed)\.glb$/.test(p))
    const canKtx = hasToktx()
    if(!canKtx)
        console.warn('AVISO: toktx nao encontrado no PATH; etc1s (KTX2) sera pulado nos modelos. Instale o KTX-Software.')

    await runPool(files.map(inputFile => async() =>
    {
        const outputFile = inputFile.replace(/\.glb$/, '-compressed.glb')
        let dracoInput = inputFile

        if(canKtx)
        {
            const code = await run(gltfTransformBin, [ 'etc1s', inputFile, outputFile, '--quality', '255', '--verbose' ])
            if(code === 0)
                dracoInput = outputFile
            else
                console.warn(`AVISO: etc1s falhou em ${inputFile}; seguindo so com draco.`)
        }

        await run(gltfTransformBin, [
            'draco', dracoInput, outputFile,
            '--method', 'edgebreaker',
            '--quantization-volume', 'mesh',
            '--quantize-position', 12,
            '--quantize-normal', 6,
            '--quantize-texcoord', 6,
            '--quantize-color', 2,
            '--quantize-generic', 2
        ])
    }))
}

/**
 * Textures
 */
{
    if(!hasToktx())
    {
        console.warn('AVISO: toktx nao encontrado no PATH; compressao de texturas KTX2 pulada.')
    }
    else
    {
        const files = (await glob(`${directory}/**/*.{png,jpg}`, { ignore: '**/{ui,favicons,social}/**' })).map(toPosix)

        const defaultPreset = '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf srgb --target_type RGB'
        const presets = [
            [ /test.png$/,                            '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],

            [ /whispers\/whisperFlame.png$/,          '--nowarn --2d --t2 --encode uastc --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],
            [ /achievements\/glyphs.png$/,            '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],
            [ /areas\/satanStar.png$/,                '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],
            [ /floor\/slabs.png$/,                    '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],
            [ /foliage\/foliageSDF.png$/,             '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],
            [ /interactivePoints\/.+.png$/,           '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],
            [ /intro\/.+.png$/,                       '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],
            [ /jukebox\/jukeboxMusicNotes.png$/,      '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R --swizzle r001' ],
            [ /overlay\/overlayPattern.png$/,         '--nowarn --2d --t2 --encode uastc --assign_oetf linear' ],
            [ /palette.png$/,                         '--nowarn --2d --t2 --encode uastc --genmipmap --assign_oetf srgb --target_type RGB' ],
            [ /terrain\/terrain.png$/,                '--nowarn --2d --t2 --encode uastc --genmipmap --assign_oetf linear --target_type RGB' ],
            [ /career\/.+png$/,                       '--nowarn --2d --t2 --encode uastc --assign_oetf srgb --target_type RG' ],
            [ /whispers\/whisperFlame.png$/,          '--nowarn --2d --t2 --encode etc1s --qlevel 255 --assign_oetf linear --target_type R' ],
        ]

        await runPool(files.map(inputFile => async() =>
        {
            const ktx2File = inputFile.replace(/\.(png|jpg)$/, '.ktx')
            const preset = (presets.find(p => p[0].test(inputFile)) || [ null, defaultPreset ])[1]
            const code = await run('toktx', [ ...preset.split(' '), ktx2File, inputFile ])
            if(code !== 0)
                console.warn(`AVISO: toktx falhou em ${inputFile}`)
        }))
    }
}

/**
 * UI images
 */
{
    const files = (await glob(`${directory}/ui/**/*.{png,jpg}`)).map(toPosix)

    for(const inputFile of files)
    {
        const webpFile = inputFile.replace(/\.(png|jpg)$/, '.webp')

        await sharp(inputFile)
            .webp({ quality: 80 })
            .toFile(webpFile)
    }
}
