// Build config (see LICENSES.md for third-party attributions).
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
        __DEV_TOOLS__: JSON.stringify(mode !== 'production'), // debug-only chunks (Inspector, PerfHud, PhysicsSmoke): dropped from production
        __DEBUG_PANEL__: JSON.stringify(mode !== 'production'),
        __BUILD_ID__: JSON.stringify(computeBuildId('static', mode !== 'production')) // T0.15: embedded in the JS, names the manifest
    },
    // Dev server only: Rapier's wasm glue must not be pre-bundled (the optimized copy breaks wasm-bindgen's
    // `getObject(...).now is not a function` on the first world.step()); vite-plugin-wasm handles it from source.
    optimizeDeps:
    {
        exclude: [ '@dimforge/rapier3d' ]
    },
    build:
    {
        outDir: '../dist',
        emptyOutDir: true,
        sourcemap: false,
        // Keep three.js in its own long-lived chunk (it changes rarely; game code changes often).
        rolldownOptions:
        {
            output:
            {
                codeSplitting:
                {
                    groups: [ { name: 'three.webgpu', test: /[\\/]node_modules[\\/]three[\\/]/ } ]
                }
            }
        }
    },
    plugins:
    [
        wasm()
    ]
})
