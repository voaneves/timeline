// Auditoria automatizada de producao (Gate G6):
// Sobe vite preview em dist/, verifica todos os assets referenciados (0 HTTP 404),
// audita strings legadas/ocultistas em sources/, e reporta o peso final de dist/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import projectsData from '../sources/data/projects.js'
import labData from '../sources/data/lab.js'

const gameDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcesDir = join(gameDir, 'sources')
const distDir = join(gameDir, 'dist')

function walk(dir, out = [])
{
    if(!existsSync(dir))
        return out
    for(const entry of readdirSync(dir, { withFileTypes: true }))
    {
        const full = join(dir, entry.name)
        if(entry.isDirectory())
            walk(full, out)
        else
            out.push(full)
    }
    return out
}

function collectRuntimeAssetUrls(env)
{
    const compressed = env.VITE_COMPRESSED === '1' || env.VITE_COMPRESSED === 'true'
    const compressedModels = compressed || env.VITE_COMPRESSED_MODELS !== '0'
    const compressedModelSuffix = compressedModels ? '-compressed' : ''
    const compressedTextureExtension = compressed ? 'ktx' : 'png'

    const urls = new Set()

    // 1. Game.js template literals
    const gameJs = readFileSync(join(sourcesDir, 'Game', 'Game.js'), 'utf8')
    const tmplRegex = /`([^`]+)`/g
    for(const m of gameJs.matchAll(tmplRegex))
    {
        let raw = m[1]
            .replaceAll('${compressedModelSuffix}', compressedModelSuffix)
            .replaceAll('${compressedTextureExtension}', compressedTextureExtension)
            .replaceAll('${cb}', '')
        if(/\.(glb|png|ktx|webp)(\?|$)/i.test(raw) && !raw.includes('${'))
            urls.add(raw.split('?')[0])
    }

    // 2. KonamiCode.js
    urls.add(`vehicle/oldSchool${compressedModelSuffix}.glb`)
    urls.add(`vehicle/default${compressedModelSuffix}.glb`)

    // 3. Projects & Lab images
    const imgExt = compressed ? 'ktx' : 'png'
    for(const p of projectsData)
    {
        for(const img of p.images || [])
            urls.add(`projects/images/${img.replace(/\.(ktx|png)$/, '')}.${imgExt}`)
    }
    for(const item of labData)
    {
        if(item.image)
            urls.add(`lab/images/${item.image.replace(/\.(ktx|png)$/, '')}.${imgExt}`)
        if(item.imageMini)
            urls.add(`lab/images/${item.imageMini.replace(/\.(ktx|png)$/, '')}.${imgExt}`)
    }

    // 4. Intro labels + Map + Landing kiosk
    for(const label of [ 'mouseKeyboard', 'touch', 'gamepadXbox', 'gamepadPlaystation' ])
        urls.add(`intro/${label}Label.${imgExt}`)
    for(const mapUrl of [ 'ui/map/map-day.webp', 'ui/map/map-night.webp', 'ui/map/map-underwater.webp' ])
        urls.add(mapUrl)

    // 5. Sounds referenced in Audio.js, OceanPassage, WorldManager, UnderwaterWorld e Areas
    const codeFiles = walk(sourcesDir).filter(f => f.endsWith('.js'))
    const soundRegex = /['"](sounds\/[^'"`]+\.mp3)['"]/g
    for(const f of codeFiles)
    {
        const text = readFileSync(f, 'utf8')
        for(const m of text.matchAll(soundRegex))
            urls.add(m[1])
    }

    // 6. Local asset refs in dist/index.html & dist/assets/*.css
    const distHtml = readFileSync(join(distDir, 'index.html'), 'utf8')
    for(const m of distHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g))
    {
        const ref = m[1]
        if(ref.startsWith('http') || ref.startsWith('#') || ref.startsWith('data:') || ref.startsWith('mailto:'))
            continue
        urls.add(ref.replace(/^\.\//, ''))
    }
    for(const cssFile of walk(join(distDir, 'assets')).filter(f => f.endsWith('.css')))
    {
        const css = readFileSync(cssFile, 'utf8')
        for(const m of css.matchAll(/url\(([^)]+)\)/g))
        {
            const ref = m[1].replace(/^['"]|['"]$/g, '')
            if(ref.startsWith('data:') || ref.startsWith('http'))
                continue
            urls.add(ref.replace(/^(\.\.\/)+/, '').replace(/^\.\//, ''))
        }
    }

    return [ ...urls ].sort()
}

function scanLegacyAndOccult()
{
    const forbidden = [
        { name: 'bruno-simon', re: /bruno[- ]simon/gi },
        { name: 'threejs-journey', re: /threejs-journey/gi },
        { name: 'google-analytics', re: /G-JMSN30BQ5J|googletagmanager/gi },
        { name: 'occult', re: /\b(satan|pentagram|demon|devil|lucifer|666)\b/gi },
    ]
    const hits = []
    for(const file of walk(sourcesDir))
    {
        if(!/\.(js|html|styl|css)$/i.test(file))
            continue
        const content = readFileSync(file, 'utf8')
        for(const rule of forbidden)
        {
            const m = content.match(rule.re)
            if(m)
                hits.push(`${rule.name} in ${file}: ${m.join(', ')}`)
        }
    }
    return hits
}

async function runPreviewAudit(urls)
{
    const child = spawn(process.execPath, [ './node_modules/vite/bin/vite.js', 'preview', '--port', '4175', '--strictPort' ], {
        cwd: gameDir,
        stdio: [ 'ignore', 'pipe', 'pipe' ]
    })
    let logs = ''
    child.stdout.on('data', d => { logs += d.toString() })
    child.stderr.on('data', d => { logs += d.toString() })

    const killTree = () =>
    {
        try
        {
            if(process.platform === 'win32')
                execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
            else
                child.kill('SIGTERM')
        }
        catch {}
    }

    try
    {
        const deadline = Date.now() + 15000
        let homeRes = null
        while(Date.now() < deadline)
        {
            try
            {
                homeRes = await fetch('http://127.0.0.1:4175/')
                if(homeRes.ok) break
            }
            catch {}
            await new Promise(r => setTimeout(r, 200))
        }
        if(!homeRes || !homeRes.ok)
            throw new Error(`vite preview nao respondeu em 15s:\n${logs}`)

        const homeHtml = await homeRes.text()
        const hasPreload = /<link[^>]*rel=["']preload["']/i.test(homeHtml)

        const missing = []
        for(const u of urls)
        {
            const target = `http://127.0.0.1:4175/${u.replace(/^\//, '')}`
            const res = await fetch(target, { method: 'HEAD' })
            if(res.status !== 200)
                missing.push(`${res.status} ${u}`)
        }

        return { homeStatus: homeRes.status, hasPreload, missing }
    }
    finally
    {
        killTree()
    }
}

async function main()
{
    if(!existsSync(distDir))
        throw new Error('dist/ nao existe; rode `npm run build` antes.')

    const env = loadEnv('production', gameDir, '')
    const urls = collectRuntimeAssetUrls(env)
    const preview = await runPreviewAudit(urls)
    const legacyHits = scanLegacyAndOccult()

    const distFiles = walk(distDir)
    let totalBytes = 0
    let musicBytes = 0
    let glbTotal = 0
    let glbCompressed = 0
    let ktxCount = 0
    for(const f of distFiles)
    {
        const sz = statSync(f).size
        totalBytes += sz
        if(f.replaceAll('\\', '/').includes('/sounds/musics/'))
            musicBytes += sz
        if(f.endsWith('.glb')) glbTotal++
        if(f.endsWith('-compressed.glb')) glbCompressed++
        if(f.endsWith('.ktx')) ktxCount++
    }

    console.log(JSON.stringify({
        checkedUrls: urls.length,
        homeStatus: preview.homeStatus,
        hasPreload: preview.hasPreload,
        missingUrls: preview.missing,
        legacyHits,
        distTotalMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
        distWithoutMusicsMB: Number(((totalBytes - musicBytes) / (1024 * 1024)).toFixed(2)),
        glbTotal,
        glbCompressed,
        ktxCount,
    }, null, 2))

    if(preview.hasPreload || preview.missing.length > 0 || legacyHits.length > 0)
        process.exitCode = 1
}

main().catch((err) =>
{
    console.error(err)
    process.exit(1)
})
