import { WebGLRenderer, Scene, PerspectiveCamera } from "three";

// Renderer shell: DPR clamp, resize observer, visibility/offscreen pause and
// context-lost fallback. The scene content lives in main.js.
export function createRenderer(container, { onFallback, animate = true } = {}) {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);

  const renderer = new WebGLRenderer({
    antialias: dpr < 2,
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = !coarse;

  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  container.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 200);

  let tick = () => {};
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
    renderer.render(scene, camera);
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

  const renderOnce = () => {
    if (!disposed) renderer.render(scene, camera);
  };

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!animate) renderOnce();
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

  resize();

  return {
    renderer,
    scene,
    camera,
    canvas,
    setTick(fn) {
      tick = fn;
    },
    start() {
      sync();
      if (!animate) renderOnce();
    },
    renderOnce,
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
          if (m.map) m.map.dispose();
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
