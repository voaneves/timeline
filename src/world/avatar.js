import { CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Spring, clamp } from "./springs.js";
import { mat, hullMat } from "./materials.js";

// Original stylised courier: a big head (about 40% of the height), a bold signal-red jacket,
// cream trousers, ink sneakers, an ink backpack and a red-and-paper scarf whose tail trails
// with speed (lagging chain). Ink outlines for a readable silhouette. Procedural animation:
// run cycle with knee lift and torso twist, lean, squash and stretch, blink, breathing.
export function createAvatar() {
  const root = new Group();
  const body = new Group();
  root.add(body);

  const hull = hullMat(0.04);
  const outline = (m, k = 1) => {
    const h = new Mesh(m.geometry, hull);
    h.scale.setScalar(1 + (k - 1) * 0);
    m.add(h);
    return m;
  };

  const jacket = mat({ color: 0xe20a0a });
  const jacketDark = mat({ color: 0xb80000 });
  const cream = mat({ color: 0xf4ead4 });
  const skin = mat({ color: 0xe0ac82 });
  const hair = mat({ color: 0x20150f });
  const ink = mat({ color: 0x14110f });
  const eyeMat = mat({ color: 0x0a0a0a }, { rim: 0 });
  
  // Torso
  const torso = new Group();
  torso.position.y = 1.02;
  const chest = outline(new Mesh(new RoundedBoxGeometry(0.78, 0.66, 0.52, 3, 0.2), jacket));
  const hem = (new Mesh(new RoundedBoxGeometry(0.82, 0.16, 0.56, 3, 0.07), jacketDark));
  hem.position.y = -0.3;
  const pack = outline(new Mesh(new RoundedBoxGeometry(0.52, 0.52, 0.26, 3, 0.1), ink));
  pack.position.set(0, 0.02, -0.38);
  torso.add(chest, hem, pack);

  // Head (big)
  const head = new Group();
  head.position.y = 1.58;
  const skull = outline(new Mesh(new SphereGeometry(0.42, 22, 16), skin));
  skull.scale.set(1.04, 1, 0.98);
  const hairCap = (new Mesh(new SphereGeometry(0.45, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hair));
  hairCap.position.set(0, 0.02, -0.03);
  hairCap.rotation.x = -0.3;
  const swoop = (new Mesh(new SphereGeometry(0.26, 12, 10), hair));
  swoop.scale.set(1.35, 0.72, 1);
  swoop.position.set(0.06, 0.38, 0.12);
  const eyeL = new Mesh(new SphereGeometry(0.065, 10, 10), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.15, 0.02, 0.37);
  eyeR.position.set(0.15, 0.02, 0.37);
  head.add(skull, hairCap, swoop, eyeL, eyeR);

  // Scarf: neck ring plus a trailing tail of 4 lagging segments.
  const neck = (new Mesh(new TorusGeometry(0.27, 0.1, 8, 16), jacket));
  neck.rotation.x = Math.PI / 2;
  neck.position.y = 1.34;
  const tail = new Group();
  tail.position.set(0.12, 1.32, -0.24);
  const segs = [];
  let parent = tail;
  for (let i = 0; i < 3; i++) {
    const g = new Group();
    const m = new Mesh(new RoundedBoxGeometry(0.2, 0.05, 0.22, 1, 0.02), i % 2 ? cream : jacket);
    m.position.z = -0.11;
    g.add(m);
    g.position.z = i === 0 ? 0 : -0.22;
    parent.add(g);
    parent = g;
    segs.push({ g, ang: -0.9 });
  }

  const armGeo = new RoundedBoxGeometry(0.22, 0.56, 0.22, 2, 0.09);
  armGeo.translate(0, -0.24, 0);
  const mkArm = (x) => {
    const g = new Group();
    g.position.set(x, 1.22, 0);
    const a = new Mesh(armGeo, jacket);
    const hand = (new Mesh(new SphereGeometry(0.12, 10, 8), skin));
    hand.position.y = -0.56;
    g.add(a, hand);
    return g;
  };
  const armL = mkArm(-0.5);
  const armR = mkArm(0.5);

  const legGeo = new RoundedBoxGeometry(0.28, 0.6, 0.3, 2, 0.11);
  legGeo.translate(0, -0.26, 0);
  const mkLeg = (x) => {
    const g = new Group();
    g.position.set(x, 0.72, 0);
    const l = outline(new Mesh(legGeo, cream));
    const s = new Mesh(new RoundedBoxGeometry(0.34, 0.22, 0.52, 2, 0.1), ink);
    s.position.set(0, -0.56, 0.08);
    g.add(l, s);
    return g;
  };
  const legL = mkLeg(-0.18);
  const legR = mkLeg(0.18);

  body.add(torso, head, neck, tail, armL, armR, legL, legR);
  root.traverse((o) => {
    if (o.isMesh && o.material !== hull) o.castShadow = true;
  });
  void CylinderGeometry;

  const squash = new Spring(320, 13);
  let yaw = 0;
  let phase = 0;
  let lean = 0;
  let lookYaw = 0;
  let clock = 0;
  let blink = 3;

  return {
    root,
    jump() {
      squash.kick(5.5);
    },
    land(speed) {
      squash.kick(-clamp(speed * 0.55, 0, 9));
    },
    update(dt, s) {
      clock += dt;
      const speed = Math.hypot(s.vx, s.vz);
      if (speed > 0.4) {
        const target = Math.atan2(s.vx, s.vz);
        let d = target - yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 14);
      }
      root.rotation.y = yaw;
      const sq = squash.update(dt);
      const breathe = s.grounded && speed < 0.4 ? Math.sin(clock * 2.2) * 0.02 : 0;
      body.scale.set(1 - sq * 0.5 - breathe * 0.4, 1 + sq + breathe, 1 - sq * 0.5 - breathe * 0.4);
      const sp = Math.min(1, speed / 6);
      lean += ((s.grounded ? sp * 0.28 : 0.16) - lean) * Math.min(1, dt * 10);
      body.rotation.x = lean;
      phase += dt * (4 + speed * 1.75);
      const sw = Math.sin(phase) * sp * 1.15;
      const lift = Math.max(0, Math.cos(phase)) * sp * 0.16;
      const lift2 = Math.max(0, -Math.cos(phase)) * sp * 0.16;
      legL.rotation.x = s.grounded ? sw : 0.5;
      legR.rotation.x = s.grounded ? -sw : -0.7;
      legL.position.y = 0.72 + (s.grounded ? lift : 0.12);
      legR.position.y = 0.72 + (s.grounded ? lift2 : 0);
      armL.rotation.x = s.grounded ? -sw * 1.1 : -2.2;
      armR.rotation.x = s.grounded ? sw * 1.1 : -2.2;
      armL.rotation.z = s.grounded ? 0.05 : 0.7;
      armR.rotation.z = s.grounded ? -0.05 : -0.7;
      torso.rotation.y = s.grounded ? Math.sin(phase) * 0.18 * sp : 0;
      body.position.y = s.grounded ? Math.abs(Math.sin(phase)) * 0.1 * sp : 0;
      // Scarf tail: streams back with speed, each segment lagging more than the last.
      const flutter = clock * 11;
      segs.forEach((sg, i) => {
        const target = -0.95 + sp * 1.25 + Math.sin(flutter + i * 0.9) * 0.12 * (0.3 + sp) + (s.grounded ? 0 : s.vy ? clamp(-s.vy * 0.04, -0.5, 0.5) : 0);
        sg.ang += (target - sg.ang) * Math.min(1, dt * (16 - i * 3));
        sg.g.rotation.x = i === 0 ? sg.ang : (sg.ang - segs[i - 1].ang) * 0.8 + 0.05;
      });
      let want = 0;
      if (speed < 0.4 && s.look !== null) {
        const d = s.look - yaw;
        want = clamp(Math.atan2(Math.sin(d), Math.cos(d)), -0.9, 0.9);
      }
      lookYaw += (want - lookYaw) * Math.min(1, dt * 8);
      head.rotation.y = lookYaw;
      head.rotation.x = s.grounded ? -sp * 0.08 : -0.18;
      blink -= dt;
      const closed = blink < 0.12 && blink > 0;
      eyeL.scale.y = eyeR.scale.y = closed ? 0.1 : 1;
      if (blink <= 0) blink = 2.4 + Math.random() * 3;
    },
    setVisible(v) {
      root.visible = v;
    },
  };
}
