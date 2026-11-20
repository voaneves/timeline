import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mat, uniforms } from "./materials.js";
import { createTerrain, createCloudsRound, rand } from "./terrain.js";
import { createPost } from "./post.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRenderer } from "./renderer.js";
import { readContent } from "./content.js";
import { makeBlockAtlas, makeDotAtlas, cellUV, makeLabelAtlas, labelPlane } from "./textures.js";
import { Statics, vcMat, pipeGeometry, createCoins, createParticles, createFlag } from "./props.js";
import { createAvatar } from "./avatar.js";
import { createInput } from "./input.js";
import { createFollowCamera } from "./camera.js";
import { createUI } from "./ui.js";
import { createSfx } from "./sfx.js";
import { createBody, stepBody, boxAt, STEP } from "./physics.js";
import { Spring, createTweens, clamp, easeOut, easeInOut } from "./springs.js";

// Sky colours mirror the world.sky tokens (tokens/timeline.tokens.json).
const SKY = { light: ["#9fd4f5", "#e6f4ff"], dark: ["#0a0a0a", "#1a1a1a"] };
const isDark = () => {
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced) return forced === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};
const skyTexture = (top, bottom) => {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

const roadZ = (x) => {
  const k = clamp((x - 8) / 20, 0, 1);
  return Math.sin((x - 8) * 0.07) * 2.4 * k;
};

export async function start({ container, onFallback, onExit }) {
  const stage = container.parentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrow = () => stage.clientWidth < 700;
  const content = readContent();
  try {
    await document.fonts.ready;
  } catch (e) {}

  const rig = createRenderer(container, { onFallback, animate: true });
  const { scene, camera } = rig;
  const tweens = createTweens();
  const sfx = createSfx(true);

  // ---- Sky, fog, lights --------------------------------------------------
  const applySky = () => {
    const [top, bottom] = SKY[isDark() ? "dark" : "light"];
    if (scene.background && scene.background.dispose) scene.background.dispose();
    scene.background = skyTexture(top, bottom);
    scene.fog = new FogExp2(new Color(bottom).lerp(new Color(0xffffff), 0.1), 0.0065);
  };
  applySky();
  const themeObserver = new MutationObserver(applySky);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", applySky);

  scene.add(new HemisphereLight(0xcfe8ff, 0x8a6a3a, 0.55));
  const sun = new DirectionalLight(0xfff0d8, 2.2);
  sun.position.set(8, 14, 6);
  const shadows = rig.renderer.shadowMap.enabled;
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    const s = sun.shadow.camera;
    s.left = -13;
    s.right = 13;
    s.top = 13;
    s.bottom = -13;
    s.near = 1;
    s.far = 44;
  }
  scene.add(sun, sun.target);

  // ---- Layout ----------------------------------------------------------------
  const boxes = []; // static colliders
  const interactables = [];
  const statics = new Statics();
  const labels = []; // label atlas texts
  const labelSpots = []; // [index, x, y, z]
  const addLabel = (text, x, y, z, w = 3) => {
    labels.push(text);
    labelSpots.push([labels.length - 1, x, y, z, w]);
  };

  // Eras along +x. Blocks float at y 3.2 over the winding road.
  let cx = 12;
  const zones = [{ x0: -100, name: "Cruzamento", info: "Cruzamento: Carreira, Projetos ou Contato" }];
  const blocks = [];
  const coinPos = [];
  content.eras.forEach((era, ei) => {
    const x0 = cx;
    zones.push({
      x0: x0 - 4,
      name: `Zona ${era.n}: ${era.name}`,
      info: `Zona ${era.n}: ${era.name}, ${era.entries.length} marcos`,
    });
    // coin before the first block, then between blocks
    coinPos.push({ x: cx + 0.5, y: 1.3, z: roadZ(cx + 0.5) });
    era.entries.forEach((en, k) => {
      const bx = cx + 3.5;
      const bz = roadZ(bx);
      blocks.push({ en, x: bx, z: bz, era: ei });
      if (k < era.entries.length - 1) coinPos.push({ x: bx + 3.5, y: 1.3 + (k % 2) * 0.6, z: roadZ(bx + 3.5) });
      cx += 7;
    });
    cx += 4;
  });
  const eraEnd = cx;

  // Project plaza and the staircase to the signal mast.
  const xp = eraEnd + 12;
  const plazaStart = eraEnd - 2;
  zones.push({ x0: xp - 12, name: "Projetos", info: `Projetos: ${content.projects.length} tubos para entrar` });
  const sx = xp + 13; // stairs start
  const mx = sx + 11; // mast x
  zones.push({ x0: sx - 2, name: "Contato", info: "Contato: o mastro de sinal, fim da fase" });
  const END = sx + 16;

  // Terrain (flat play area, hills, beach), water ring, grass and trees. The play area is
  // flat at y = 0 so the kinematic physics stays simple; the hills are scenery only.
  const T = createTerrain(END);
  scene.add(T.terrain, T.water);
  statics.add(new CylinderGeometry(6.4, 6.4, 0.06, 40), 0xe3d3a4, 0, 0.02, 1, 0, false); // crossroads pad
  statics.add(new CylinderGeometry(7.5, 7.5, 0.06, 40), 0xe3d3a4, xp + 3, 0.02, 0, 0, false); // plaza pad
  for (let x = 6; x < eraEnd - 4; x += 2) {
    const z = roadZ(x + 1);
    const a = Math.atan2(roadZ(x + 2) - roadZ(x), 2);
    const g = new BoxGeometry(2.3, 0.06, 3.6);
    statics.add(g, 0xe3d3a4, x + 1, 0.02, z, -a, false);
  }
  const keepClear = (x, z) => {
    if (Math.abs(z - roadZ(x)) < 3.6 && x > 4 && x < eraEnd) return true;
    if (Math.abs(z) < 12 && x > xp - 6 && x < END) return Math.abs(z) < 9;
    if (Math.hypot(x, z - 1) < 7.5) return true;
    return false;
  };
  T.scatter(statics, (x, z) => Math.abs(z) < 10.5 || keepClear(x, z));
  const grassA = T.makeGrass(5200, (x, z) => keepClear(x, z) || Math.abs(z) < 2.2 && x > 4 && x < eraEnd);
  scene.add(grassA);
  // Zone dressing: campus arch (2), bottles on a conveyor (3), bar-chart pillars (4), old monitor (1).
  const era = (n) => blocks.find((b) => b.en.era === n);
  const e1 = era(1);
  if (e1) {
    statics.box(0x2b2b2b, e1.x - 5.2, 0, e1.z + 4, 1.3, 1.1, 1);
    statics.box(0xf4ead4, e1.x - 5.05, 0.15, e1.z + 4.99, 1.0, 0.7, 0.05);
  }
  const e2 = era(2);
  if (e2) {
    const ax = e2.x - 2.5;
    const az = roadZ(ax);
    statics.box(0xb5562c, ax, 0, az - 2.6, 0.6, 4.6, 0.6);
    statics.box(0xb5562c, ax, 0, az + 2.0, 0.6, 4.6, 0.6);
    statics.box(0xb5562c, ax, 4.4, az - 2.8, 0.6, 0.6, 5.6);
    for (let i = 0; i < 4; i++) {
      const p = new CylinderGeometry(0.16, 0.16, 1.4 + i * 0.5, 10);
      statics.add(p, 0x2e9d4a, e2.x + 4 + i * 0.5, (1.4 + i * 0.5) / 2, roadZ(e2.x + 4) - 4.5 - (i % 2) * 0.5);
    }
  }
  const e3 = era(3);
  if (e3) {
    const bz = roadZ(e3.x) + 4.2;
    statics.box(0x555555, e3.x - 3, 0, bz - 0.6, 7, 0.55, 1.2);
    [0x9bd1e8, 0xf2c230, 0x8fcf8a, 0xe8886e, 0x9bd1e8].forEach((c, i) => {
      statics.add(new CylinderGeometry(0.22, 0.22, 0.7, 10), c, e3.x - 2.4 + i * 1.3, 0.9, bz);
    });
  }
  const e4 = era(4);
  if (e4) {
    [1.2, 2.0, 2.8, 1.8].forEach((h, i) => {
      const bx = e4.x - 1.2 + i * 1.7;
      const bz = roadZ(bx) + 4.6;
      statics.box(i % 2 ? 0xf50000 : 0x3f9d92, bx - 0.7, 0, bz - 0.7, 1.4, h, 1.4);
      boxes.push(boxAt(bx, h / 2, bz, 1.4, h, 1.4));
    });
  }

  // Crossroads signpost + warp pipes.
  statics.box(0x7a4a24, 5.2, 0, 2.4, 0.3, 2.2, 0.3);
  statics.box(0xe3d3a4, 5.2 - 1.4, 1.9, 2.5, 3.0, 0.7, 0.2);
  addLabel("Carreira →", 5.2 - 1.4 + 1.5, 2.25, 2.72, 2.8);

  // ---- Props: blocks, pipes, coins, mast ---------------------------------
  const years = content.eras.flatMap((e) => e.entries.map((en) => en.year));
  const atlas = makeBlockAtlas(years);
  const blockMat = mat(
    { map: atlas, emissiveMap: makeDotAtlas(years.length), emissive: 0xffffff, emissiveIntensity: 6, roughness: 0.45 },
    { rim: 0.2 }
  );
  blocks.forEach((b, i) => {
    const mesh = new Mesh(cellUV(new RoundedBoxGeometry(1.6, 1.6, 1.6, 4, 0.16), i), blockMat);
    mesh.position.set(b.x, 3.2, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const it = {
      kind: "block",
      id: b.en.id,
      x: b.x,
      y: 3.2,
      z: b.z,
      r: 2.6,
      mesh,
      spring: new Spring(260, 9),
      hit: false,
      text: `Bloco ${b.en.label}: ${b.en.title}`,
      hint: "E para abrir",
    };
    mesh.userData.it = it;
    boxes.push(boxAt(b.x, 3.2, b.z, 1.6, 1.6, 1.6, it));
    interactables.push(it);
    scene.add(mesh);
  });

  const pipeMat = vcMat();
  const makePipe = (kind, x, z, h, extra, tints = [0x2e9d4a, 0x4fd070]) => {
    const mesh = new Mesh(pipeGeometry(h, 0.85, tints[0], tints[1]), pipeMat);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const it = { kind, x, y: h, z, top: h, r: 2.7, mesh, spring: new Spring(240, 10), ...extra };
    mesh.userData.it = it;
    boxes.push(boxAt(x, h / 2, z, 1.9, h, 1.9, it));
    interactables.push(it);
    scene.add(mesh);
    return it;
  };
  makePipe("warp", -3.6, -4.2, 1.8, {
    dest: "plaza",
    text: "Tubo para Projetos",
    hint: "↓ ou E para entrar",
  });
  addLabel("Projetos", -3.6, 3.0, -4.2, 2.6);
  makePipe("warp", 3.2, -4.2, 1.8, { dest: "mast", text: "Tubo para Contato", hint: "↓ ou E para entrar" });
  addLabel("Contato", 3.2, 3.0, -4.2, 2.6);
  content.projects.forEach((p, i, arr) => {
    const th = (-60 + (120 / (arr.length - 1)) * i) * (Math.PI / 180);
    const px = xp + 6 * Math.cos(th) + 1;
    const pz = 6.4 * Math.sin(th);
    makePipe("project", px, pz, 1.6, { id: p.id, text: `Projeto ${p.title}`, hint: "↓ ou E para entrar" });
    addLabel(p.title, px, 2.9, pz, 3.1);
  });

  // Secrets: an invisible block near the crossroads and a small gold pipe to the GitHub profile.
  const hidMesh = new Mesh(
    new RoundedBoxGeometry(1.6, 1.6, 1.6, 4, 0.16),
    mat({ color: 0xf4ead4, emissive: 0xf50000, emissiveIntensity: 0.9, roughness: 0.45 })
  );
  hidMesh.position.set(-8.2, 3.2, 3.6);
  hidMesh.visible = false;
  hidMesh.castShadow = true;
  scene.add(hidMesh);
  const hidIt = { kind: "secret", x: -8.2, y: 3.2, z: 3.6, r: 2.6, mesh: hidMesh, spring: new Spring(260, 9), hit: false };
  hidMesh.userData.it = hidIt;
  boxes.push(boxAt(-8.2, 3.2, 3.6, 1.6, 1.6, 1.6, hidIt));
  interactables.push(hidIt);
  const e2b = blocks.find((b) => b.en.era === 2);
  const egg = makePipe(
    "egg",
    (e2b ? e2b.x : 40) + 10,
    -8.2,
    1.3,
    { text: "Tubo secreto dourado", hint: "↓ ou E para entrar" },
    [0xd9a227, 0xffd75a]
  );
  addLabel("GitHub", egg.x, 2.5, -8.2, 2.4);
  const eggCard = () => {
    const a = document.createElement("article");
    a.innerHTML =
      '<p class="kicker">Segredo encontrado</p><h3>Tubo dourado: GitHub</h3><p>Você achou o atalho secreto para o meu código.</p>' +
      '<p><a class="btn btn-primary" href="https://github.com/voaneves"><span class="dot" aria-hidden="true"></span>Abrir github.com/voaneves</a></p>';
    return a;
  };

  // Staircase and the mast platform.
  for (let k = 0; k < 3; k++) {
    const x0 = sx + k * 2.2;
    statics.box(k % 2 ? 0xe3d3a4 : 0xb5562c, x0, 0, -2.6, 2.2, 1 + k, 5.2);
    boxes.push(makeBoxFromMin(x0, 0, -2.6, 2.2, 1 + k, 5.2));
  }
  statics.box(0xe3d3a4, sx + 6.6, 0, -3.2, 9.4, 4, 6.4);
  boxes.push(makeBoxFromMin(sx + 6.6, 0, -3.2, 9.4, 4, 6.4));
  statics.add(new CylinderGeometry(0.13, 0.13, 8, 10), 0xf4ead4, mx, 4 + 4, 0);
  statics.add(new SphereGeometry(0.34, 12, 10), 0xf50000, mx, 4 + 8.2, 0);
  statics.box(0x0a0a0a, mx - 0.5, 4, -0.5, 1, 0.4, 1);
  const flag = createFlag(mx + 0.13, 4 + 7.2, 0);
  scene.add(flag);
  const mast = { kind: "mast", x: mx, y: 4, z: 0, r: 1.9 };

  function makeBoxFromMin(x, y, z, w, h, d) {
    return boxAt(x + w / 2, y + h / 2, z + d / 2, w, h, d);
  }

  // Merge labels into a single mesh on the label atlas.
  const labelTex = makeLabelAtlas(labels);
  const labelGeos = labelSpots.map(([i, x, y, z, w]) => labelPlane(i, w).translate(x, y, z));
  const labelMesh = new Mesh(mergeGeometries(labelGeos), new MeshBasicMaterial({ map: labelTex }));
  scene.add(statics.mesh(), labelMesh);

  const coins = createCoins(coinPos, reduced);
  scene.add(coins.mesh);
  const clouds = createCloudsRound(END + 110, reduced);
  scene.add(clouds.mesh);
  const particles = createParticles(110);
  particles.enabled = !reduced;
  scene.add(particles.mesh);

  // ---- Avatar and state --------------------------------------------------------
  const avatar = createAvatar();
  scene.add(avatar.root);
  const blob = new Mesh(new CircleGeometry(0.45, 14), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }));
  blob.rotation.x = -Math.PI / 2;
  blob.visible = !shadows;
  scene.add(blob);

  const SPAWN = { x: 0, z: 2.5 };
  const body = createBody(SPAWN.x, 0, SPAWN.z);
  const bounds = { x0: -14, x1: END - 1, z0: -10, z1: 10 };
  const totalCoins = coinPos.length + blocks.length;
  let coinCount = 0;

  let state = "play"; // play | busy | card
  let tap = null; // {x,z,it}
  let coyote = 0;
  let buffer = 0;
  let jumping = false;
  let acc = 0;
  let prevGrounded = true;
  let stepDust = 0;
  let mastArmed = true;
  let zoneIdx = -1;
  let nearIt = null;
  let cardResolve = null;
  let helped = false;

  const ui = createUI(stage, container, {
    onClose: () => {
      if (cardResolve) {
        const r = cardResolve;
        cardResolve = null;
        r();
      }
    },
  });
  ui.setCoins(0, totalCoins);
  const cam = createFollowCamera(camera, { reduced });
  cam.snap(body.x, 0, body.z, 14);

  const input = createInput(container, stage, {
    onTap: (cx, cy) => handleTap(cx, cy),
    onKey: (code) => {
      if (code === "Escape") {
        if (ui.isCardOpen()) ui.closeCard();
        else if (ui.isHelpOpen()) ui.setHelp(false);
        else if (onExit) onExit();
      } else if (code === "KeyM") toggleMute();
      else if (code === "KeyH") ui.setHelp(!ui.isHelpOpen());
    },
  });
  const inp = input.state;

  const muteBtn = document.getElementById("hud-mute");
  const toggleMute = () => {
    sfx.setMuted(!sfx.isMuted());
    try {
      localStorage.setItem("timeline-muted", sfx.isMuted() ? "1" : "0");
    } catch (e) {}
    if (muteBtn) {
      muteBtn.setAttribute("aria-pressed", String(!sfx.isMuted()));
      muteBtn.setAttribute("aria-label", sfx.isMuted() ? "Som desligado. Ativar som" : "Som ligado. Desativar som");
    }
    if (!sfx.isMuted()) sfx.play("coin");
  };
  if (muteBtn) muteBtn.addEventListener("click", toggleMute);
  const exitBtn = document.getElementById("hud-exit");
  const doExit = () => onExit && onExit();
  if (exitBtn) exitBtn.addEventListener("click", doExit);
  const projBtn = document.getElementById("hud-projects");
  const contBtn = document.getElementById("hud-contact");
  const goProjects = () => state === "play" && warp("plaza");
  const goContact = () => state === "play" && warp("mast", true);
  if (projBtn) projBtn.addEventListener("click", goProjects);
  if (contBtn) contBtn.addEventListener("click", goContact);

  // ---- Interactions --------------------------------------------------------------
  const emitDust = (x, y, z, n = 6) =>
    particles.emit(x, y + 0.05, z, n, { color: 0xe3d3a4, speed: 2.2, up: 1.6, size: 0.16, life: 0.45, gravity: 8 });

  const waitClose = () => new Promise((r) => (cardResolve = r));

  const popMesh = new Mesh(
    new CylinderGeometry(0.38, 0.38, 0.1, 16).rotateX(Math.PI / 2),
    mat({ color: 0xf2c230, metalness: 0.7, roughness: 0.3, emissive: 0xffb000, emissiveIntensity: 1.8 })
  );
  popMesh.visible = false;
  scene.add(popMesh);
  function popCoin(x, y, z) {
    if (reduced) return;
    popMesh.visible = true;
    tweens
      .tween(0.75, (t) => {
        popMesh.position.set(x + t * 0.6, y + Math.sin(Math.min(1, t * 1.15) * Math.PI) * 2.4, z);
        popMesh.rotation.y = t * 16;
        popMesh.scale.setScalar(t > 0.85 ? (1 - t) / 0.15 + 0.001 : 1);
      })
      .then(() => (popMesh.visible = false));
  }
  const found = new Set();
  const secretsFound = new Set();

  async function bumpSecret(it) {
    state = "busy";
    it.mesh.visible = true;
    it.spring.kick(8);
    cam.kick(0.35);
    sfx.play("bump", 0.8);
    if (!it.hit) {
      it.hit = true;
      secretsFound.add("block");
      coinCount += 5;
      ui.setCoins(coinCount);
      for (let i = 0; i < 5; i++) {
        setTimeout(() => sfx.play("coin", 1 + i * 0.12), i * 90);
      }
      particles.emit(it.x, it.y + 0.9, it.z, 22, { color: 0xf2c230, speed: 3.2, up: 8, size: 0.2, life: 0.9, gravity: 14 });
      ui.showToast("Bloco secreto! +5 moedas", 4000);
      ui.announce("Bloco secreto encontrado: mais 5 moedas", 0);
    }
    await tweens.wait(0.2);
    state = "play";
  }

  async function bump(it) {
    state = "busy";
    it.spring.kick(7);
    cam.kick(0.3);
    found.add(it.id);
    ui.found(found.size, blocks.length);
    const pitch = 1 + 0.07 * (found.size % 6);
    sfx.play("bump", pitch);
    particles.emit(it.x, it.y + 0.9, it.z, 8, { color: 0xf2c230, speed: 2.5, up: 6, size: 0.18, life: 0.7, gravity: 14 });
    if (!it.hit) {
      it.hit = true;
      coinCount++;
      ui.setCoins(coinCount);
      sfx.play("coin", pitch);
      popCoin(it.x, it.y + 1.0, it.z);
    }
    await tweens.wait(reduced ? 0.05 : 0.3);
    state = "card";
    ui.openCard(document.getElementById(it.id));
    await waitClose();
    state = "play";
  }

  function hopTo(x, y, z, seconds) {
    const x0 = body.x;
    const y0 = body.y;
    const z0 = body.z;
    return tweens.tween(seconds, (t) => {
      const e = easeInOut(t);
      body.x = x0 + (x - x0) * e;
      body.z = z0 + (z - z0) * e;
      body.y = y0 + (y - y0) * e + Math.sin(t * Math.PI) * 1.1;
      body.px = body.x;
      body.py = body.y;
      body.pz = body.z;
    });
  }

  async function sink(it, down) {
    const y0 = body.y;
    it.spring.kick(down ? -5 : 4);
    sfx.play("pipe");
    await tweens.tween(down ? 0.5 : 0.45, (t) => {
      const k = down ? easeInOut(t) : 1 - easeOut(1 - t);
      body.y = down ? y0 - k * 2.0 : y0 + k * 2.0;
      body.py = body.y;
    });
  }

  async function enterPipe(it) {
    state = "busy";
    tap = null;
    body.vx = body.vz = body.vy = 0;
    await hopTo(it.x, it.top, it.z, reduced ? 0.05 : 0.32);
    await sink(it, true);
    avatar.setVisible(false);
    if (it.kind === "warp") {
      await warp(it.dest, it.dest === "mast", true);
      return;
    }
    state = "card";
    if (it.kind === "egg") {
      if (!secretsFound.has("egg")) {
        secretsFound.add("egg");
        ui.announce("Segredo encontrado: tubo dourado", 0);
      }
      ui.openCard(eggCard(), { link: null });
    } else ui.openCard(document.getElementById(it.id));
    await waitClose();
    state = "busy";
    avatar.setVisible(true);
    body.y = it.top - 2.0;
    await sink(it, false);
    body.y = it.top;
    body.vy = 0;
    state = "play";
  }

  async function warp(dest, thenGrab, fromPipe) {
    state = "busy";
    ui.fade(true);
    await tweens.wait(reduced ? 0.02 : 0.28);
    avatar.setVisible(true);
    if (dest === "plaza") {
      body.x = xp - 7;
      body.z = 0;
      body.y = 0;
    } else {
      body.x = mx - 3;
      body.z = 0;
      body.y = 4;
    }
    body.vx = body.vz = body.vy = 0;
    body.px = body.x;
    body.py = body.y;
    body.pz = body.z;
    cam.snap(body.x, body.y, body.z, dest === "plaza" ? 17 : 16);
    ui.fade(false);
    emitDust(body.x, body.y, body.z, 10);
    await tweens.wait(reduced ? 0.02 : 0.25);
    void fromPipe;
    if (thenGrab) await grabMast();
    else state = "play";
  }

  async function grabMast() {
    state = "busy";
    mastArmed = false;
    tap = null;
    body.vx = body.vz = body.vy = 0;
    const gx = mx - 0.55;
    await hopTo(gx, Math.max(body.y, 4), 0, reduced ? 0.05 : 0.3);
    sfx.play("flag");
    const top = 4 + 7.2;
    particles.emit(mx, 4 + 8.2, 0, 24, { color: 0xf50000, speed: 4, up: 5, size: 0.22, life: 1, gravity: 6 });
    particles.emit(mx, 4 + 8.2, 0, 16, { color: 0xf4ead4, speed: 3, up: 4, size: 0.18, life: 1, gravity: 6 });
    await tweens.tween(reduced ? 0.05 : 1.1, (t) => {
      const e = easeInOut(t);
      flag.position.y = top - e * 6;
      body.y = Math.max(4, 4 + (1 - e) * 3.2);
      body.py = body.y;
    });
    state = "card";
    const sec = document.getElementById("contato");
    ui.openCard(sec.querySelector(".wrap"), { link: sec });
    await waitClose();
    flag.position.y = top;
    state = "play";
  }

  // Tap / click: raycast against interactables, otherwise walk to the ground point.
  const ray = new Raycaster();
  const ndc = new Vector2();
  function handleTap(clientX, clientY) {
    if (state !== "play") return;
    const rect = container.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(interactables.filter((i) => i.kind !== "secret").map((i) => i.mesh), false);
    if (hits.length) {
      const it = hits[0].object.userData.it;
      tap = { x: it.x, z: it.z, it, range: it.kind === "block" ? 0.35 : 2.3 };
      return;
    }
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    if (d.y < -0.01) {
      const t = -o.y / d.y;
      tap = { x: clamp(o.x + d.x * t, bounds.x0, bounds.x1), z: clamp(o.z + d.z * t, bounds.z0, bounds.z1), it: null, range: 0.25 };
    }
  }

  // ---- Fixed step -------------------------------------------------------------
  function fixed() {
    if (state !== "play") {
      body.px = body.x;
      body.py = body.y;
      body.pz = body.z;
      return;
    }
    let mx2 = inp.x;
    let mz2 = inp.z;
    if (inp.anyMove) tap = null;
    if (tap) {
      const dx = tap.x - body.x;
      const dz = tap.z - body.z;
      const d = Math.hypot(dx, dz);
      if (d <= tap.range) {
        const t = tap;
        tap = null;
        if (t.it && t.it.kind === "block") buffer = 0.12;
        else if (t.it) pending = t.it;
      } else {
        mx2 = dx / d;
        mz2 = dz / d;
      }
    }
    const len = Math.hypot(mx2, mz2);
    if (len > 1) {
      mx2 /= len;
      mz2 /= len;
    }
    const maxv = 7.2;
    const a = body.grounded ? 75 : 45;
    const approach = (v, target, rate) => v + clamp(target - v, -rate * STEP, rate * STEP);
    const hasInput = mx2 !== 0 || mz2 !== 0;
    const rate = hasInput ? a : body.grounded ? 60 : 10;
    body.vx = approach(body.vx, mx2 * maxv, rate);
    body.vz = approach(body.vz, mz2 * maxv, rate);

    if (inp.jumpPressed) {
      buffer = 0.12;
      inp.jumpPressed = false;
    }
    coyote = body.grounded ? 0.1 : coyote - STEP;
    buffer -= STEP;
    if (buffer > 0 && coyote > 0) {
      body.vy = 15.2;
      coyote = 0;
      buffer = 0;
      jumping = true;
      body.grounded = false;
      avatar.jump();
      sfx.play("jump");
      emitDust(body.x, body.y, body.z, 4);
    }
    // Variable jump height: release early to cut the rise.
    if (jumping && !inp.jumpHeld && body.vy > 9) body.vy = 9;
    if (body.vy <= 0) jumping = false;
    body.vy = Math.max(-32, body.vy - 38 * (body.vy < 0 ? 1.45 : 1) * STEP);

    const vyBefore = body.vy;
    stepBody(body, boxes, bounds, STEP);

    if (body.head && body.head.data && (body.head.data.kind === "block" || body.head.data.kind === "secret")) {
      const it = body.head.data;
      body.vy = -3;
      jumping = false;
      if (it.kind === "secret") bumpSecret(it);
      else bump(it);
    }
    if (body.grounded && !prevGrounded) {
      avatar.land(-vyBefore);
      if (-vyBefore > 5) {
        emitDust(body.x, body.y, body.z, 7);
        cam.kick(clamp(-vyBefore * 0.012, 0, 0.2));
        sfx.play("land");
      }
    }
    prevGrounded = body.grounded;
  }

  let pending = null;

  // ---- Frame ---------------------------------------------------------------------
  let time = 0;
  let toastShown = 0;
  const tickFn = (dt, t) => {
    time = t;
    uniforms.uTime.value = reduced ? 0 : t;
    tweens.update(dt);
    acc += dt;
    while (acc >= STEP) {
      fixed();
      acc -= STEP;
    }
    const alpha = state === "play" ? acc / STEP : 1;
    const rx = body.px + (body.x - body.px) * alpha;
    const ry = body.py + (body.y - body.py) * alpha;
    const rz = body.pz + (body.z - body.pz) * alpha;
    avatar.root.position.set(rx, ry, rz);
    blob.position.set(rx, 0.03, rz);
    const bs = clamp(1 - ry * 0.12, 0.4, 1);
    blob.scale.set(bs, bs, 1);

    // Nearest interactable.
    let best = null;
    let bd = 1e9;
    for (const it of interactables) {
      const d = Math.hypot(it.x - rx, it.z - rz);
      const reach = it.kind === "block" ? it.r : it.r;
      if (it.kind !== "secret" && d < reach && d < bd && (it.kind !== "block" || ry < 2.0)) {
        bd = d;
        best = it;
      }
    }
    nearIt = state === "play" ? best : null;
    if (pending && state === "play") {
      const p = pending;
      pending = null;
      enterPipe(p);
    }
    if (state === "play" && nearIt) {
      if (inp.interactPressed || (inp.downPressed && nearIt.kind !== "block")) {
        if (nearIt.kind === "block") {
          body.vy = 15.2;
          buffer = 0;
          avatar.jump();
          bump(nearIt);
        } else enterPipe(nearIt);
      }
      if (time - toastShown > 0.2) {
        ui.showToast(`${nearIt.text} (${nearIt.hint})`);
        ui.announce(`${nearIt.text}, ${nearIt.hint}`);
        toastShown = time;
      }
    } else if (state === "play" && toastShown && time - toastShown > 0.4) {
      ui.showToast("");
      toastShown = 0;
    }
    if (state !== "play" && toastShown) {
      ui.showToast("");
      toastShown = 0;
    }
    inp.interactPressed = false;
    inp.downPressed = false;

    // Mast grab.
    if (state === "play") {
      const dm = Math.hypot(mast.x - rx, mast.z - rz);
      if (mastArmed && dm < mast.r && ry >= 3.4) grabMast();
      else if (!mastArmed && dm > 4) mastArmed = true;
    }

    // Coins.
    coins.update(reduced ? 0 : t);
    for (let i = 0; i < coins.positions.length; i++) {
      if (!coins.alive[i]) continue;
      const c = coins.positions[i];
      if (Math.abs(c.x - rx) < 1 && Math.abs(c.z - rz) < 1.1 && ry < c.y + 0.5 && ry + 1.5 > c.y - 0.4) {
        coins.take(i);
        coinCount++;
        ui.setCoins(coinCount);
        sfx.play("coin");
        particles.emit(c.x, c.y, c.z, 8, { color: 0xf2c230, speed: 2.2, up: 4, size: 0.14, life: 0.6, gravity: 10 });
      }
    }
    clouds.update(t);

    // Block springs.
    for (const it of interactables) {
      if (!it.spring) continue;
      const s = it.spring.update(dt);
      if (it.kind === "block" || it.kind === "secret") {
        it.mesh.position.y = it.y + s * 0.5;
        it.mesh.scale.set(1 - s * 0.12, 1 + s * 0.2, 1 - s * 0.12);
      } else {
        it.mesh.scale.set(1 + s * 0.06, 1 - s * 0.25, 1 + s * 0.06);
      }
    }

    // Avatar animation and dust trail.
    const speed = Math.hypot(body.vx, body.vz);
    stepDust -= dt;
    if (state === "play" && body.grounded && speed > 5.5 && stepDust <= 0) {
      emitDust(rx, ry, rz, 1);
      stepDust = 0.16;
    }
    avatar.update(dt, {
      vx: state === "play" ? body.vx : 0,
      vz: state === "play" ? body.vz : 0,
      grounded: state !== "play" || body.grounded,
      look: nearIt ? Math.atan2(nearIt.x - rx, nearIt.z - rz) : null,
    });
    particles.update(dt);

    // Zone tracking.
    let zi = 0;
    for (let i = 0; i < zones.length; i++) if (rx >= zones[i].x0) zi = i;
    if (zi !== zoneIdx) {
      zoneIdx = zi;
      ui.setZone(zones[zi].name);
      ui.announce(zones[zi].info, 0);
    }
    const plaza = zones[zi].name === "Projetos";
    const hint = plaza ? 19 : zones[zi].name === "Contato" ? 17 : 15;
    cam.update(dt, { x: rx, y: ry, z: rz, vx: state === "play" ? body.vx : 0, vz: state === "play" ? body.vz : 0, hint, card: state === "card", narrow: narrow() });

    // Shadow camera follows the avatar.
    sun.position.set(rx + 8, ry + 14, rz + 6);
    sun.target.position.set(rx, 0, rz);
    sun.target.updateMatrixWorld();

    if (!helped && time > 0.5) {
      helped = true;
      ui.showToast("Use ←→ ↑↓ / WASD e Espaço para pular. Com pressa? Botão Contato.", 7000);
    }
  };
  // Post chain, card blur and adaptive quality (0 full, 1 no bloom, 2 no post/shadows, dpr 1).
  const post = createPost(rig.renderer, scene, camera, container.clientWidth || 800, container.clientHeight || 600);
  rig.onResize((w, h) => post.setSize(w, h));
  const noAdapt = location.search.includes("noadapt");
  let level = 0;
  let blur = 0;
  let ema = 0.016;
  let lastChange = 0;
  rig.setDraw((dt) => (level < 2 ? post.render(dt) : rig.renderer.render(scene, camera)));
  const setLevel = (l) => {
    level = l;
    if (l >= 1) post.setBloom(false);
    if (l >= 2) {
      rig.renderer.shadowMap.enabled = false;
      sun.castShadow = false;
      scene.traverse((o) => {
        if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true));
      });
      rig.renderer.setPixelRatio(1);
      rig.renderer.setSize(container.clientWidth, container.clientHeight, false);
      blob.visible = true;
    }
  };
  const prevTick = (dt, t) => {
    ema = ema * 0.96 + dt * 0.04;
    blur += ((state === "card" && !reduced ? 0.9 : 0) - blur) * Math.min(1, dt * 6);
    post.setBlur(blur);
    if (!noAdapt && t > 4 && t - lastChange > 3 && ema > 0.024 && level < 2) {
      lastChange = t;
      setLevel(level + 1);
    }
  };
  const mainTick = tickFn;
  rig.setTick((dt, t) => {
    prevTick(dt, t);
    mainTick(dt, t);
  });
  rig.start();
  ui.announce("Mundo 3D iniciado. Use as setas para andar e Espaço para pular.", 0);
  container.focus({ preventScroll: true });

  const handle = {
    info: rig.renderer.info,
    debug: { measure: () => { rig.renderer.info.reset(); rig.renderer.render(scene, camera); const r = rig.renderer.info.render; return { calls: r.calls, tris: r.triangles }; }, quality: () => ({ level, ema }), setLevel, found, secretsFound, popCoin, body, interactables, input: inp, blocks, coins, getState: () => state, warp, coinTotal: totalCoins, sfx, particles },
    stop() {
      themeObserver.disconnect();
      scheme.removeEventListener("change", applySky);
      tweens.clear();
      input.dispose();
      ui.dispose();
      if (muteBtn) muteBtn.removeEventListener("click", toggleMute);
      if (exitBtn) exitBtn.removeEventListener("click", doExit);
      if (projBtn) projBtn.removeEventListener("click", goProjects);
      if (contBtn) contBtn.removeEventListener("click", goContact);
      sfx.dispose();
      post.dispose();
      rig.dispose();
    },
  };
  if (location.search.includes("debug3d")) window.__timeline3d = handle;
  return handle;
}
