# NOTICE

Third-party tools and licences used by the game toolchain.


## ffmpeg (T0.2)
- Gyan.FFmpeg via winget, version 9.1 (full_build, www.gyan.dev), user scope.
- Path: C:\Users\voaneves\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.1-full_build\bin\ffmpeg.exe (winget alias on PATH after shell restart).
- Capture: ddagrab + h264_amf works (RX 6750 XT), 3 s => 180 frames, 60/1 fps (ffprobe). The plan 7.2 command fails as written here: AMF rejects the raw d3d11 BGRA frame (SubmitInput error 18). Working form: add -vf "hwdownload,format=bgra,format=nv12" -fps_mode cfr -r 60 (cfr needed, ddagrab is variable rate on static screens). Dev monitor is 1920x1080, so video_size=2560x1440 is not usable on it.
- libx264 fallback not needed.

## Blender (T0.1)
- Blender 5.3.0 (hash 02f0899d78e3, built 2026-11-10), official portable build from download.blender.org (blender-5.3.0-windows-x64.zip, sha256 3ac567a6…abfa8 verified against blender-5.3.0.sha256). Extracted to D:\GitHub\_vendor\blender-5.3.0-windows-x64\blender.exe (the winget MSI needs UAC elevation, exit 1602 in a non-interactive session).
- Smoke: `blender -b -P blender/smoke.py` → blender/smoke.glb (14 KB), valid per @gltf-transform/cli 4.5.1 inspect.
- Licence: GPL-3.0-or-later (the tool only; exported assets are ours).

## Engine scaffold: dependencies and supply chain (T0.5)
- Source: folio-2025 @ `70764a9` (read-only clone `D:\GitHub\_vendor\folio-2025`), MIT per its `license.md` (its package.json says ISC). Only code copied; no `static/` or `resources/` file. See `LICENSES.md`.
- Exact pins (no ranges), each at least 7 days old on 2026-11-20 (cutoff 2026-11-13): three 0.187.0 (2026-10-30, as upstream and the 2D page), @dimforge/rapier3d 0.19.3 (as upstream; upstream skipped 0.20/0.21 because of a sleep bug, T0.7 tests 0.21.0 from 2026-09-25), gsap 3.15.1 (2026-11-04), camera-controls 3.1.2, seedrandom 3.0.5, tweakpane 4.0.5, @tweakpane/plugin-essentials 0.2.1, @tweakpane/plugin-camerakit 0.3.0, vite 8.3.8 (2026-11-11), vite-plugin-wasm 3.6.0, playwright-core 1.65.0 (2026-11-05; 1.65.1 is from 2026-11-13, under the 7-day cooldown). Dropped from upstream: stylus, msgpack-lite, uuid, emoji-regex, normalize-wheel, dotenv, vite-plugin-node-polyfills, vite-plugin-restart, @vitejs/plugin-basic-ssl, sharp, glob, howler (no audio yet), stats-gl, the @gltf-transform packages.
- Install: `npm ci --ignore-scripts` (also used for `npm install`). 25 packages in the tree.
- Install scripts: none are needed. The only package in the lockfile with an install script is `fsevents` 2.3.3 (macOS only, optional, not installed on Windows). `--ignore-scripts` therefore changes nothing today; keep it anyway.
- Native binaries (platform-specific optional packages with a prebuilt `.node`, loaded by vite at build time, no postinstall, not shipped in `dist/`): `@rolldown/binding-win32-x64-msvc` 1.2.19 (MIT, `rolldown-binding.win32-x64-msvc.node`, sha256 `e0a93949…4bf819`) used by vite 8 / rolldown; `lightningcss-win32-x64-msvc` 1.33.0 (MPL-2.0, `lightningcss.win32-x64-msvc.node`, sha256 `d043df0f…b5a91`) used by vite for CSS. Other platforms' bindings (linux x64 gnu/musl, darwin, arm, android, freebsd, wasm32-wasi, ...) are present in the lockfile as optional and are not installed here; the same two engines need the linux-x64-gnu pair on a Linux CI runner. Decision: both ALLOWED (the standard vite 8 toolchain). esbuild is only an optional peer of vite 8 and is not installed. @dimforge/rapier3d ships wasm (no native code). playwright-core downloads no browser (system Chrome is used).
- `npm audit signatures`: 25 registry signatures verified, 10 attestations verified. `npm audit`: 0 vulnerabilities.
- Licence notes: gsap is under GreenSock's "no charge" licence (not MIT, decision D6 open); rapier3d is Apache-2.0; lightningcss is MPL-2.0 (build-time only).
- Build output (T0.5, empty world, `npm run build`): index chunk 293 kB (86 kB gz), three.webgpu 1.11 MB (304 kB gz), rapier js 184 kB (32 kB gz), rapier wasm 1.57 MB (593 kB gz), tweakpane and its 2 plugins in 3 separate chunks (never fetched without `?debug`).

