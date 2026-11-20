import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

// Renderer shell: DPR clamp, resize observer, visibility/offscreen pause, context-lost
// fallback, procedural PMREM environment and AgX tone mapping. Scene content lives in main.js.
export function createRenderer(container, { onFallback, animate = true } = {}) {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const maxDpr = coarse ? 1.5 : 2;
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

  const renderer = new WebGLRenderer({
    antialias: false, // MSAA comes from the post render target; level 2 re-enables it below
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = !coarse;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(36, 1, 0.1, 300);

  let tick = () => {};
  let draw = () => renderer.render(scene, camera);
  const resizers = [];
  let raf = 0;
  let last = 0;
  let visible = !document.hidden;
  let onScreen = true;
  let disposed = false;

  const shouldRun = () => animate && visible && onScreen && !disposed;

  const frame = (now) => {
    raf = 0;
    if (!shouldRun()) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    tick(dt, now / 1000);
    draw(dt);
    raf = requestAnimationFrame(frame);
  };

  const sync = () => {
    if (shouldRun()) {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const fn of resizers) fn(w, h);
    if (!animate) draw(0);
  };

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const io = new IntersectionObserver((entries) => {
    onScreen = entries[entries.length - 1].isIntersecting;
    sync();
  });
  io.observe(container);

  const onVisibility = () => {
    visible = !document.hidden;
    sync();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onLost = (event) => {
    event.preventDefault();
    if (onFallback) onFallback("context-lost");
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    renderer,
    scene,
    camera,
    canvas,
    coarse,
    dpr,
    setTick(fn) {
      tick = fn;
    },
    setDraw(fn) {
      draw = fn;
    },
    onResize(fn) {
      resizers.push(fn);
    },
    start() {
      resize();
      sync();
    },
    renderOnce: () => draw(0),
    dispose() {
      if (disposed) return;
      disposed = true;
      sync();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        const mats = obj.material ? [].concat(obj.material) : [];
        for (const m of mats) {
          for (const k of ["map", "emissiveMap", "gradientMap"]) if (m[k]) m[k].dispose();
          m.dispose();
        }
      });
      if (scene.background && scene.background.dispose) scene.background.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
