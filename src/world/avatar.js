import { CircleGeometry, ConeGeometry, Group, Mesh, SphereGeometry, CylinderGeometry } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Spring, clamp } from "./springs.js";
import { mat } from "./materials.js";

// Original stylised character with a readable silhouette: ink hoodie with a big hood and
// a signal-dot badge, cream trousers, chunky sneakers, a little backpack and a hair swoop.
// Procedural animation only (bob, arm swing, lean, squash and stretch, blink, breathing).
export function createAvatar() {
  const root = new Group();
  const body = new Group();
  root.add(body);

  const hood = mat({ color: 0x14110f, roughness: 0.8 });
  const cream = mat({ color: 0xf4ead4, roughness: 0.7 });
  const skin = mat({ color: 0xd9a679, roughness: 0.65 });
  const hair = mat({ color: 0x2b1d14, roughness: 0.5 });
  const shoe = mat({ color: 0xdcd5c2, roughness: 0.6 });
  const sole = mat({ color: 0xf50000, roughness: 0.5, emissive: 0xf50000, emissiveIntensity: 1.1 });
  const eyeMat = mat({ color: 0x0a0a0a, roughness: 0.3 }, { rim: 0 });

  const torso = new Group();
  torso.position.y = 0.95;
  const chest = new Mesh(new RoundedBoxGeometry(0.78, 0.74, 0.5, 3, 0.2), hood);
  const hem = new Mesh(new RoundedBoxGeometry(0.82, 0.2, 0.54, 3, 0.09), cream);
  hem.position.y = -0.36;
  const badge = new Mesh(new CircleGeometry(0.1, 14), sole);
  badge.position.set(0.17, 0.08, 0.256);
  const pack = new Mesh(new RoundedBoxGeometry(0.5, 0.56, 0.26, 3, 0.1), mat({ color: 0xf4ead4, roughness: 0.7 }));
  pack.position.set(0, 0.04, -0.36);
  const stripe = new Mesh(new RoundedBoxGeometry(0.52, 0.09, 0.28, 2, 0.03), sole);
  stripe.position.set(0, 0.16, -0.36);
  torso.add(chest, hem, badge, pack, stripe);

  const head = new Group();
  head.position.y = 1.62;
  const skull = new Mesh(new SphereGeometry(0.3, 18, 14), skin);
  skull.scale.set(1, 1.04, 0.96);
  const hoodRing = new Mesh(new SphereGeometry(0.34, 16, 12, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), hood);
  hoodRing.position.set(0, -0.06, -0.04);
  const hairCap = new Mesh(new SphereGeometry(0.32, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
  hairCap.position.set(0, 0.02, -0.02);
  hairCap.rotation.x = -0.25;
  const swoop = new Mesh(new SphereGeometry(0.2, 10, 8), hair);
  swoop.scale.set(1.3, 0.7, 1);
  swoop.position.set(0.04, 0.29, 0.08);
  const eyeL = new Mesh(new SphereGeometry(0.045, 8, 8), eyeMat);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.11, 0.03, 0.27);
  eyeR.position.set(0.11, 0.03, 0.27);
  const nose = new Mesh(new SphereGeometry(0.04, 8, 6), skin);
  nose.position.set(0, -0.04, 0.3);
  head.add(skull, hoodRing, hairCap, swoop, eyeL, eyeR, nose);

  const armGeo = new RoundedBoxGeometry(0.2, 0.55, 0.2, 2, 0.08);
  armGeo.translate(0, -0.24, 0);
  const mkArm = (x) => {
    const g = new Group();
    g.position.set(x, 1.3, 0);
    const a = new Mesh(armGeo, hood);
    const cuff = new Mesh(new SphereGeometry(0.115, 10, 8), cream);
    cuff.position.y = -0.56;
    g.add(a, cuff);
    return g;
  };
  const armL = mkArm(-0.5);
  const armR = mkArm(0.5);

  const legGeo = new RoundedBoxGeometry(0.26, 0.58, 0.28, 2, 0.1);
  legGeo.translate(0, -0.25, 0);
  const mkLeg = (x) => {
    const g = new Group();
    g.position.set(x, 0.62, 0);
    const l = new Mesh(legGeo, cream);
    const s = new Mesh(new RoundedBoxGeometry(0.3, 0.2, 0.46, 2, 0.09), shoe);
    s.position.set(0, -0.52, 0.07);
    const so = new Mesh(new RoundedBoxGeometry(0.31, 0.06, 0.47, 1, 0.025), sole);
    so.position.set(0, -0.62, 0.07);
    g.add(l, s, so);
    return g;
  };
  const legL = mkLeg(-0.17);
  const legR = mkLeg(0.17);

  body.add(torso, head, armL, armR, legL, legR);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
    }
  });
  void ConeGeometry;
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
      const breathe = s.grounded && speed < 0.4 ? Math.sin(clock * 2.2) * 0.018 : 0;
      body.scale.set(1 - sq * 0.5 - breathe * 0.4, 1 + sq + breathe, 1 - sq * 0.5 - breathe * 0.4);
      lean += ((s.grounded ? Math.min(speed, 8) * 0.03 : 0.12) - lean) * Math.min(1, dt * 10);
      body.rotation.x = lean;
      phase += dt * (3 + speed * 1.6);
      const swing = s.grounded ? Math.min(1, speed / 3) * 1.0 : 0;
      const sw = Math.sin(phase) * swing;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      armL.rotation.x = -sw * 1.0 - (s.grounded ? 0 : 1.2);
      armR.rotation.x = sw * 1.0 - (s.grounded ? 0 : 1.2);
      armL.rotation.z = s.grounded ? 0.04 : 0.5;
      armR.rotation.z = s.grounded ? -0.04 : -0.5;
      body.position.y = s.grounded ? Math.abs(Math.sin(phase)) * 0.07 * Math.min(1, speed / 3) : 0;
      let want = 0;
      if (speed < 0.4 && s.look !== null) {
        const d = s.look - yaw;
        want = clamp(Math.atan2(Math.sin(d), Math.cos(d)), -0.9, 0.9);
      }
      lookYaw += (want - lookYaw) * Math.min(1, dt * 8);
      head.rotation.y = lookYaw;
      head.rotation.x = s.grounded ? 0 : -0.15;
      // Blink.
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
