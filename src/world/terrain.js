import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
} from "three";
import { mat, uniforms } from "./materials.js";
import { clamp } from "./springs.js";

// Deterministic noise (no Math.random: the island looks the same every visit).
const hash = (x, z) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const vnoise = (x, z) => {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export const rand = (i, salt = 0) => hash(i * 1.37 + salt, i * 0.71 - salt);

export function createTerrain(END) {
  const X0 = -34;
  const X1 = END + 30;
  const Z = 46;
  const cx = (X0 + X1) / 2;
  const rx = (X1 - X0) / 2;
  const island = (x, z) => Math.hypot((x - cx) / rx, z / Z);
  // Flat inside the play area (|z| <= 11, x within the track), hills and a beach outside.
  const heightAt = (x, z) => {
    const az = Math.abs(z);
    const outside = Math.max(0, -14 - x, x - (END + 1));
    const m = Math.max(smooth(10, 24, az), smooth(0, 12, outside));
    const n = vnoise(x * 0.09, z * 0.09) * 0.7 + vnoise(x * 0.23, z * 0.23) * 0.3;
    let h = m * (2.4 + n * 5.2);
    h += (vnoise(x * 0.35, z * 0.35) - 0.5) * 0.35 * m;
    h -= smooth(0.8, 1.0, island(x, z)) * 7;
    return h;
  };

  // Terrain mesh with baked vertex colours (zone tint, hill tint, beach, ambient occlusion).
  const W = X1 - X0;
  const sx = Math.round(W / 1.4);
  const sz = Math.round((Z * 2) / 1.4);
  const geo = new PlaneGeometry(W, Z * 2, sx, sz);
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, 0, 0);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new Color();
  const grass = new Color(0x58b64f);
  const hill = new Color(0x6fc261);
  const dry = new Color(0xd9c07a);
  const sand = new Color(0xe6d39a);
  const paper = new Color(0xefe3c2);
  const rock = new Color(0x8a8d6a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const m = clamp(h / 5, 0, 1);
    // Paper-cream play area fading into green hills; a faint ochre tint in the first zone.
    const az = Math.abs(z);
    const flat = 1 - smooth(8.5, 15, az) * (1 - smooth(0, 10, Math.max(0, -14 - x, x - (END + 1))));
    c.copy(grass).lerp(hill, m * 0.8);
    if (m > 0.75) c.lerp(rock, (m - 0.75) * 1.3);
    c.lerp(paper, flat * 0.85);
    c.lerp(dry, (1 - smooth(10, 44, x)) * 0.35 * flat);
    if (h < 0.05 && island(x, z) > 0.8) c.lerp(sand, smooth(0.8, 0.88, island(x, z)));
    // Darker edge gradient along the play-area borders.
    c.multiplyScalar(1 - smooth(5, 9.5, az) * 0.12 * flat);
    // AO: darker in dips and toward the water, a touch of noise.
    const ao = 0.82 + 0.18 * clamp(h / 3 + 0.5, 0, 1) - smooth(0.9, 1.0, island(x, z)) * 0.3;
    const nz = 0.93 + vnoise(x * 0.5, z * 0.5) * 0.14;
    col[i * 3] = c.r * ao * nz;
    col[i * 3 + 1] = c.g * ao * nz;
    col[i * 3 + 2] = c.b * ao * nz;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const terrain = new Mesh(geo, mat({ vertexColors: true, roughness: 1 }, { rim: 0.12 }));
  terrain.receiveShadow = true;

  // Water ring: fresnel + animated ripples + a foam line where the island meets the sea.
  const water = new Mesh(
    new PlaneGeometry(W + 400, Z * 2 + 400, 1, 1).rotateX(-Math.PI / 2),
    new ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: uniforms.uTime,
        uC: { value: [cx, rx, Z] },
        uDeep: { value: new Color(0x1f8fb5) },
        uShallow: { value: new Color(0x7fe0d0) },
        uSky: { value: new Color(0xbfe4f8) },
      },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uC; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky;
        varying vec3 vW;
        void main(){
          float d = length(vec2((vW.x - uC.x) / uC.y, vW.z / uC.z));
          float shore = clamp((d - 0.86) / 0.5, 0.0, 1.0);
          float wave = sin(vW.x * 0.9 + uTime * 1.3) * sin(vW.z * 0.8 - uTime * 1.1) * 0.5 + 0.5;
          vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 0.55, shore));
          base += wave * 0.05;
          float edge = 0.86 + 0.02 * sin(vW.x * 0.35 + uTime * 0.9) + 0.012 * sin(vW.z * 0.6 + uTime * 1.7);
          float foam = smoothstep(0.022, 0.0, abs(d - edge - 0.045 - sin(uTime * 0.8) * 0.006));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
          vec3 col = mix(base, uSky, fres * 0.6) + foam * 0.9;
          gl_FragColor = vec4(col, 0.94);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
  );
  water.position.set(0, -1.7, 0);

  // Grass: thousands of blades, one draw call, swaying in the vertex shader.
  const bladeGeo = new PlaneGeometry(0.2, 0.7, 1, 3);
  bladeGeo.translate(0, 0.35, 0);
  const bp = bladeGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setX(i, bp.getX(i) * Math.pow(1 - bp.getY(i) / 0.86, 1.2));
  const makeGrass = (count, avoid) => {
    const mesh = new InstancedMesh(bladeGeo, mat({ roughness: 1, side: 2 }, { sway: true, rim: 0.1 }), count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const o = new Object3D();
    const cc = new Color();
    let n = 0;
    for (let i = 0; n < count && i < count * 4; i++) {
      const x = X0 + 6 + rand(i, 1) * (W - 12);
      const z = (rand(i, 2) - 0.5) * 2 * 30;
      if (avoid(x, z)) continue;
      const h = heightAt(x, z);
      if (h < -0.05) continue;
      o.position.set(x, h - 0.02, z);
      o.rotation.set(0, rand(i, 3) * 6.28, 0);
      const s = 0.55 + rand(i, 4) * 0.7;
      o.scale.set(s, s * (0.8 + rand(i, 5) * 0.6), s);
      o.updateMatrix();
      mesh.setMatrixAt(n, o.matrix);
      cc.setHSL(0.27 + rand(i, 6) * 0.08 - (1 - smooth(10, 44, x)) * 0.05, 0.55 + rand(i, 8) * 0.2, 0.22 + rand(i, 7) * 0.18);
      mesh.setColorAt(n, cc);
      n++;
    }
    mesh.count = n;
    return mesh;
  };

  // Composed trees and rocks go into the shared static geometry.
  const scatter = (statics, avoid) => {
    for (let i = 0; i < 100; i++) {
      const x = X0 + 4 + rand(i, 11) * (W - 8);
      const z = rand(i, 12) < 0.8 ? -(11 + rand(i, 13) * 22) : 24 + rand(i, 13) * 10;
      if (avoid(x, z)) continue;
      const h = heightAt(x, z);
      if (h < 0.1) continue;
      const s = 0.8 + rand(i, 14) * 0.9;
      const kind = rand(i, 15);
      const trunk = (r0, r1, hh, color = 0x6b3f1f) => statics.add(new CylinderGeometry(r0 * s, r1 * s, hh * s, 7), color, x, h + (hh / 2) * s, z);
      const blob = (r, yy, color, sx = 1, sy = 0.9, ox = 0, oz = 0) => {
        const g = new IcosahedronGeometry(r * s, 1);
        g.scale(sx, sy, sx);
        statics.add(g, color, x + ox * s, h + yy * s, z + oz * s);
      };
      if (kind < 0.3) {
        // round canopy, cluster of blobs
        trunk(0.2, 0.28, 1.6);
        const c = rand(i, 16) < 0.12 ? 0xd9482b : 0x3fae5a;
        blob(1.3, 2.4, c);
        blob(0.9, 3.0, c === 0xd9482b ? 0xf06a3a : 0x57c46c, 1, 0.9, 0.5, 0.3);
        blob(0.8, 2.3, 0x2f8f4a, 1, 0.9, -0.8, -0.3);
      } else if (kind < 0.5) {
        // tall cypress
        trunk(0.14, 0.2, 0.9);
        blob(0.75, 2.2, 0x2f8f4a, 0.7, 2.0);
        blob(0.5, 3.6, 0x3fae5a, 0.7, 1.6);
      } else if (kind < 0.62) {
        // umbrella
        trunk(0.12, 0.2, 2.3);
        blob(1.9, 2.7, 0x57c46c, 1, 0.32);
        blob(1.2, 3.0, 0x3fae5a, 1, 0.3);
      } else if (kind < 0.78) {
        // layered pine
        trunk(0.16, 0.22, 1.0);
        for (let k = 0; k < 3; k++) {
          const cone = new ConeGeometry((1.2 - k * 0.3) * s, 1.3 * s, 7);
          statics.add(cone, k % 2 ? 0x2f8f4a : 0x3fae5a, x, h + (1.5 + k * 0.85) * s, z);
        }
      } else {
        // chunky flat-shaded rocks
        for (let k = 0; k < 2; k++) {
          const r = new IcosahedronGeometry((0.9 - k * 0.3) * s, 0);
          const pp = r.attributes.position;
          for (let q = 0; q < pp.count; q++) {
            const px = pp.getX(q);
            const py = pp.getY(q);
            const pz = pp.getZ(q);
            const f = 1 + 0.28 * (hash(px * 7.1 + py * 3.3 + k, pz * 5.7 + i) - 0.5);
            pp.setXYZ(q, px * f * 1.2, py * f * 0.8, pz * f);
          }
          r.computeVertexNormals();
          statics.add(r, k ? 0xa6a894 : 0x80836e, x + k * 0.9 * s, h + (0.3 + k * 0.1) * s, z + k * 0.4 * s);
        }
      }
    }
  };

  return { heightAt, terrain, water, makeGrass, scatter, island, bounds: { X0, X1, Z } };
}

