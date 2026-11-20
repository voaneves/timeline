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
