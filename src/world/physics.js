// Custom kinematic physics: a vertical box body against static AABBs and a ground plane.
// Axis-separated resolution at a fixed 1/120 step; speeds stay far below the thinnest
// collider (0.5) per step, so nothing tunnels.
export const STEP = 1 / 120;
export const R = 0.36; // half-width of the body in x and z
export const H = 1.5; // body height
const EPS = 0.0005;

export function makeBox(x0, x1, y0, y1, z0, z1, data) {
  return { x0, x1, y0, y1, z0, z1, data };
}
export const boxAt = (cx, cy, cz, w, h, d, data) =>
  makeBox(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2, data);

const hit = (b, k) =>
  b.x + R > k.x0 && b.x - R < k.x1 && b.z + R > k.z0 && b.z - R < k.z1 && b.y + H > k.y0 && b.y < k.y1;

export function createBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, floor: null, head: null, px: x, py: y, pz: z };
}

export function stepBody(b, boxes, bounds, dt = STEP) {
  b.px = b.x;
  b.py = b.y;
  b.pz = b.z;
  b.head = null;
  b.floor = null;
  b.grounded = false;

  b.x += b.vx * dt;
  for (const k of boxes) {
    if (!hit(b, k)) continue;
    if (b.vx > 0) b.x = k.x0 - R - EPS;
    else if (b.vx < 0) b.x = k.x1 + R + EPS;
    b.vx = 0;
  }
  b.z += b.vz * dt;
  for (const k of boxes) {
    if (!hit(b, k)) continue;
    if (b.vz > 0) b.z = k.z0 - R - EPS;
    else if (b.vz < 0) b.z = k.z1 + R + EPS;
    b.vz = 0;
  }
  b.y += b.vy * dt;
  for (const k of boxes) {
    if (!hit(b, k)) continue;
    if (b.vy <= 0) {
      b.y = k.y1;
      b.grounded = true;
      b.floor = k;
    } else {
      b.y = k.y0 - H;
      b.head = k;
    }
    b.vy = 0;
  }
  if (b.y <= 0) {
    b.y = 0;
    if (b.vy < 0) b.vy = 0;
    b.grounded = true;
  }
  b.x = Math.min(bounds.x1, Math.max(bounds.x0, b.x));
  b.z = Math.min(bounds.z1, Math.max(bounds.z0, b.z));
}
