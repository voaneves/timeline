import { Damper } from "./springs.js";

// Third-person follow camera at a fixed 3/4 angle (FOV 35, pitch 32 degrees) with
// critically damped smoothing, velocity look-ahead and a per-zone distance hint.
const PITCH = (23 * Math.PI) / 180;

export function createFollowCamera(camera, { reduced }) {
  const tx = new Damper();
  const ty = new Damper();
  const tz = new Damper();
  const dist = new Damper(14);
  let kick = 0;
  let shiftX = new Damper(0); // card open: subject moves to the left third
  let shiftY = new Damper(0);
  const smooth = reduced ? 0.06 : 0.28;
  let introT = reduced ? 1 : -0.35;
  let held = !reduced; // intro waits for begin()
  let shake = 0;
  let fovK = 0;
  const rollD = new Damper(0);
  let rollT = 0;

  const apply = () => {
    const aspectK = camera.aspect < 1.25 ? 1 + (1.25 - camera.aspect) * 0.85 : 1;
    const e = 1 - Math.pow(1 - Math.max(0, Math.min(1, introT)), 3);
    const d = dist.x * aspectK + (1 - e) * 11;
    const sx = shake > 0.001 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0.001 ? (Math.random() - 0.5) * shake : 0;
    camera.position.set(tx.x + shiftX.x + (1 - e) * -14 + sx, ty.x + Math.sin(PITCH) * d + 1.2 + (1 - e) * 13 + kick + shiftY.x + sy, tz.x + Math.cos(PITCH) * d);
    camera.lookAt(tx.x + shiftX.x, ty.x + 1.9 - (1 - e) * 1.2 + shiftY.x, tz.x);
    if (rollD.x !== 0) camera.rotateZ(rollD.x);
    const fov = 36 + fovK;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  return {
    snap(x, y, z, d = 14) {
      tx.snap(x);
      ty.snap(y);
      tz.snap(z);
      dist.snap(d);
      apply();
    },
    // frame: {x,y,z,vx,vz, hint (distance), card (bool), narrow (bool)}
    update(dt, f) {
      const look = reduced ? 0 : 0.3;
      tx.update(f.x + f.vx * look, smooth, dt);
      ty.update(Math.max(0, f.y * 0.6), smooth * 1.4, dt);
      tz.update(f.z + f.vz * look * 0.5, smooth, dt);
      dist.update(f.hint, 0.9, dt);
      // Card open: look at a point right of (desktop) or below (mobile) the avatar.
      shiftX.update(f.card && !f.narrow ? 3.2 : 0, 0.35, dt);
      shiftY.update(f.card && f.narrow ? -2.4 : 0, 0.35, dt);
      if (kick !== 0) kick *= Math.max(0, 1 - dt * 12);
      shake *= Math.max(0, 1 - dt * 9);
      fovK *= Math.max(0, 1 - dt * 5);
      rollD.update(reduced ? 0 : rollT, 0.16, dt);
      if (!held && introT < 1) introT += dt / 3.8;
      apply();
    },
    kick(v) {
      if (!reduced) {
        kick = -v;
        shake = Math.max(shake, v * 0.5);
      }
    },
    punch(v) {
      if (!reduced) fovK = Math.max(fovK, v);
    },
    introDone: () => introT >= 1,
    roll(rad) {
      rollT = rad;
    },
    begin() {
      held = false;
      introT = Math.max(introT, -0.12);
    },
  };
}
