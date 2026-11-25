import 'dotenv/config'
import restart from 'vite-plugin-restart'
import wasm from 'vite-plugin-wasm'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const STYLE_ID_RE = /\.(styl|css|scss|sass|less)(\?|$)/i

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

export default {
    root: 'sources/', // Sources files (typically where index.html is)
    envDir: '../',  // Directory where the env file is located
    publicDir: '../static/', // Path from "root" to static assets (files that are served as they are)
    base: './', // Public path (what's after the domain)
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
        // basicSsl()
    ]
}