## Empty engine (T0.6)
- Boots a ground slab and one dynamic cube (Rapier), WebGPU with WebGL2 fallback (`?webgl` forces WebGL2), fixed day-cycle progress (`?cycle=<0..1>` or `?cycle=live`), `?expose` exposes `window.game`.
- Measured on the dev machine (headed Chrome, `--use-angle=d3d11 --ignore-gpu-blocklist`, RX 6750 XT, 1280x720, 75 Hz display): 75 fps (frame p95 13.4 ms) in both WebGPU and `?webgl`, no console errors (WebGPU only logs Chrome's "powerPreference is ignored on Windows" warning).
- Procedural stand-ins replace upstream art: terrain data texture (64x64), 16-entry palette. Both are placeholders for the art pipeline.
- Events priority bug fixed (`Events.trigger` iterated a sparse array with `for...in`; fractional orders such as 5.5 ran after 998). Test: `npm test` (`tests/events-order.test.mjs`).

## Rapier 0.21.0 decision (T0.7)
- Upgraded `@dimforge/rapier3d` 0.19.3 -> 0.21.0 (exact pin, published 2026-09-25, latest, >= 7 days old). `npm ci --ignore-scripts` OK, `npm audit signatures`: 25 registry signatures verified, 11 attestations; `npm audit`: 0 vulnerabilities.
- Test: `?debug=physics` runs `sources/Game/Physics/PhysicsSmoke.js` (own isolated World, fixed 1/60 s steps, result in `window.__physicsSmoke`) via `tools/rapier-perf/check.mjs` in headed Chrome (d3d11), WebGPU and `?webgl`. 9 tests, all pass on BOTH versions and both backends: `createVehicleController` 10 s (4 wheels, drives 38.3 m on 0.19.3, 37.2 m on 0.21.0), `createCharacterController` 10 s (autostep + snap, ends at x 11.68 / 11.54), and the sleep tests: impulse wakes a sleeping cube; a falling cube wakes a sleeping one (contact); a cube on another wakes and falls when the lower body is removed (`removeRigidBody`) or only its collider (`removeCollider`); a cube on a kinematic platform that moves away falls; a thrown cube does not sleep at the apex; a kinematic body pushes a sleeping cube. No sleep bug reproduced on 0.21.0. Raw results: `tools/rapier-perf/out-0.19.3.json`, `out-0.21.0.json`.
- Behaviour difference: 0.21.0 puts bodies to sleep much sooner (cube falling from 2 m: 1.1 s vs 2.6 s; resting stack 0.5 s vs 2.0 s). Fine for the sleep tests, but retest feel/ghost determinism (T0.16) on 0.21.
- Cost: wasm 1.57 MB -> 3.08 MB (gzip 593 -> 1188 kB), rapier js 184 -> 296 kB (gzip 32 -> 52 kB). Count it against the size budget (T0.14); fall back to 0.19.3 (exact pin) if the budget cannot take it.
- Caveat: the upstream "sleep bug" was not described precisely, so these tests cover the listed scenarios only; keep the smoke test in the loop when touching Physics.

## Perf probe and ?debug (T0.9)
- `window.__perf` (always installed, `sources/Game/PerfProbe.js`): fps, frameMsP50/P95 (240-frame window), drawCalls, triangles, programs (renderer.info), gpuMs + gpuSource, `snapshot()` returns them as an object. GPU time is opt-in (`?debug` or `?perf=gpu`, passes `trackTimestamp` to the renderer): WebGPU timestamp queries or EXT_disjoint_timer_query_webgl2; otherwise `gpuMs` is "unavailable" (gpuSource "off"). Measured on the dev machine: 75 fps both backends, 20 draws, 2076 tris, programs 21 (WebGPU) / 22 (WebGL2), GPU 1.6 ms (WebGPU) / 5-8 ms (WebGL2 timer query, coarser).
- Perf HUD (`PerfHud.js`, plain DOM, bottom-left, H toggles) only with `?debug`/`#debug`, dynamic `import()`.
- Tweakpane is bundled only outside production: `__DEBUG_PANEL__` (vite `define`, false when mode is production). `npm run build` => `dist` has zero "tweakpane" files or strings (`npm run check:no-tweakpane`); `npm run build:debug` writes `dist-debug/` with the panel (gitignored). Dev server keeps it.
- Fixed a latent bug: `Debug.isRequested()` had a literal backspace character in its regex (`debug\b` lost its backslash), so `?debug` never matched in search; now `/[?&]debug(?:[=&]|$)/i`.

## Rapier pin decision (main session, after T0.7)
- Final pin: @dimforge/rapier3d **0.19.3** (as upstream). T0.7 showed all 9 physics/sleep tests pass on BOTH 0.19.3 and 0.21.0, so 0.21's extra ~600 kB gz (wasm 593 → 1188 kB gz) buys nothing measurable against the 3.0 MB critical-path budget. Revisit only if a concrete bug appears on 0.19.3. 0.21 also sleeps bodies sooner (stack 0.5 s vs 2.0 s), which would need re-tuning.

## Preview channel (T0.11)
- Repo: https://github.com/voaneves/timeline-preview (public, single orphan commit force-pushed by `scripts/publish-preview.mjs --push`), Pages from main root: https://voaneves.github.io/timeline-preview/ (noindex,nofollow meta + robots.txt Disallow: /).
- Pages Content-Encoding (checked 2026-11-20 with Accept-Encoding: gzip, br): .js gzip, .wasm gzip (rapier 0.19.3 wasm 590,591 B on the wire), .glb gzip; small .json served uncompressed. No brotli. No need to switch to rapier compat for size.

## Supply chain, current tree (refresh 2026-11-20, review #7)
Supersedes the "25 packages" figures in the T0.5 and T0.7 sections above (those counted the tree before the `linkedom` dev dependency existed).
- Tree: 45 installed packages on Windows x64 (77 entries in `package-lock.json`; the other 32 are optional platform bindings for other OS/CPU that npm skips). Direct pins, all exact: dependencies `@dimforge/rapier3d` 0.19.3, `@tweakpane/plugin-camerakit` 0.3.0, `@tweakpane/plugin-essentials` 0.2.1, `camera-controls` 3.1.2, `gsap` 3.15.1, `seedrandom` 3.0.5, `three` 0.187.0, `tweakpane` 4.0.5; devDependencies `linkedom` 0.18.15 (2026-11-01, ISC; used by `scripts/extract-content.mjs`), `playwright-core` 1.65.0, `vite` 8.3.8, `vite-plugin-wasm` 3.6.0.
- linkedom 0.18.15 brings: `htmlparser2` 10.1.0 (with nested `dom-serializer` 2.0.0, `domelementtype` 2.3.0, `domhandler` 5.0.3, `domutils` 3.2.2, `entities` 4.5.0 and 7.0.1), `css-select` 7.0.0, `css-what` 8.0.0, `boolbase` 2.0.0, `nth-check` 3.0.1, `cssomnom` 0.1.12 (Apache-2.0), `dom-serializer` 3.1.1, `domelementtype` 3.0.0, `domhandler` 6.0.1, `domutils` 4.0.2, `entities` 8.1.0, `html-escaper` 3.0.3, `uhyphen` 0.2.0. Licences: ISC, MIT, BSD-2-Clause, Apache-2.0 (no copyleft added). Used at build time only, never shipped in `dist/`.
- Ages (publish dates from the registry, cutoff 2026-11-13 for the 7-day cooldown): every package is at least 7 days old EXCEPT `source-map-js` 1.2.4 (2026-11-19, 1 day), a transitive dependency of `postcss` 8.5.33 (range `^1.2.2`) pulled in by vite. It has no install script and `npm audit` is clean, but it breaks the cooldown rule: pin it to 1.2.2 (2026-09-30) via an `overrides` entry or re-lock after 2026-11-26. Edge cases on the cutoff day itself (exactly 7 days): `postcss` 8.5.33, `cssomnom` 0.1.12 and `@rolldown/pluginutils` 1.1.1 (all 2026-11-13). Other recent ones: `rolldown`/`@rolldown/binding-win32-x64-msvc` 1.2.19 and `vite` 8.3.8 (2026-11-11), `playwright-core` 1.65.0 (2026-11-05), `gsap` 3.15.1 (2026-11-04), `linkedom` (2026-11-01), `three` (2026-10-30), `@oxc-project/types` 0.156.0 (2026-10-27), `nanoid` 3.3.20 (2026-10-05).
- Install scripts: the only package in the lockfile with `hasInstallScript` is `fsevents` 2.3.3 (macOS, optional, not installed here). linkedom and its dependencies have none. Keep `npm ci --ignore-scripts`.
- Native binaries / compiled code actually on disk: `@rolldown/binding-win32-x64-msvc` 1.2.19 (`rolldown-binding.win32-x64-msvc.node`, sha256 `e0a93949…4bf819`) and `lightningcss-win32-x64-msvc` 1.33.0 (`lightningcss.win32-x64-msvc.node`, sha256 `d043df0f…b5a91`), unchanged from T0.5 (both re-hashed 2026-11-20). WebAssembly only: `@dimforge/rapier3d` `rapier_wasm3d_bg.wasm`, `playwright-core` `lib/webp_codec.wasm`, and three's `basis_transcoder.wasm` / `draco_decoder.wasm` (x2) which are the only upstream-vendored binaries in `three/examples/jsm/libs/` (allowlisted by the originality audit). No other `.node`, `.exe`, `.dll`, `.so` or `.dylib` in `node_modules`.
- Verification run 2026-11-20 in `game/`: `npm audit`: 0 vulnerabilities; `npm audit signatures`: 45 verified registry signatures, 20 verified attestations. `npm ci --ignore-scripts` was attempted first but could not finish because running dev/preview servers locked `rolldown-binding.win32-x64-msvc.node` (EPERM on unlink, node_modules left half-removed); `npm install --ignore-scripts` against the unchanged lockfile restored the exact tree (lockfile not modified, `npm ls --all` clean). Re-run a clean `npm ci --ignore-scripts` with no vite process running before a release.
- 2026-11-20: `overrides.source-map-js = 1.2.2` (published 2026-09-30) to respect the 7-day cooldown; 1.2.4 (2026-11-19) was pulled transitively by postcss via vite. Remove the override after 2026-11-26.

## Backend matrix (T1.11)
- Policy: mobile devices (`Quality.isMobile()`, checking UA and `navigator.userAgentData?.mobile`) default to WebGL2 (`forceWebGL: true`) and quality tier 1; desktop defaults to WebGPU with WebGL2 fallback and quality tier 0. Query overrides: `?webgl` always forces WebGL2; `?webgpu` overrides the mobile default and enables WebGPU. `Rendering.backendName` exposes the active backend (`webgpu` or `webgl2`) alongside `window.__perf.backend`.
- Measured on the dev machine (2026-11-21, greybox debug build, headed Chrome with `--use-angle=d3d11 --ignore-gpu-blocklist`, RX 6750 XT, 75 Hz display, 2 s warmup + 5 s sample per cell via `tools/capture/t111-backends.mjs`, raw output `tools/capture/out/t111-backends.json`). Mobile proxy emulates 390×844, DPR 2, Android mobile UA, and 4× CDP CPU throttle (GPU is not throttled by CDP; real phone numbers are still required for G1 / D10 / D17).

| Device / profile | Query | Expected backend | Actual backend | Quality | Avg fps | Frame p95 (ms) | Draw calls | Errors |
|---|---|---|---|---|---:|---:|---:|---:|
| Desktop 1280×720 (DPR 1) | `?expose` | `webgpu` | `webgpu` | Q0 | 75.0 | 13.7 | 49 | 0 |
| Desktop 1280×720 (DPR 1) | `?expose&webgpu` | `webgpu` | `webgpu` | Q0 | 74.9 | 13.7 | 49 | 0 |
| Desktop 1280×720 (DPR 1) | `?expose&webgl` | `webgl2` | `webgl2` | Q0 | 75.0 | 13.7 | 49 | 0 |
| Mobile proxy 390×844 (DPR 2, 4× CPU) | `?expose` | `webgl2` | `webgl2` | Q1 | 71.3 | 15.7 | 30 | 0 |
| Mobile proxy 390×844 (DPR 2, 4× CPU) | `?expose&webgl` | `webgl2` | `webgl2` | Q1 | 69.6 | 15.6 | 30 | 0 |
| Mobile proxy 390×844 (DPR 2, 4× CPU) | `?expose&webgpu` | `webgpu` | `webgpu` | Q1 | 74.9 | 14.1 | 30 | 0 |
| Owner real phone (TBD, pending playtest at G1 / D10 / D17) | default | `webgl2` | _pending_ | Q1 | _pending_ | _pending_ | _pending_ | _pending_ |
| Owner real phone (TBD, pending playtest at G1 / D10 / D17) | `?webgpu` | `webgpu` | _pending_ | Q1 | _pending_ | _pending_ | _pending_ | _pending_ |
