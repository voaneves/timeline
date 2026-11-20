import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  FogExp2,
  HemisphereLight,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Shape,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  RingGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mat, uniforms, cloudBlobs } from "./materials.js";
import { createTerrain, createCloudsRound, rand, vnoise } from "./terrain.js";
import { createCrates } from "./crates.js";
import { createLife } from "./life.js";
import { createPost } from "./post.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRenderer } from "./renderer.js";
import { readContent } from "./content.js";
import { makeBlockAtlas, makeDotAtlas, cellUV, makeLabelAtlas, labelPlane } from "./textures.js";
import { Statics, vcMat, pipeGeometry, createCoins, createParticles, createFlag, createHullInstances, createContacts } from "./props.js";
import { createAvatar } from "./avatar.js";
import { createInput } from "./input.js";
import { createFollowCamera } from "./camera.js";
import { createUI } from "./ui.js";
import { createSfx } from "./sfx.js";
import { createBody, stepBody, boxAt, STEP } from "./physics.js";
import { Spring, createTweens, clamp, easeOut, easeInOut } from "./springs.js";

// Sky colours mirror the world.sky tokens (tokens/timeline.tokens.json).
// Light: a warm gradient (clear blue overhead into a cream horizon); fog is the horizon colour.
const SKY = { light: ["#82bdfa", "#ffdfb0"], dark: ["#0a0a0a", "#1a1a1a"] };
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
    scene.fog = new FogExp2(new Color(bottom), 0.004);
  };
  applySky();
  const themeObserver = new MutationObserver(applySky);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", applySky);

  // Golden hour: low warm sun (25 degrees up, from the right and slightly ahead) and a cool blue fill.
  scene.add(new HemisphereLight(0x9ec3ff, 0x6b5a48, 0.5));
  const sun = new DirectionalLight(0xffd9a0, 3.0);
  const SUN_OFF = new Vector3(24.5, 11.8, -4.2);
  const SUN_DIR = SUN_OFF.clone().normalize();
  sun.position.copy(SUN_OFF);
  const shadows = rig.renderer.shadowMap.enabled;
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    const s = sun.shadow.camera;
    s.left = -17;
    s.right = 17;
    s.top = 15;
    s.bottom = -15;
    s.near = 1;
    s.far = 70;
  }
  scene.add(sun, sun.target);

  // ---- Layout ----------------------------------------------------------------
  const boxes = []; // static colliders
  const interactables = [];
  const statics = new Statics();
  statics.groundNoise = (x, z) => 1 + (vnoise(x * 0.11 + 3.1, z * 0.11 - 1.7) - 0.5) * 0.12; // +-6% on the beige tiles
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
  const pathDist = (x, z) => {
    const era = Math.hypot(Math.max(0, 4 - x, x - (xp - 4)), z - roadZ(x)) - 1.9;
    return Math.min(era, Math.hypot(x, z - 1) - 6.4, Math.hypot(x - (xp + 3), z) - 7.5);
  };
  const T = createTerrain(END, pathDist);
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
  const treeSpots = T.scatter(statics, (x, z) => Math.abs(z) < 10.5 || keepClear(x, z));
  const grassA = T.makeGrass(rig.coarse ? 1800 : 3800, (x, z) => keepClear(x, z) || Math.abs(z) < 2.2 && x > 4 && x < eraEnd);
  scene.add(grassA);
  scene.add(T.makeGrass(rig.coarse ? 700 : 1500, (x, z) => keepClear(x, z), true));
  scene.add(T.makeFlowers(rig.coarse ? 110 : 240, keepClear));
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
    { map: atlas, emissiveMap: makeDotAtlas(years.length), emissive: 0xffffff, emissiveIntensity: 3.2, roughness: 0.45 },
    { rim: 0.2 }
  );
  const blockMeshes = [];
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
    blockMeshes.push(mesh);
  });

  const pipeMat = vcMat();
  const pipeGroups = new Map();
  const makePipe = (kind, x, z, h, extra, tints = [0x1f9d55, 0x54e08e]) => {
    const mesh = new Mesh(pipeGeometry(h, 0.85, tints[0], tints[1]), pipeMat);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const it = { kind, x, y: h, z, top: h, r: 2.7, mesh, spring: new Spring(240, 10), ...extra };
    mesh.userData.it = it;
    boxes.push(boxAt(x, h / 2, z, 1.9, h, 1.9, it));
    interactables.push(it);
    scene.add(mesh);
    if (!pipeGroups.has(h)) pipeGroups.set(h, []);
    pipeGroups.get(h).push(mesh);
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
  // Project pipes sit on a gentle arc, at least 2.6 units apart; each label is pushed out along the
  // arc normal (behind its pipe) at a staggered height. Labels also cull and de-overlap at runtime.
  const ARC_R = 7.6;
  const arcStep = 2 * Math.asin(1.33 / ARC_R); // chord 2.66
  content.projects.forEach((p, i, arr) => {
    const th = (i - (arr.length - 1) / 2) * arcStep;
    const nx = Math.cos(th);
    const nz = Math.sin(th);
    const px = xp + 1 + ARC_R * nx;
    const pz = ARC_R * nz;
    makePipe("project", px, pz, 1.6, { id: p.id, text: `Projeto ${p.title}`, hint: "↓ ou E para entrar" });
    addLabel(p.title, px + nx * 0.7, 2.7 + (i % 3) * 0.8, pz + nz * 0.7 - 0.2, 2.7);
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
    [0xb8861a, 0xffd75a]
  );
  addLabel("GitHub", egg.x, 2.5, -8.2, 2.4);
  const eggCard = () => {
    const a = document.createElement("article");
    a.innerHTML =
      '<p class="kicker">Segredo encontrado</p><h3>Tubo dourado: GitHub</h3><p>Você achou o atalho secreto para o meu código.</p>' +
      '<p><a class="btn btn-primary" href="https://github.com/voaneves"><span class="dot" aria-hidden="true"></span>Abrir github.com/voaneves</a></p>';
    return a;
  };

  // Plaza sculpting: a darker inner paving, a muted red ring and a curb of stones with gaps at the pipes.
  {
    const pcx = xp + 3;
    statics.add(new CylinderGeometry(5.5, 5.5, 0.05, 48), 0xd6c48f, pcx, 0.05, 0, 0, false);
    statics.add(new RingGeometry(2.6, 2.95, 48).rotateX(-Math.PI / 2), 0xd9482b, pcx, 0.082, 0, 0, false);
    statics.add(new RingGeometry(5.0, 5.25, 64).rotateX(-Math.PI / 2), 0xb9ab88, pcx, 0.082, 0, 0, false);
    const pipesXZ = interactables.filter((i) => i.kind === "project").map((i) => [i.x, i.z]);
    const N = 44;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const x = pcx + 7.7 * Math.cos(a);
      const z = 7.7 * Math.sin(a);
      if (pipesXZ.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1.9)) continue;
      const g = new BoxGeometry(0.95, 0.2 + rand(k, 5) * 0.1, 0.55);
      statics.add(g, [0xcdbf9b, 0xb9ab88, 0xd9cda8][k % 3], x, 0.1, z, -(a + Math.PI / 2));
    }
  }

  const flagSpots = [
    [-6.6, 4.8, 0xf50000],
    [10.6, 4.6, 0xf4ead4],
    [xp - 7.8, -6.4, 0xf4ead4],
    [xp - 7.8, 6.4, 0xf50000],
  ];
  flagSpots.forEach(([x, z]) => {
    statics.add(new CylinderGeometry(0.05, 0.07, 3.2, 6), 0xf4ead4, x, 1.6, z);
    statics.add(new SphereGeometry(0.1, 8, 6), 0x0a0a0a, x, 3.3, z);
  });

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
  const labelGeos = labelSpots.map(([i, x, y, z, w]) => {
    const g = labelPlane(i, w).translate(x, y, z);
    g.setAttribute("aA", new Float32BufferAttribute([1, 1, 1, 1], 1));
    return g;
  });
  const labelMat = new MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false });
  labelMat.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute float aA; varying float vA;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvA = aA;");
    shader.fragmentShader =
      "varying float vA;\n" + shader.fragmentShader.replace("#include <opaque_fragment>", "if (vA < 0.01) discard;\ndiffuseColor.a *= vA;\n#include <opaque_fragment>");
  };
  const labelGeo = mergeGeometries(labelGeos);
  const labelMesh = new Mesh(labelGeo, labelMat);
  labelMesh.renderOrder = 2;
  const labelFade = labelSpots.map(([i, x, y, z, w]) => ({ x, y, z, w, a: 1, want: 1, ndc: [0, 0, 0, 0, 0] }));
  const lv = new Vector3();
  // Screen-space rect (NDC) of a world-space plate or the avatar: [x0, y0, x1, y1, camera distance].
  const rectOf = (cx, cy, cz, hw, hy0, hy1, out) => {
    let x0 = 9;
    let y0 = 9;
    let x1 = -9;
    let y1 = -9;
    for (const [dx, y] of [[-hw, hy0], [hw, hy0], [-hw, hy1], [hw, hy1]]) {
      lv.set(cx + dx, cy + y, cz).project(camera);
      x0 = Math.min(x0, lv.x);
      x1 = Math.max(x1, lv.x);
      y0 = Math.min(y0, lv.y);
      y1 = Math.max(y1, lv.y);
    }
    out[0] = x0;
    out[1] = y0;
    out[2] = x1;
    out[3] = y1;
    out[4] = camera.position.distanceTo(lv.set(cx, cy, cz));
    return out;
  };
  const overlap = (a, b, m = 0.015) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
  const avRect = [0, 0, 0, 0, 0];
  const updateLabels = (dt, rx, ry, rz) => {
    camera.updateMatrixWorld();
    rectOf(rx, ry + 0.95, rz, 0.55, -0.95, 0.95, avRect);
    const order = [];
    labelFade.forEach((l, j) => {
      const d = Math.hypot(l.x - rx, l.z - rz, (l.y - ry - 1) * 0.5);
      rectOf(l.x, l.y, l.z, l.w / 2, -l.w / 8, l.w / 8, l.ndc);
      l.want = 1 - clamp((d - 7.5) / 1.5, 0, 1); // distance cull (> ~9 units)
      if (l.want > 0 && overlap(l.ndc, avRect, 0.01) && l.ndc[4] > avRect[4]) l.want = Math.min(l.want, 0.1); // avatar in front
      order.push([d, j]);
    });
    // Nearest first; a label that would overlap one already kept is dropped.
    order.sort((p, q) => p[0] - q[0]);
    const kept = [];
    for (const [, j] of order) {
      const l = labelFade[j];
      if (l.want > 0.3 && kept.some((k) => overlap(l.ndc, k.ndc))) l.want = 0;
      else if (l.want > 0.3) kept.push(l);
    }
    const arr = labelGeo.attributes.aA;
    let dirty = false;
    labelFade.forEach((l, j) => {
      const na = l.a + (l.want - l.a) * Math.min(1, dt * 9);
      if (Math.abs(na - l.a) > 0.002) {
        l.a = na;
        for (let v = 0; v < 4; v++) arr.setX(j * 4 + v, na);
        dirty = true;
      }
    });
    if (dirty) arr.needsUpdate = true;
  };
  scene.add(statics.mesh(), statics.hullMesh(0.04), labelMesh);
  const hulls = [];
  const blockHull = createHullInstances(new RoundedBoxGeometry(1.6, 1.6, 1.6, 4, 0.16), blockMeshes, 0.06);
  scene.add(blockHull.mesh);
  hulls.push(blockHull);
  for (const [h, meshes] of pipeGroups) {
    const ph = createHullInstances(pipeGeometry(h), meshes, 0.055);
    scene.add(ph.mesh);
    hulls.push(ph);
  }
  const contactSpots = [
    ...blocks.map((b) => ({ x: b.x, z: b.z + 0.2, rx: 1.35, rz: 1.1 })),
    ...[...pipeGroups.values()].flat().map((m) => ({ x: m.position.x, z: m.position.z, rx: 1.55 })),
    { x: mx, z: 0, rx: 1.0 },
    { x: 5.2, z: 2.5, rx: 1.05 },
    ...(e1 ? [{ x: e1.x - 4.55, z: e1.z + 4.5, rx: 1.5, rz: 1.3 }] : []),
    ...(e2 ? [{ x: e2.x - 2.5, z: roadZ(e2.x - 2.5) - 2.3, rx: 0.95 }, { x: e2.x - 2.5, z: roadZ(e2.x - 2.5) + 2.3, rx: 0.95 }] : []),
    ...(e3 ? [{ x: e3.x + 0.5, z: roadZ(e3.x) + 3.6, rx: 4.6, rz: 1.5 }] : []),
    ...(e4 ? [1.2, 2.0, 2.8, 1.8].map((h, i) => ({ x: e4.x - 1.2 + i * 1.7, z: roadZ(e4.x - 1.2 + i * 1.7) + 4.6, rx: 1.35 })) : []),
    { x: sx + 1.1, z: 0, rx: 2.0, rz: 3.2 },
    ...treeSpots,
  ];
  scene.add(createContacts(contactSpots));

  const coins = createCoins(coinPos, reduced);
  scene.add(coins.mesh);
  const clouds = createCloudsRound(END + 110, reduced);
  scene.add(clouds.mesh);
  const particles = createParticles(rig.coarse ? 150 : 300);
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
  // Paper pennants on poles: idle flutter, and a spring kick when the courier passes.
  const pennantShape = new Shape();
  pennantShape.moveTo(0, 0.28);
  pennantShape.lineTo(1.1, 0.08);
  pennantShape.lineTo(0, -0.28);
  pennantShape.lineTo(0, 0.28);
  const pennants = new InstancedMesh(new ExtrudeGeometry(pennantShape, { depth: 0.03, bevelEnabled: false }), mat({ roughness: 0.9, side: 2 }, { rim: 0.1 }), flagSpots.length);
  pennants.instanceMatrix.setUsage(DynamicDrawUsage);
  pennants.castShadow = true;
  pennants.frustumCulled = false;
  const flagState = flagSpots.map(([x, z, color], i) => {
    pennants.setColorAt(i, new Color(color));
    return { x, z, sp: new Spring(120, 5), near: false };
  });
  const flagO = new Object3D();
  scene.add(pennants);

  // Three hidden crates (secrets): kick one to open a "Você sabia?" card made from the page's own timeline.
  const pick = (f) => blocks[Math.min(blocks.length - 1, Math.floor(blocks.length * f))];
  const secretDefs = [
    { b: pick(0.18), x: (e1 ? e1.x : 14) + 3.4, dz: -7.2 },
    { b: pick(0.5), x: (e3 ? e3.x : 40) - 5.5, dz: -7.4 },
    { b: pick(0.82), x: (e4 ? e4.x : 60) + 3, dz: -7.0 },
  ].map((d) => ({ ...d, z: roadZ(d.x) + d.dz }));
  const secretCard = (b) => {
    const eraInfo = content.eras[b.en.era - 1] || content.eras[0];
    const a = document.createElement("article");
    const mk = (tag, text, cls) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      el.textContent = text;
      a.appendChild(el);
    };
    mk("p", "Segredo encontrado", "kicker");
    mk("h3", "Você sabia?");
    mk("p", `${b.en.label}: ${b.en.title}.`);
    mk("p", `Zona ${eraInfo.n}: ${eraInfo.name} (${eraInfo.years}). Bata no bloco desse período para ler mais.`);
    return a;
  };
  const staticBoxes = boxes.slice();
  const crates = createCrates(
    [
      [xp - 3.2, 0.4, 3.6],
      [xp - 3.2, 1.2, 3.6],
      [xp - 2.4, 0.4, -3.4],
      [xp - 4.8, 0.4, -1.6],
      ...secretDefs.map((d, i) => [d.x, 0.4, d.z, i]),
    ],
    { colliders: staticBoxes, bounds, particles, sfx, onSecret: (c) => crateSecret(c.secret) }
  );
  crates.list.forEach((c) => boxes.push(c.box));
  scene.add(...crates.meshes);
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
  // The crane intro stays held until the host reports that the curtain has covered the screen.
  let begun = false;
  let begunAt = 0;
  const begin = () => {
    if (begun) return;
    begun = true;
    begunAt = performance.now();
    cam.begin();
  };
  setTimeout(begin, 8000); // safety net if the host never calls begin()
  cam.snap(body.x, 0, body.z, 16.5);

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
    freeze = 0.05;
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
    freeze = 0.05;
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
    cam.roll(down ? 0.105 : 0); // ~6 degrees of camera roll while sucked in
    sfx.play("pipe");
    await tweens.tween(down ? 0.5 : 0.45, (t) => {
      const k = down ? easeInOut(t) : 1 - easeOut(1 - t);
      body.y = down ? y0 - k * 2.0 : y0 + k * 2.0;
      body.py = body.y;
    });
  }

  async function crateSecret(k) {
    await tweens.wait(reduced ? 0.1 : 0.9); // let the kick play out first
    while (state !== "play") await tweens.wait(0.25);
    state = "card";
    secretsFound.add("crate" + k);
    sfx.play("flag");
    for (let i = 0; i < 3; i++) setTimeout(() => sfx.play("coin", 1 + i * 0.15), i * 110);
    coinCount += 3;
    ui.setCoins(coinCount);
    ui.announce(`Segredo encontrado: caixa escondida ${secretsFound.size}`, 0);
    ui.openCard(secretCard(secretDefs[k].b), { link: null });
    await waitClose();
    state = "play";
  }

  async function enterPipe(it) {
    state = "busy";
    tap = null;
    body.vx = body.vz = body.vy = 0;
    await hopTo(it.x, it.top, it.z, reduced ? 0.05 : 0.32);
    if (it.kind === "warp" && !reduced) {
      freeze = 0.08; // an 80 ms freeze-frame right before the suck-in
      await tweens.wait(0.001);
    }
    await sink(it, true);
    avatar.setVisible(false);
    if (it.kind === "warp") {
      await warp(it.dest, it.dest === "mast", true);
      return;
    }
    state = "card";
    cam.roll(0);
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

  // Ink / paper-tear wipe: post pass when available, DOM circle wipe on the low-end path.
  let wipeV = 0;
  const wipe = (inward) => {
    if (reduced) {
      ui.fade(inward);
      return tweens.wait(0.05);
    }
    if (level >= 2) {
      ui.fade(inward);
      return tweens.wait(0.3);
    }
    return tweens.tween(inward ? 0.42 : 0.42, (t) => {
      wipeV = inward ? t : 1 + t;
      post.setWipe(inward ? t : 1 + t);
      if (!inward && t >= 1) post.setWipe(0);
    });
  };

  async function warp(dest, thenGrab, fromPipe) {
    state = "busy";
    await wipe(true);
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
    emitDust(body.x, body.y, body.z, 10);
    // Arrival: FOV punch, red confetti burst and the film-strip ribbon in the reveal wipe.
    cam.punch(8);
    cam.roll(0);
    if (!reduced) tweens.tween(0.6, (t) => post.setInk(t)).then(() => post.setInk(0));
    sfx.play("land");
    particles.emit(body.x, body.y + 1.6, body.z, 70, { color: 0xf50000, speed: 5, up: 7, size: 0.2, life: 1.6, gravity: 6 });
    particles.emit(body.x, body.y + 1.6, body.z, 30, { color: 0xf4ead4, speed: 4, up: 6, size: 0.16, life: 1.6, gravity: 6 });
    await wipe(false);
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
      life.scatter(body.x, body.z);
      sfx.play("jump");
      emitDust(body.x, body.y, body.z, 4);
    }
    // Variable jump height: release early to cut the rise.
    if (jumping && !inp.jumpHeld && body.vy > 9) body.vy = 9;
    if (body.vy <= 0) jumping = false;
    body.vy = Math.max(-32, body.vy - 38 * (body.vy < 0 ? 1.45 : 1) * STEP);

    const vyBefore = body.vy;
    crates.kick(body, STEP);
    stepBody(body, boxes, bounds, STEP);
    crates.step(STEP);

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
        cam.punch(clamp(-vyBefore * 0.12, 0, 2.2));
        sfx.play("land");
      }
    }
    prevGrounded = body.grounded;
  }

  let pending = null;
  let sparkleT = 0;
  const sunV = new Vector3();
  let freeze = 0;
  let heroPose = null;

  // ---- Frame ---------------------------------------------------------------------
  let time = 0;
  let toastShown = 0;
  let confetti = false;
  const tickFn = (dt, t) => {
    if (freeze > 0) {
      freeze -= dt;
      dt = 0;
    }
    time = t;
    uniforms.uTime.value = reduced ? 0 : t;
    tweens.update(dt);
    life.update(dt, t, body.x, body.z);
    if (!confetti && cam.introDone()) {
      confetti = true;
      sfx.play("flag", 1);
      particles.emit(body.x, body.y + 2.5, body.z, 60, { color: 0xf50000, speed: 5, up: 7, size: 0.2, life: 1.8, gravity: 6 });
      particles.emit(body.x, body.y + 2.5, body.z, 50, { color: 0xf4ead4, speed: 4, up: 6, size: 0.18, life: 1.8, gravity: 6 });
      particles.emit(body.x, body.y + 2.5, body.z, 30, { color: 0xf2c230, speed: 4, up: 6, size: 0.16, life: 1.8, gravity: 6 });
    }
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

    for (const h of hulls) h.sync();

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
      vy: body.vy,
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
    const hint = plaza ? 19 : zones[zi].name === "Contato" ? 17 : zi === 0 ? 16.5 : 15; // crossroads: ~10% pull-back
    if (heroPose) {
      camera.position.set(...heroPose.pos);
      camera.lookAt(...heroPose.look);
      if (heroPose.fov && camera.fov !== heroPose.fov) {
        camera.fov = heroPose.fov;
        camera.updateProjectionMatrix();
      }
    } else cam.update(dt, { x: rx, y: ry, z: rz, vx: state === "play" ? body.vx : 0, vz: state === "play" ? body.vz : 0, hint, card: state === "card", narrow: narrow() });

    uniforms.uFocus.value = rx;
    uniforms.uPlayer.value.set(rx, ry, rz);
    crates.sync(dt);
    updateLabels(dt, rx, ry, rz);

    // Era identity: the whole frame drifts from warm (early zones) to cool (recent ones).
    const eraT = clamp((rx - 12) / Math.max(1, eraEnd - 12), 0, 1);
    post.setTint(1.045 + (0.955 - 1.045) * eraT, 1.0 + (0.995 - 1.0) * eraT, 0.935 + (1.05 - 0.935) * eraT);
    // God rays: the sun's screen position (rays fade out when the sun is behind the camera).
    sunV.copy(camera.position).addScaledVector(SUN_DIR, 300).project(camera);
    post.setSun(sunV.x * 0.5 + 0.5, sunV.y * 0.5 + 0.5, sunV.z < 1);
    // Pennants flutter, and kick when the courier walks past.
    flagState.forEach((f, i) => {
      const near = Math.hypot(rx - f.x, rz - f.z) < 2.3;
      if (near && !f.near && !reduced) f.sp.kick(7 + Math.random() * 3);
      f.near = near;
      const sv = f.sp.update(dt);
      flagO.position.set(f.x, 3.05, f.z);
      flagO.rotation.set(0, (reduced ? 0.3 : 0.3 + Math.sin(time * 1.8 + i * 1.7) * 0.12) + sv * 0.9, reduced ? 0 : Math.sin(time * 2.6 + i) * 0.05 + sv * 0.2);
      flagO.updateMatrix();
      pennants.setMatrixAt(i, flagO.matrix);
    });
    pennants.instanceMatrix.needsUpdate = true;
    // Hidden crates glint now and then when the courier is nearby.
    sparkleT -= dt;
    if (sparkleT <= 0 && !reduced) {
      sparkleT = 1.4;
      for (const c of crates.list) {
        if (c.secret !== undefined && !c.secretDone && Math.hypot(c.x - rx, c.z - rz) < 11) {
          particles.emit(c.x, c.y + 0.55, c.z, 3, { color: 0xffd75a, speed: 0.5, up: 1.6, size: 0.1, life: 0.9, gravity: 1 });
        }
      }
    }

    // Shadow camera follows the avatar.
    sun.position.set(rx + SUN_OFF.x, ry + SUN_OFF.y, rz + SUN_OFF.z);
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
  const life = createLife(scene, { reduced, coarse: rig.coarse });
  const mainTick = tickFn;
  rig.setTick((dt, t) => {
    prevTick(dt, t);
    mainTick(dt, t);
  });
  rig.start();
  ui.announce("Mundo 3D iniciado. Use as setas para andar e Espaço para pular.", 0);
  container.focus({ preventScroll: true });

  const handle = {
    begin,
    info: rig.renderer.info,
    xp,
    debug: { setWipe: (v) => post.setWipe(v), setInk: (v) => post.setInk(v), roll: (v) => cam.roll(v), begunAt: () => begunAt, introDone: () => cam.introDone(), cloudBlobs: () => cloudBlobs(uniforms.uTime.value, uniforms.uFocus.value), hero: (pose) => { heroPose = pose; confetti = true; }, measure: () => { const i = rig.renderer.info; i.reset(); rig.renderer.render(scene, camera); const all = { calls: i.render.calls, tris: i.render.triangles }; const sm = rig.renderer.shadowMap; const was = sm.autoUpdate; sm.autoUpdate = false; i.reset(); rig.renderer.render(scene, camera); sm.autoUpdate = was; return { total: all, mainPass: { calls: i.render.calls, tris: i.render.triangles } }; }, quality: () => ({ level, ema }), setLevel, found, secretsFound, popCoin, body, crates, interactables, input: inp, blocks, coins, getState: () => state, warp, coinTotal: totalCoins, sfx, particles },
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