// Round puffy clouds drifting across the sky (instanced spheres).
export function createCloudsRound(spanX, still) {
  const geo = new SphereGeometry(1, 12, 9);
  const per = 5;
  const count = 16;
  const mesh = new InstancedMesh(geo, mat({ color: 0xffffff, roughness: 1, emissive: 0x6a7f90, emissiveIntensity: 0.35 }, { rim: 0.0 }), count * per);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  const o = new Object3D();
  const draw = (t) => {
    for (let i = 0; i < count; i++) {
      const s = 1.6 + (i % 3) * 0.6;
      const x0 = (i / count) * spanX - 40 + (still ? 0 : t * (0.35 + (i % 4) * 0.08));
      const x = ((x0 + 40) % spanX) - 40;
      const y = 11 + ((i * 37) % 7);
      const z = -26 - ((i * 53) % 14);
      for (let k = 0; k < per; k++) {
        o.position.set(x + (k - 2) * s * 0.85, y + (k === 1 || k === 3 ? 0.4 * s : 0), z + (k % 2) * 0.5);
        const sc = s * (k === 2 ? 1.1 : 0.8);
        o.scale.set(sc * 1.2, sc * 0.75, sc);
        o.updateMatrix();
        mesh.setMatrixAt(i * per + k, o.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  draw(0);
  return { mesh, update: draw };
}

export { ConeGeometry };
