import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const [k, v] of Object.entries(r)) {
  const p = v.perf;
  console.log(k, p.backend, 'fps', p.fps.toFixed(1), 'p50', p.frameMsP50.toFixed(1), 'p95', p.frameMsP95.toFixed(1), 'draws', p.drawCalls, 'tris', p.triangles, 'progs', p.programs, 'gpu', typeof p.gpuMs === 'number' ? p.gpuMs.toFixed(2) : p.gpuMs, p.gpuSource, '| tweakpaneReq', v.tweakpaneRequests, 'errors', v.errors.length, '| rapier', v.smoke?.version, 'pass', v.smoke?.pass, '| hud', v.hud ? 'yes' : 'no');
  if (v.smoke) for (const [t, x] of Object.entries(v.smoke.tests)) console.log('   ', t, x.pass, JSON.stringify(x).slice(0, 160));
}
