import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mat, hullMat } from "./materials.js";
import { BufferGeometry, CircleGeometry } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { LatheGeometry, Vector2 } from "three";

// Vertex-coloured merged geometry: all static scenery is one draw call.
export class Statics {
  constructor() {
    this.parts = [];
  }
  add(geo, color, x = 0, y = 0, z = 0, ry = 0, ao_ = true) {
    const g = geo;
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const c = new Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    g.computeBoundingBox();
    const y0 = g.boundingBox.min.y;
    const span = Math.max(0.001, g.boundingBox.max.y - y0);
    for (let i = 0; i < n; i++) {
      // Baked ambient occlusion: darker toward the bottom of every part.
      const ao = ao_ ? 0.66 + 0.34 * Math.min(1, (g.attributes.position.getY(i) - y0) / span) : 1;
      arr[i * 3] = c.r * ao;
      arr[i * 3 + 1] = c.g * ao;
      arr[i * 3 + 2] = c.b * ao;
    }
    g.setAttribute("color", new BufferAttribute(arr, 3));
    this.parts.push(g);
    return g;
  }
  // Box from its min corner and size.
  box(color, x0, y0, z0, w, h, d) {
    return this.add(new BoxGeometry(w, h, d), color, x0 + w / 2, y0 + h / 2, z0 + d / 2);
  }
  // Merged ink outline of every part (smoothed normals so corners stay closed).
  hullMesh(thick = 0.035, skipBelow = 0.2) {
    const hulls = [];
    for (const g of this.parts) {
      g.computeBoundingBox();
      if (g.boundingBox.max.y - g.boundingBox.min.y < skipBelow && g.boundingBox.max.y < 0.2) continue;
      const h = new BufferGeometry();
      h.setAttribute("position", g.attributes.position.clone());
      if (g.index) h.setIndex(g.index.clone());
      const welded = mergeVertices(h.index ? h.toNonIndexed() : h, 0.01);
      welded.deleteAttribute("normal");
      welded.deleteAttribute("uv");
      welded.computeVertexNormals();
      hulls.push(welded);
    }
    const m = new Mesh(mergeGeometries(hulls.map((g) => (g.index ? g.toNonIndexed() : g))), hullMat(thick));
    return m;
  }
  mesh() {
    const m = new Mesh(mergeGeometries(this.parts.map((g) => (g.index ? g.toNonIndexed() : g))), mat({ vertexColors: true, roughness: 0.85 }));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

export const vcMat = () => mat({ vertexColors: true, roughness: 0.38, metalness: 0.05 }, { rim: 0.28 });

// Warp pipe: lathe body with a flared lip, a paper band and a red band under the lip, and a
// dark inner well; one coloured geometry, origin at ground centre. Ink outline added by the caller.
export function pipeGeometry(height = 1.6, radius = 0.85, tint = 0x2fb356, lipTint = 0x66e083) {
  const s = new Statics();
  const steps = [
    [radius, 0],
    [radius, height - 0.55],
    [radius * 0.98, height - 0.5],
    [radius + 0.2, height - 0.46],
    [radius + 0.22, height - 0.3],
    [radius + 0.2, height - 0.06],
    [radius + 0.12, height],
    [radius - 0.06, height],
  ];
  const lathe = new LatheGeometry(steps.map(([r, y]) => new Vector2(r, y)), 28);
  s.add(lathe, tint, 0, 0, 0, 0, false);
  const g = s.parts[0];
  const col = g.attributes.color;
  const pos = g.attributes.position;
  const lip = new Color(lipTint);
  const base = new Color(tint);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.min(1, Math.max(0, (y - (height - 0.55)) / 0.55));
    const k = 0.82 + 0.18 * Math.min(1, y / height);
    col.setXYZ(i, (base.r + (lip.r - base.r) * t) * k, (base.g + (lip.g - base.g) * t) * k, (base.b + (lip.b - base.b) * t) * k);
  }
  // Paper band and signal-red band just under the lip.
  s.add(new CylinderGeometry(radius + 0.015, radius + 0.015, 0.1, 28), 0xf4ead4, 0, height - 0.62, 0, 0, false);
  s.add(new CylinderGeometry(radius + 0.02, radius + 0.02, 0.07, 28), 0xf50000, 0, height - 0.74, 0, 0, false);
  s.add(new CylinderGeometry(radius - 0.05, radius - 0.05, 0.04, 28), 0x061a0d, 0, height - 0.12, 0, 0, false);
  return mergeGeometries(s.parts);
}

// Ink hull instances for a set of source meshes (blocks, pipes): one draw call, synced per frame.
export function createHullInstances(geometry, sources, thick = 0.03) {
  const mesh = new InstancedMesh(geometry, hullMat(thick), sources.length);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  const sync = () => {
    sources.forEach((src, i) => {
      src.updateMatrix();
      mesh.setMatrixAt(i, src.matrix);
      mesh.visible = true;
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  sync();
  return { mesh, sync };
}

// Fake contact shadows: dark soft discs on the ground under props (one instanced draw call).
export function createContacts(spots) {
  const geo = new CircleGeometry(1, 20);
  geo.rotateX(-Math.PI / 2);
  const mesh = new InstancedMesh(geo, new MeshBasicMaterial({ color: 0x1a1208, transparent: true, opacity: 0.28, depthWrite: false }), spots.length);
  const o = new Object3D();
  spots.forEach((p, i) => {
    o.position.set(p.x, 0.075, p.z);
    o.scale.set(p.rx, 1, p.rz ?? p.rx);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  });
  mesh.renderOrder = 1;
  return mesh;
}

// Instanced coins (spinning discs). positions: [{x,y,z}], returns {mesh, update(t), hide(i)}.
export function createCoins(positions, still) {
  const geo = new CylinderGeometry(0.38, 0.38, 0.1, 14);
  geo.rotateX(Math.PI / 2);
  const mesh = new InstancedMesh(geo, mat({ color: 0xf2c230, metalness: 0.7, roughness: 0.3, emissive: 0xc88a00, emissiveIntensity: 0.6 }), positions.length);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.castShadow = true;
  const o = new Object3D();
  const alive = positions.map(() => true);
  const draw = (t) => {
    positions.forEach((p, i) => {
      o.position.set(p.x, p.y + (still ? 0 : Math.sin(t * 2 + i) * 0.08), p.z);
      o.rotation.y = still ? 0.5 : t * 3 + i;
      o.scale.setScalar(alive[i] ? 1 : 0.0001);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  draw(0);
  return {
    mesh,
    positions,
    alive,
    update: draw,
    take(i) {
      alive[i] = false;
    },
  };
}

// Puffy box clouds, instanced; they drift and wrap.
export function createClouds(count, spanX, still) {
  const geo = new BoxGeometry(1, 1, 1);
  const parts = 3;
  const mesh = new InstancedMesh(geo, mat({ color: 0xffffff }), count * parts);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const o = new Object3D();
  const seeds = Array.from({ length: count }, (_, i) => ({
    x: (i / count) * spanX - 30,
    y: 9 + ((i * 37) % 5),
    z: -16 - ((i * 53) % 12),
    s: 1.6 + ((i * 11) % 3) * 0.5,
  }));
  const draw = (t) => {
    seeds.forEach((c, i) => {
      const x = ((c.x + (still ? 0 : t * 0.4) + 30) % spanX) - 30;
      for (let k = 0; k < parts; k++) {
        o.position.set(x + (k - 1) * c.s * 0.9, c.y + (k === 1 ? 0.35 * c.s : 0), c.z);
        o.scale.set(c.s * (k === 1 ? 1.4 : 1), c.s * (k === 1 ? 1 : 0.7), c.s);
        o.updateMatrix();
        mesh.setMatrixAt(i * parts + k, o.matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  draw(0);
  return { mesh, update: draw };
}

// Particle pool (dust, sparkles, coin pops): one InstancedMesh of small cubes.
export function createParticles(max = 96) {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff }), max);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  const o = new Object3D();
  const p = Array.from({ length: max }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, g: 0 }));
  const col = new Color();
  let cursor = 0;
  const zero = new Object3D();
  zero.scale.setScalar(0.0001);
  zero.updateMatrix();
  for (let i = 0; i < max; i++) {
    mesh.setMatrixAt(i, zero.matrix);
    mesh.setColorAt(i, col.set(0xffffff));
  }
  return {
    mesh,
    enabled: true,
    emit(x, y, z, n, { color = 0xffffff, speed = 3, up = 2, size = 0.14, life = 0.5, gravity = 9 } = {}) {
      if (!this.enabled) return;
      for (let i = 0; i < n; i++) {
        const q = p[cursor];
        const a = Math.random() * Math.PI * 2;
        const sp = speed * (0.4 + Math.random() * 0.6);
        q.x = x;
        q.y = y;
        q.z = z;
        q.vx = Math.cos(a) * sp;
        q.vz = Math.sin(a) * sp;
        q.vy = up * (0.5 + Math.random());
        q.s = size * (0.7 + Math.random() * 0.6);
        q.life = q.max = life * (0.7 + Math.random() * 0.6);
        q.g = gravity;
        mesh.setColorAt(cursor, col.set(color));
        cursor = (cursor + 1) % max;
      }
      mesh.instanceColor.needsUpdate = true;
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        const q = p[i];
        if (q.life <= 0) {
          if (q.s !== 0) {
            q.s = 0;
            mesh.setMatrixAt(i, zero.matrix);
          }
          continue;
        }
        q.life -= dt;
        q.vy -= q.g * dt;
        q.x += q.vx * dt;
        q.y = Math.max(0.02, q.y + q.vy * dt);
        q.z += q.vz * dt;
        o.position.set(q.x, q.y, q.z);
        o.rotation.set(q.life * 6, q.life * 4, 0);
        o.scale.setScalar(q.s * Math.max(0, q.life / q.max));
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// Signal mast: pole, ball and a sliding flag. The pole is part of the statics; this builds the flag.
export function createFlag(x, y, z) {
  const g = new Group();
  const flag = new Mesh(new PlaneGeometry(1.6, 1.0), mat({ color: 0xf50000, side: 2, emissive: 0xf50000, emissiveIntensity: 5 }));
  flag.position.set(0.8, 0, 0);
  flag.castShadow = true;
  g.add(flag);
  const dot = new Mesh(new SphereGeometry(0.16, 10, 8), mat({ color: 0x0a0a0a }));
  dot.position.set(0.6, 0, 0.02);
  g.add(dot);
  g.position.set(x, y, z);
  return g;
}
