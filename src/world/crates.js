import { DynamicDrawUsage, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hullMat, mat } from "./materials.js";
import { Statics, aoTexture } from "./props.js";
import { makeBox, R, H } from "./physics.js";
import { Spring, clamp } from "./springs.js";

// Kickable paper/ink crates: a rigid-body-lite playground. Velocity, gravity, ground friction and
// axis-separated box-vs-box resolution against the static colliders and each other (stacks work).
// The courier kicks a crate by running into it; hits squash it and throw paper debris.
const HALF = 0.4;
const EPS = 0.0005;
const TOL = 0.002; // resting contact must not count as overlap

function crateGeometry() {
  const s = new Statics();
  const w = HALF * 2;
  s.box(0xf4ead4, -HALF, -HALF, -HALF, w, w, w);
  // Ink straps and a signal stamp (on both +z and -z faces).
  s.box(0x14110f, -HALF - 0.02, -HALF - 0.02, -0.2, w + 0.04, w + 0.04, 0.11);
  s.box(0x14110f, -0.2, -HALF - 0.02, -HALF - 0.02, 0.11, w + 0.04, w + 0.04);
  s.box(0xf50000, 0.04, -0.06, HALF + 0.005, 0.2, 0.2, 0.03);
  s.box(0xf50000, -0.24, -0.06, -HALF - 0.035, 0.2, 0.2, 0.03);
  return mergeGeometries(s.parts);
}

