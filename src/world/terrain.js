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
  const dry = new Color(0xc2b252);
  const sand = new Color(0xe6d39a);
  const rock = new Color(0x8a8d6a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const m = clamp(h / 5, 0, 1);
    // First zone is dry cerrado, fading to green.
    c.copy(grass).lerp(dry, 1 - smooth(10, 44, x));
    c.lerp(hill, m * 0.8);
    if (m > 0.75) c.lerp(rock, (m - 0.75) * 1.3);
    if (h < 0.05 && island(x, z) > 0.8) c.lerp(sand, smooth(0.8, 0.88, island(x, z)));
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
  const bladeGeo = new PlaneGeometry(0.14, 0.7, 1, 3);
  bladeGeo.translate(0, 0.35, 0);
  const bp = bladeGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setX(i, bp.getX(i) * (1 - bp.getY(i) / 0.9));
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
      const s = 0.7 + rand(i, 4) * 1.0;
      o.scale.set(s, s * (0.8 + rand(i, 5) * 0.6), s);
      o.updateMatrix();
      mesh.setMatrixAt(n, o.matrix);
      cc.setHSL(0.27 + rand(i, 6) * 0.06 - (1 - smooth(10, 44, x)) * 0.1, 0.62, 0.27 + rand(i, 7) * 0.14);
      mesh.setColorAt(n, cc);
      n++;
    }
    mesh.count = n;
    return mesh;
  };

  // Composed trees and rocks go into the shared static geometry.
  const scatter = (statics, avoid) => {
    for (let i = 0; i < 130; i++) {
      const x = X0 + 4 + rand(i, 11) * (W - 8);
      const z = rand(i, 12) < 0.8 ? -(11 + rand(i, 13) * 22) : 24 + rand(i, 13) * 10;
      if (avoid(x, z)) continue;
      const h = heightAt(x, z);
      if (h < 0.1) continue;
      const s = 0.8 + rand(i, 14) * 0.9;
      if (rand(i, 15) < 0.72) {
        const g = new CylinderGeometry(0.18 * s, 0.26 * s, 1.5 * s, 7);
        statics.add(g, 0x7a4a24, x, h + 0.75 * s, z);
        const tones = [0x2f8f4a, 0x3fae5a, 0x57c46c];
        for (let k = 0; k < 3; k++) {
          const f = new IcosahedronGeometry((1.25 - k * 0.28) * s, 1);
          f.scale(1, 0.85, 1);
          statics.add(f, tones[k], x, h + (1.9 + k * 0.85) * s, z);
        }
      } else {
        const r = new IcosahedronGeometry(0.7 * s, 0);
        r.scale(1.2, 0.8, 1);
        statics.add(r, i % 2 ? 0x9a9d86 : 0x80836e, x, h + 0.25 * s, z);
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
