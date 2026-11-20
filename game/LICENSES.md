# Licences of the 3D game (`game/`)

## folio-2025 (Bruno Simon), MIT

The engine under `sources/Game/**`, `sources/index.js`, `sources/threejs-override.js`, `sources/index.html`
and `vite.config.js` is adapted from [folio-2025](https://github.com/brunosimon/folio-2025)
by Bruno Simon, commit `70764a9` (2026-11-04).

The licence that applies is the one in the repository's `license.md` (MIT, "Copyright (c) 2025 Bruno Simon").
Note that the upstream `package.json` says `ISC`; the licence text in `license.md` is MIT and is the one
used here.

Only source code was copied. Nothing from upstream `static/` or `resources/` (models, textures, sounds,
fonts, favicons, `.blend`/`.psd` sources, the author's own likeness and brand artwork) is present in this
repository; textures that the engine needs are generated in code.

```
MIT License

Copyright (c) 2025 Bruno Simon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Runtime dependencies (bundled into `dist/`)

| Package | Version | Licence | Note |
|---|---|---|---|
| three | 0.187.0 | MIT | Same version as the 2D page. Licence text in `../LICENSES.md`. |
| @dimforge/rapier3d | 0.19.3 | Apache-2.0 | Same version as upstream (upstream held it back because of a sleep bug; 0.21 is tested in T0.7). Ships the wasm. |
| gsap | 3.15.1 | GreenSock "Standard 'no charge' licence" (<https://gsap.com/standard-license>) | **Not MIT.** Decision D6 (keep or replace by own tweens) is still open. |
| camera-controls | 3.1.2 | MIT | Free camera, debug only. |
| seedrandom | 3.0.5 | MIT | Used by `View.js` (speed lines). |
| tweakpane | 4.0.5 | MIT | Debug panel; loaded by dynamic `import()` only with `?debug` / `#debug`. |
| @tweakpane/plugin-essentials | 0.2.1 | MIT | Same. |
| @tweakpane/plugin-camerakit | 0.3.0 | MIT | Same. |

`normalize-wheel` (BSD-3-Clause, unmaintained) used by upstream was dropped: `Inputs/Wheel.js` uses `event.deltaY`.

## Build and test tooling (not shipped)

| Package | Version | Licence |
|---|---|---|
| vite | 8.3.8 | MIT (bundles rolldown 1.2.19, MIT; postcss, MIT; lightningcss 1.33.0, **MPL-2.0**, native build-time binary, not redistributed) |
| vite-plugin-wasm | 3.6.0 | MIT |
| playwright-core | 1.65.0 | Apache-2.0 (no browser download; uses the system Chrome) |

Packages with native binaries and the install-script review are recorded in `NOTICE.md`.
