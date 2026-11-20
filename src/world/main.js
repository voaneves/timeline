import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  SRGBColorSpace,
} from "three";
import { createRenderer } from "./renderer.js";

// Sky colours mirror the world.sky tokens (tokens/timeline.tokens.json).
const SKY = {
  light: ["#9fd4f5", "#e6f4ff"],
  dark: ["#0a0a0a", "#1a1a1a"],
};

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

export async function start({ container, onFallback }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rig = createRenderer(container, { onFallback, animate: !reduced });
  const { scene, camera } = rig;

  // Sky and fog follow the colour scheme.
  const applySky = () => {
    const [top, bottom] = SKY[isDark() ? "dark" : "light"];
    if (scene.background && scene.background.dispose) scene.background.dispose();
    scene.background = skyTexture(top, bottom);
    scene.fog = new Fog(new Color(bottom), 22, 70);
    rig.renderOnce();
  };
  applySky();
  const themeObserver = new MutationObserver(applySky);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", applySky);

  // Lights: hemisphere plus one directional (shadow map only where the renderer enabled it).
  scene.add(new HemisphereLight(0xffffff, 0xc98a4b, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(8, 14, 6);
  if (rig.renderer.shadowMap.enabled) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera;
    s.left = -12;
    s.right = 12;
    s.top = 12;
    s.bottom = -12;
    s.near = 1;
    s.far = 40;
  }
  scene.add(sun);

  // Ground: soil slab with a grass cap.
  const soil = new Mesh(new BoxGeometry(80, 2, 80), new MeshLambertMaterial({ color: 0xc98a4b }));
  soil.position.y = -1.2;
  soil.receiveShadow = true;
  const grass = new Mesh(new BoxGeometry(80, 0.3, 80), new MeshLambertMaterial({ color: 0x4caf50 }));
  grass.position.y = -0.15;
  grass.receiveShadow = true;
  scene.add(soil, grass);

  // Test block: cream body with the signal dot.
  const block = new Group();
  const body = new Mesh(new BoxGeometry(2, 2, 2), new MeshLambertMaterial({ color: 0xf4ead4 }));
  body.castShadow = true;
  const dot = new Mesh(new CircleGeometry(0.5, 24), new MeshLambertMaterial({ color: 0xf50000 }));
  dot.position.z = 1.01;
  block.add(body, dot);
  block.position.y = 1.4;
  scene.add(block);

  // Camera: FOV 35, distance 14, pitch 32 degrees.
  const pitch = (32 * Math.PI) / 180;
  camera.position.set(0, Math.sin(pitch) * 14 + 1, Math.cos(pitch) * 14);
  camera.lookAt(0, 1, 0);

  rig.setTick((dt, t) => {
    block.position.y = 1.4 + Math.sin(t * 1.6) * 0.18;
    block.rotation.y = Math.sin(t * 0.7) * 0.35;
  });
  rig.start();

  const handle = {
    info: rig.renderer.info,
    stop() {
      themeObserver.disconnect();
      scheme.removeEventListener("change", applySky);
      rig.dispose();
    },
  };
  if (location.search.includes("debug3d")) window.__timeline3d = handle;
  return handle;
}
