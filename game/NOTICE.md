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