export function createCrates(spots, { colliders, bounds, particles, sfx }) {
  const geo = crateGeometry();
  const body = new InstancedMesh(geo, mat({ vertexColors: true, roughness: 0.8 }, { rim: 0.2 }), spots.length);
  body.instanceMatrix.setUsage(DynamicDrawUsage);
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false;
  const hull = new InstancedMesh(geo, hullMat(0.035), spots.length);
  hull.instanceMatrix.setUsage(DynamicDrawUsage);
  hull.frustumCulled = false;
  const aoGeo = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const contact = new InstancedMesh(aoGeo, new MeshBasicMaterial({ map: aoTexture(), transparent: true, depthWrite: false }), spots.length);
  contact.instanceMatrix.setUsage(DynamicDrawUsage);
  contact.frustumCulled = false;
  contact.renderOrder = 1;

  const list = spots.map(([x, y, z]) => ({
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    spin: 0,
    grounded: false,
    cool: 0,
    sq: new Spring(300, 12),
    box: makeBox(x - HALF, x + HALF, y - HALF, y + HALF, z - HALF, z + HALF, { kind: "crate" }),
  }));
  const overlaps = (c, k) =>
    c.x + HALF > k.x0 + TOL && c.x - HALF < k.x1 - TOL && c.z + HALF > k.z0 + TOL && c.z - HALF < k.z1 - TOL && c.y + HALF > k.y0 + TOL && c.y - HALF < k.y1 - TOL;

  const debris = (c, n, big) => {
    const emit = (color, k) =>
      particles.emit(c.x, c.y, c.z, Math.ceil(n * k), { color, speed: big ? 4.2 : 2.6, up: big ? 5 : 3.2, size: 0.13, life: 0.8, gravity: 14 });
    emit(0xf4ead4, 0.5);
    emit(0x14110f, 0.25);
    emit(0xf50000, 0.25);
  };
  const hit = (c, speed) => {
    c.sq.kick(-clamp(speed * 0.9, 2, 7)); // squash along y, then spring back
    debris(c, 8 + Math.floor(speed), speed > 6);
    sfx.play("crate", 0.85 + Math.random() * 0.3);
  };

  const o = new Object3D();
  const sync = (dt = 0) => {
    list.forEach((c, i) => {
      const s = dt ? c.sq.update(dt) : c.sq.x;
      const sy = 1 - s * 0.2;
      o.position.set(c.x, c.y - HALF * (1 - sy), c.z);
      o.rotation.set(0, c.yaw, 0);
      o.scale.set(1 + s * 0.14, sy, 1 + s * 0.14);
      o.updateMatrix();
      body.setMatrixAt(i, o.matrix);
      hull.setMatrixAt(i, o.matrix);
      // Contact AO: about 1.4x the footprint, fading as the crate lifts off the floor.
      o.position.set(c.x, 0.075, c.z);
      o.rotation.set(0, 0, 0);
      const k = 1.4 * HALF * 1.3 * (1 - clamp((c.y - HALF) * 0.25, 0, 0.6));
      o.scale.set(k, 1, k);
      o.updateMatrix();
      contact.setMatrixAt(i, o.matrix);
    });
    body.instanceMatrix.needsUpdate = hull.instanceMatrix.needsUpdate = contact.instanceMatrix.needsUpdate = true;
  };
  sync();

  const step = (dt) => {
    for (const c of list) {
      c.cool = Math.max(0, c.cool - dt);
      c.vy = Math.max(-30, c.vy - 30 * dt);
      const ks = [...colliders, ...list.filter((q) => q !== c).map((q) => q.box)];
      c.grounded = false;
      c.x += c.vx * dt;
      for (const k of ks) {
        if (!overlaps(c, k)) continue;
        const sp = Math.abs(c.vx);
        c.x = c.vx > 0 ? k.x0 - HALF - EPS : k.x1 + HALF + EPS;
        if (sp > 2.2) hit(c, sp);
        c.vx = -c.vx * 0.28;
        c.spin *= 0.5;
      }
      c.z += c.vz * dt;
      for (const k of ks) {
        if (!overlaps(c, k)) continue;
        const sp = Math.abs(c.vz);
        c.z = c.vz > 0 ? k.z0 - HALF - EPS : k.z1 + HALF + EPS;
        if (sp > 2.2) hit(c, sp);
        c.vz = -c.vz * 0.28;
        c.spin *= 0.5;
      }
      c.y += c.vy * dt;
      for (const k of ks) {
        if (!overlaps(c, k)) continue;
        if (c.vy <= 0) {
          c.y = k.y1 + HALF + EPS;
          c.grounded = true;
          if (c.vy < -4) hit(c, -c.vy * 0.5);
          c.vy = c.vy < -4 ? -c.vy * 0.2 : 0;
        } else {
          c.y = k.y0 - HALF - EPS;
          c.vy = 0;
        }
      }
      if (c.y <= HALF) {
        c.y = HALF;
        if (c.vy < -4) {
          hit(c, -c.vy * 0.5);
          c.vy = -c.vy * 0.2;
        } else c.vy = 0;
        c.grounded = true;
      }
      if (c.grounded) {
        const f = Math.exp(-2.8 * dt);
        c.vx *= f;
        c.vz *= f;
        if (Math.hypot(c.vx, c.vz) < 0.15) c.vx = c.vz = 0;
      }
      // Visual yaw: spin while sliding, then settle square to the grid so it matches the AABB.
      c.yaw += c.spin * dt;
      c.spin *= Math.exp(-5 * dt);
      if (c.grounded && Math.abs(c.spin) < 0.4) {
        const target = Math.round(c.yaw / (Math.PI / 2)) * (Math.PI / 2);
        c.yaw += (target - c.yaw) * Math.min(1, dt * 12);
      }
      if (c.x < bounds.x0 + HALF || c.x > bounds.x1 - HALF) {
        c.x = clamp(c.x, bounds.x0 + HALF, bounds.x1 - HALF);
        c.vx *= -0.3;
      }
      if (c.z < bounds.z0 + HALF || c.z > bounds.z1 - HALF) {
        c.z = clamp(c.z, bounds.z0 + HALF, bounds.z1 - HALF);
        c.vz *= -0.3;
      }
      const b = c.box;
      b.x0 = c.x - HALF;
      b.x1 = c.x + HALF;
      b.z0 = c.z - HALF;
      b.z1 = c.z + HALF;
      // While cooling down after a kick the avatar collider is parked below the floor.
      b.y0 = c.cool > 0 && c.kicked ? -100 : c.y - HALF;
      b.y1 = c.cool > 0 && c.kicked ? -99 : c.y + HALF;
      if (c.cool <= 0) c.kicked = false;
    }
  };

  // Called before the avatar steps: if its swept next position touches a crate at running speed,
  // kick the crate away and let the avatar run through for a moment.
  const kick = (a, dt) => {
    const sp = Math.hypot(a.vx, a.vz);
    if (sp < 1.8) return false;
    let any = false;
    for (const c of list) {
      if (c.cool > 0) continue;
      const nx = a.x + a.vx * dt;
      const nz = a.z + a.vz * dt;
      const gx = Math.abs(nx - c.x) - (R + HALF);
      const gz = Math.abs(nz - c.z) - (R + HALF);
      if (gx > 0.02 || gz > 0.02) continue;
      if (a.y + H < c.y - HALF + 0.05 || a.y > c.y + HALF - 0.2) continue;
      if ((c.x - a.x) * a.vx + (c.z - a.z) * a.vz <= 0) continue;
      const v = 5 + sp * 0.95;
      c.vx = (a.vx / sp) * v;
      c.vz = (a.vz / sp) * v;
      c.vy = 3.4;
      c.spin = (a.vx > 0 ? -1 : 1) * (4 + Math.random() * 4);
      c.cool = 0.25;
      c.kicked = true;
      c.box.y0 = -100;
      c.box.y1 = -99;
      hit(c, 7);
      any = true;
    }
    return any;
  };

  return { list, meshes: [body, hull, contact], step, kick, sync };
}
