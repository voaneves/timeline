// Contact sheet: N frames from an mp4 into one grid PNG.
// Usage: node sheet.mjs <video.mp4> [--out sheet.png] [--frames 16] [--cols 4] [--width 480]
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FFMPEG = process.env.FFMPEG || 'C:/Users/voaneves/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.1-full_build/bin/ffmpeg.exe';
export const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

export function makeSheet(video, { out, frames = 16, cols = 4, width = 480 } = {}) {
  out ||= video.replace(/\.mp4$/i, '') + '.sheet.png';
  const p = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' });
  const dur = parseFloat(p.stdout);
  if (!(dur > 0)) throw new Error('ffprobe could not read duration of ' + video);
  const rows = Math.ceil(frames / cols);
  // frames/dur fps spreads N frames evenly over the clip (about 4 fps for a 4 s clip, as in plan 7.2)
  const vf = `fps=${(frames / dur).toFixed(5)},scale=${width}:-1,tile=${cols}x${rows}:padding=4:margin=4:color=black`;
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-i', video, '-vf', vf, '-frames:v', '1', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg sheet failed: ' + r.stderr);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
  const video = a.find((x) => x.endsWith('.mp4'));
  if (!video) { console.error('usage: node sheet.mjs <video.mp4> [--out f.png] [--frames 16] [--cols 4] [--width 480]'); process.exit(1); }
  console.log(makeSheet(path.resolve(video), { out: get('out'), frames: +get('frames', 16), cols: +get('cols', 4), width: +get('width', 480) }));
}
