// Adapted from folio-2025 by Bruno Simon (MIT) — https://github.com/brunosimon/folio-2025
// Changes: no dotenv / restart / basic-ssl / node-polyfills (server-only), no publicDir
// (assets will come from scripts/hash-assets.mjs, plan T0.15), no auto-open.
import wasm from 'vite-plugin-wasm'

export default {
    root: 'sources/', // Sources files (where index.html is)
    publicDir: false, // No static assets copied as-is
    base: './', // Relative public path
    server:
    {
        host: '127.0.0.1',
        open: false
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
}
