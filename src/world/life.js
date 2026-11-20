import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
} from "three";

// Ambient life around the player: drifting leaves, fireflies, a few birds and cloud shadows.
// Everything is instanced (4 draw calls) and wraps around the avatar, so it costs nothing far away.
export function createLife(scene, { reduced, coarse }) {
  const o = new Object3D();
  const c = new Color();

  // Leaves (flat quads that tumble down) and fireflies (bright blinking specks).
  const NL = reduced ? 0 : coarse ? 24 : 44;
  const NF = reduced ? 0 : coarse ? 8 : 16;
  const leaves = new InstancedMesh(new PlaneGeometry(0.26, 0.18), new MeshBasicMaterial({ side: DoubleSide }), Math.max(1, NL));
  leaves.instanceMatrix.setUsage(DynamicDrawUsage);
  leaves.frustumCulled = false;
  const flies = new InstancedMesh(new BoxGeometry(0.09, 0.09, 0.09), new MeshBasicMaterial({ color: 0xffffff }), Math.max(1, NF));
  flies.instanceMatrix.setUsage(DynamicDrawUsage);
  flies.frustumCulled = false;
  const tones = [0xd9482b, 0xf2c230, 0x57c46c, 0xe0903a, 0xf4ead4];
  const L = Array.from({ length: NL }, (_, i) => ({
    x: (Math.sin(i * 12.9898) * 43758.5453 % 1) * 30 - 15,
    y: 1 + ((i * 7) % 9) * 0.5,
    z: (Math.sin(i * 78.233) * 12345.6789 % 1) * 20 - 10,
    s: 0.6 + ((i * 13) % 7) * 0.1,
    p: i * 1.7,
  }));
  L.forEach((l, i) => leaves.setColorAt(i, c.set(tones[i % tones.length])));
  const F = Array.from({ length: NF }, (_, i) => ({
    x: (Math.sin(i * 31.7) * 999.9 % 1) * 26 - 13,
    y: 0.8 + ((i * 5) % 6) * 0.45,
    z: (Math.sin(i * 17.3) * 777.7 % 1) * 16 - 8,
    p: i * 2.3,
  }));
  F.forEach((f, i) => flies.setColorAt(i, c.set(0xffd860).multiplyScalar(3.2)));

  // Birds: two flapping wings each, circling high above the path.
  const wing = new BufferGeometry();
  wing.setAttribute("position", new Float32BufferAttribute([0, 0, 0, -1, 0.05, 0.25, -0.2, 0, -0.35, 0, 0, 0, 1, 0.05, 0.25, 0.2, 0, -0.35], 3));
  wing.computeVertexNormals();
  const NB = reduced ? 0 : 3;
  const birds = new InstancedMesh(wing, new MeshBasicMaterial({ color: 0x0a0a0a, side: DoubleSide }), Math.max(1, NB));
  birds.instanceMatrix.setUsage(DynamicDrawUsage);
  birds.frustumCulled = false;

  // Cloud shadows sliding over the ground.
  const NS = reduced ? 0 : 5;
  const sg = new CircleGeometry(1, 20);
  sg.rotateX(-Math.PI / 2);
  const shadows = new InstancedMesh(sg, new MeshBasicMaterial({ color: 0x10220c, transparent: true, opacity: 0.1, depthWrite: false }), Math.max(1, NS));
  shadows.instanceMatrix.setUsage(DynamicDrawUsage);
  shadows.frustumCulled = false;
  shadows.renderOrder = 1;

  if (NL) scene.add(leaves);
  if (NF) scene.add(flies);
  if (NB) scene.add(birds);
  if (NS) scene.add(shadows);

  // Jump scatter: fireflies near the courier burst outward and settle back (decays over ~2 s).
  let burst = null;
  const wrap = (v, center, half) => ((((v - center + half) % (half * 2)) + half * 2) % (half * 2)) - half + center;

  return {
    scatter(x, z) {
      burst = { x, z, t: -1 };
    },
    update(dt, t, px, pz) {
      if (reduced) return;
      if (burst && burst.t < 0) burst.t = t;
      const age = burst ? t - burst.t : 99;
      if (age > 2.5) burst = null;
      for (let i = 0; i < NL; i++) {
        const l = L[i];
        const x = wrap(l.x + Math.sin(t * 0.6 + l.p) * 1.5 + t * 0.5, px, 15);
        const z = wrap(l.z + Math.cos(t * 0.5 + l.p) * 1.2, pz, 10);
        const y = 0.3 + ((l.y - t * 0.35 * l.s) % 4.2 + 4.2) % 4.2;
        o.position.set(x, y, z);
        o.rotation.set(t * 2 + l.p, t * 1.4 + l.p, t * 1.1);
        o.scale.setScalar(1);
        o.updateMatrix();
        leaves.setMatrixAt(i, o.matrix);
      }
      leaves.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < NF; i++) {
        const f = F[i];
        let x = wrap(f.x + Math.sin(t * 0.8 + f.p) * 1.2, px, 13);
        let z = wrap(f.z + Math.cos(t * 0.7 + f.p) * 1.2, pz, 8);
        let y = f.y + Math.sin(t * 1.3 + f.p) * 0.35;
        if (burst) {
          const dx = x - burst.x;
          const dz = z - burst.z;
          const d = Math.max(0.3, Math.hypot(dx, dz));
          const k = Math.max(0, 1 - d / 6) * Math.exp(-age * 1.5) * 3.2;
          x += (dx / d) * k;
          z += (dz / d) * k;
          y += k * 0.7;
        }
        o.position.set(x, y, z);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(0.5 + 0.5 * Math.max(0, Math.sin(t * 2.4 + f.p)));
        o.updateMatrix();
        flies.setMatrixAt(i, o.matrix);
      }
      flies.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < NB; i++) {
        const a = t * (0.18 + i * 0.05) + i * 2.1;
        const r = 16 + i * 5;
        o.position.set(px + Math.cos(a) * r, 14 + i * 1.6 + Math.sin(t + i) * 0.5, pz - 8 + Math.sin(a) * (r * 0.5));
        o.rotation.set(0, -a + Math.PI, Math.cos(a) * 0.3);
        const flap = Math.sin(t * 9 + i * 2) * 0.9;
        o.scale.set(1.3 * (0.6 + 0.4 * Math.abs(flap)), 1 + Math.abs(flap) * 0.2, 1);
        o.updateMatrix();
        birds.setMatrixAt(i, o.matrix);

      }
      birds.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < NS; i++) {
        const x = wrap(i * 17 + t * 1.1, px, 40);
        const z = (i % 2 ? -1 : 1) * (2 + (i * 3.7) % 7);
        o.position.set(x, 0.085, z);
        o.rotation.set(0, 0, 0);
        o.scale.set(7 + (i % 3) * 2, 1, 4 + (i % 2) * 2);
        o.updateMatrix();
        shadows.setMatrixAt(i, o.matrix);
      }
      shadows.instanceMatrix.needsUpdate = true;
    },
  };
}
