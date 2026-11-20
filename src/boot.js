// Boot script: theme toggle, service worker, title screen and the gate for the fullscreen
// 3D game. three.js is never requested until the visitor presses Start (title screen, or the
// "Jogar em 3D" button on the 2D page). The 2D page stays in the DOM for SEO and readers.
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

  const $ = (id) => document.getElementById(id);
  const title = $("title-screen");
  const startBtn = $("ts-start");
  const heroBtn = $("start-3d");
  const stage = $("world");
  const frame = $("world-frame");
  const status = $("world-status");
  const tsStatus = $("ts-status");
  const pageParts = [...document.querySelectorAll("[data-page]")];
  if (!stage || !frame) return;

  const say = (text) => {
    if (status) status.textContent = text;
    if (tsStatus) tsStatus.textContent = text;
  };
  const titleVisible = () => !!title && !title.hidden && !root.classList.contains("no-title");

  let handle = null;
  let loading = false;

  // The probe context is created only on Start, never at page load.
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

  const showPage = () => {
    root.classList.remove("playing");
    pageParts.forEach((el) => {
      el.inert = false;
      el.removeAttribute("aria-hidden");
    });
  };
  const hidePage = () => {
    root.classList.add("playing");
    pageParts.forEach((el) => {
      el.inert = true;
      el.setAttribute("aria-hidden", "true");
    });
  };

  const closeTitle = () => {
    if (title) title.hidden = true;
    root.classList.add("no-title");
  };

  // Fall back to the plain page (also used when WebGL2 or the chunk is unavailable).
  const simple = (message) => {
    closeTitle();
    showPage();
    write(KEY_MODE, "2d");
    if (message) say(message);
    const target = $("carreira");
    if (target) {
      target.scrollIntoView();
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  };

  const unavailable = () => {
    if (heroBtn) heroBtn.hidden = true;
    stage.hidden = true;
    simple("3D indisponível neste dispositivo. Mostrando a versão simples.");
  };

  const leave = (byUser) => {
    if (handle) {
      handle.stop();
      handle = null;
    }
    stage.hidden = true;
    showPage();
    write(KEY_MODE, "3d-exit");
    if (title) {
      title.hidden = false;
      title.classList.remove("leaving", "loading");
      root.classList.remove("no-title");
      pageParts.forEach((el) => (el.inert = true));
    }
    if (startBtn) startBtn.querySelector(".ts-label").textContent = "Press start";
    if (byUser && startBtn) startBtn.focus();
    else say("O 3D foi interrompido. Mostrando a versão simples.");
    if (!byUser) simple();
  };

  const enter = async () => {
    if (handle || loading) return;
    if (!hasWebGL2()) return unavailable();
    loading = true;
    if (title) title.classList.add("loading");
    if (startBtn) startBtn.querySelector(".ts-label").textContent = "Carregando";
    if (heroBtn) heroBtn.disabled = true;
    try {
      const mod = await import("./world/world.min.js?v=" + __WORLD_VERSION__);
      hidePage();
      stage.hidden = false;
      handle = await mod.start({
        container: frame,
        onFallback: () => leave(false),
        onExit: () => leave(true),
      });
      write(KEY_MODE, "3d");
      if (title && titleVisible()) {
        title.classList.add("leaving");
        setTimeout(() => {
          title.hidden = true;
          title.classList.remove("leaving", "loading");
        }, 650);
      }
      root.classList.add("no-title");
    } catch (e) {
      handle = null;
      showPage();
      stage.hidden = true;
      unavailable();
    } finally {
      loading = false;
      if (heroBtn) heroBtn.disabled = false;
    }
  };

  if (startBtn) startBtn.addEventListener("click", enter);
  if (heroBtn) heroBtn.addEventListener("click", enter);
  const simpleLink = $("ts-simple");
  const contactLink = $("ts-contact");
  if (simpleLink) simpleLink.addEventListener("click", (e) => (e.preventDefault(), simple()));
  if (contactLink) {
    contactLink.addEventListener("click", (e) => {
      e.preventDefault();
      simple();
      const c = $("contato");
      if (c) c.scrollIntoView();
    });
  }
  // Enter / Space / tap anywhere on the title screen starts the game.
  if (title) {
    title.inert = false;
    document.addEventListener("keydown", (e) => {
      if (!titleVisible() || handle || loading) return;
      if ((e.key === "Enter" || e.key === " ") && !(e.target instanceof HTMLAnchorElement)) {
        e.preventDefault();
        enter();
      }
    });
    title.addEventListener("pointerdown", (e) => {
      if (e.target.closest("a")) return;
      if (e.pointerType === "touch") enter();
    });
    if (titleVisible()) {
      pageParts.forEach((el) => (el.inert = true));
      if (startBtn) startBtn.focus({ preventScroll: true });
    }
  }
})();
