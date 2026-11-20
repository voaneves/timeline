// Boot script: theme toggle, service worker and the gate for the optional 3D mode.
// three.js is never requested from here until the visitor starts 3D (or a returning
// visitor who left 3D on is auto-started on idle, see canAutostart).
(() => {
  "use strict";

  const root = document.documentElement;
  const KEY_THEME = "timeline-theme";
  const KEY_MODE = "timeline-mode";
  const read = (key) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  };

  // Theme toggle: an explicit choice is persisted, otherwise the system decides.
  const themeBtn = document.getElementById("theme-toggle");
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const current = root.getAttribute("data-theme") || (dark.matches ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      write(KEY_THEME, next);
    });
  }

  // Relative URL, so the worker scopes to /timeline/ under GitHub Pages.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("worker.min.js").catch(() => {});
    });
  }

  // 3D gate.
  const btn = document.getElementById("start-3d");
  const stage = document.getElementById("world");
  const frame = document.getElementById("world-frame");
  const status = document.getElementById("world-status");
  if (!btn || !stage || !frame) return;

  const label = btn.querySelector(".label");
  const IDLE = "Explorar em 3D";
  let handle = null;
  let loading = false;

  const setLabel = (text) => {
    if (label) label.textContent = text;
  };
  const say = (text) => {
    if (status) status.textContent = text;
  };

  // The probe context is created only on Start (or idle autostart), never at page load.
  const hasWebGL2 = () => {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return false;
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return true;
    } catch (e) {
      return false;
    }
  };

  const canAutostart = () => {
    const conn = navigator.connection;
    return (
      read(KEY_MODE) === "3d" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !(conn && conn.saveData) &&
      (navigator.deviceMemory === undefined || navigator.deviceMemory >= 4)
    );
  };

  const unavailable = () => {
    btn.hidden = true;
    stage.hidden = true;
    say("3D indisponível neste dispositivo. A linha do tempo continua abaixo.");
  };

  const leave = (byUser) => {
    if (handle) {
      handle.stop();
      handle = null;
    }
    stage.hidden = true;
    setLabel(IDLE);
    write(KEY_MODE, "2d");
    if (byUser) btn.focus();
    else say("O 3D foi interrompido. A linha do tempo continua abaixo.");
  };

  const enter = async () => {
    if (handle || loading) return;
    if (!hasWebGL2()) return unavailable();
    loading = true;
    btn.disabled = true;
    setLabel("Carregando 3D…");
    try {
      const mod = await import("./world/world.min.js?v=" + __WORLD_VERSION__);
      stage.hidden = false;
      handle = await mod.start({ container: frame, onFallback: () => leave(false) });
      write(KEY_MODE, "3d");
      setLabel("Voltar ao 2D");
    } catch (e) {
      handle = null;
      stage.hidden = true;
      setLabel(IDLE);
      unavailable();
    } finally {
      loading = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener("click", () => (handle ? leave(true) : enter()));

  if (canAutostart()) {
    window.addEventListener("load", () => {
      setTimeout(() => {
        if (window.requestIdleCallback) window.requestIdleCallback(enter);
        else enter();
      }, 2000);
    });
  }
})();
