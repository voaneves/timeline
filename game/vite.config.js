import 'dotenv/config'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import restart from 'vite-plugin-restart'
import wasm from 'vite-plugin-wasm'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const STYLE_ID_RE = /\.(styl|css|scss|sass|less)(\?|$)/i
const gameDir = dirname(fileURLToPath(import.meta.url))

const safeNodePolyfills = () =>
{
    const plugins = nodePolyfills()
    const injectPlugin = plugins.find(p => p.name === 'vite-plugin-node-polyfills:inject')
    const mainPlugin = plugins.find(p => p.name === 'vite-plugin-node-polyfills')

    if(injectPlugin && typeof injectPlugin.transform === 'function')
    {
        const origTransform = injectPlugin.transform
        const wrapped = function(code, id, options)
        {
            if(STYLE_ID_RE.test(id))
                return null
            return origTransform.call(this, code, id, options)
        }
        injectPlugin.transform = wrapped

        if(mainPlugin && typeof mainPlugin.config === 'function')
        {
            const origConfig = mainPlugin.config
            mainPlugin.config = function(...args)
            {
                const res = origConfig.apply(this, args)
                if(origTransform.filter)
                    wrapped.filter = { ...origTransform.filter, id: { exclude: STYLE_ID_RE } }
                return res
            }
        }
    }

    return plugins
}

function walkFiles(dir, out = [])
{
    if(!existsSync(dir))
        return out
    for(const entry of readdirSync(dir, { withFileTypes: true }))
    {
        const full = join(dir, entry.name)
        if(entry.isDirectory())
            walkFiles(full, out)
        else
            out.push(full)
    }
    return out
}

const pruneDistPlugin = (compressed, compressedModels) => ({
    name: 'prune-dist-assets',
    apply: 'build',
    closeBundle()
    {
        const distDir = resolve(gameDir, 'dist')
        if(!existsSync(distDir))
            return

        let removedCount = 0
        let removedBytes = 0
        const removeFile = (filePath) =>
        {
            if(!existsSync(filePath))
                return
            removedBytes += statSync(filePath).size
            rmSync(filePath, { force: true })
            removedCount++
        }

        const files = walkFiles(distDir)

        // 1. Encoders Draco nao sao usados no browser
        removeFile(join(distDir, 'draco', 'draco_encoder.js'))
        removeFile(join(distDir, 'draco', 'gltf', 'draco_encoder.js'))

        // 2. Quando modelos comprimidos estao ativos, remover .glb bruto que ja tem irmao -compressed.glb
        if(compressedModels)
        {
            for(const f of files)
            {
                if(f.endsWith('.glb') && !f.endsWith('-compressed.glb'))
                {
                    const compressedSibling = f.replace(/\.glb$/, '-compressed.glb')
                    if(existsSync(compressedSibling))
                        removeFile(f)
                }
            }
        }

        // 3. Quando texturas KTX2 nao estao ativas, remover *.ktx e basis/
        if(!compressed)
        {
            for(const f of files)
            {
                if(f.endsWith('.ktx'))
                    removeFile(f)
            }
            const basisDir = join(distDir, 'basis')
            if(existsSync(basisDir))
            {
                for(const f of walkFiles(basisDir))
                    removeFile(f)
                rmSync(basisDir, { recursive: true, force: true })
            }
        }

        // 4. Remover PNGs de UI quando ha irmao .webp
        const uiDir = join(distDir, 'ui')
        for(const f of walkFiles(uiDir))
        {
            if(f.endsWith('.png') && existsSync(f.replace(/\.png$/, '.webp')))
                removeFile(f)
        }

        const savedMb = (removedBytes / (1024 * 1024)).toFixed(2)
        console.log(`[prune-dist] Removidos ${removedCount} arquivos redundantes (-${savedMb} MB) em dist/`)
    }
})

export default ({ mode }) =>
{
    const env = loadEnv(mode, gameDir, '')
    const compressed = env.VITE_COMPRESSED === '1' || env.VITE_COMPRESSED === 'true'
    const compressedModels = mode === 'production'
        ? (env.VITE_COMPRESSED_MODELS !== '0')
        : (compressed || env.VITE_COMPRESSED_MODELS === '1' || env.VITE_COMPRESSED_MODELS === 'true')

    return {
        root: 'sources/', // Sources files (typically where index.html is)
        envDir: '../',  // Directory where the env file is located
        publicDir: '../static/', // Path from "root" to static assets (files that are served as they are)
        base: './', // Public path (what's after the domain)
        define:
        {
            'import.meta.env.VITE_COMPRESSED_MODELS': JSON.stringify(compressedModels ? '1' : ''),
        },
        server:
        {
            // https: true,
            host: true, // Open to local network and display URL
            open: true // Open in browser
        },
        build:
        {
            outDir: '../dist', // Output in the dist/ folder
            emptyOutDir: true, // Empty the folder first
            sourcemap: false // Add sourcemap
        },
        plugins:
        [
            wasm(),
            restart({ restart: [ '../static/**', ] }), // Restart server on static file change
            safeNodePolyfills(),
            pruneDistPlugin(compressed, compressedModels),
            // basicSsl()
        ]
    }
}
