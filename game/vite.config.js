// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
// Changes: no dotenv / restart / basic-ssl / node-polyfills (server-only), no publicDir
// (assets will come from scripts/hash-assets.mjs, plan T0.15), no auto-open.
import wasm from 'vite-plugin-wasm'
import { computeBuildId } from './scripts/hash-assets.mjs'

// `__DEBUG_PANEL__`: Tweakpane is bundled only outside production (dev server, `npm run build:debug`).
// The production build contains no "tweakpane" string at all (plan T0.9, checked by `npm run check:no-tweakpane`).
export default ({ mode }) => ({
    root: 'sources/', // Sources files (where index.html is)
    publicDir: false, // No static assets copied as-is
    base: './', // Relative public path
    server:
    {
        host: '127.0.0.1',
        open: false
    },
    define:
    {
        __DEBUG_PANEL__: JSON.stringify(mode !== 'production'),
        __BUILD_ID__: JSON.stringify(computeBuildId('static')) // T0.15: embedded in the JS, names the manifest
    },
    build:
    {
        outDir: '../dist',
        emptyOutDir: true,
        sourcemap: false
    },
    plugins:
    [
        wasm()
    ]
})
