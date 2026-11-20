// Overlay UI: HUD, proximity toast, live region and the info card (a native <dialog>
// holding a clone of the same semantic <article> used by the 2D page).
export function createUI(stage, frame, { onClose }) {
  const $ = (id) => document.getElementById(id);
  const zoneEl = $("hud-zone");
  const coinEl = $("hud-coins");
  const totalEl = $("hud-total");
  const toast = $("world-toast");
  const live = $("world-status");
  const card = $("card");
  const body = $("card-body");
  const closeBtn = $("card-close");
  const help = $("help-panel");
  const helpBtn = $("hud-help");

  const ac = new AbortController();
  const sig = { signal: ac.signal };
  let toastTimer = 0;
  let lastLive = 0;
  let lastLiveText = "";

  const announce = (text, throttle = 1500) => {
    const now = performance.now();
    if (text === lastLiveText && now - lastLive < throttle * 3) return;
    if (now - lastLive < throttle && text !== "") return;
    lastLive = now;
    lastLiveText = text;
    live.textContent = text;
  };

  const showToast = (text, ms = 0) => {
    clearTimeout(toastTimer);
    if (!text) {
      toast.hidden = true;
      return;
    }
    toast.textContent = text;
    toast.hidden = false;
    if (ms) toastTimer = setTimeout(() => (toast.hidden = true), ms);
  };

  const setHelp = (open) => {
    help.hidden = !open;
    helpBtn.setAttribute("aria-expanded", String(open));
  };

  let source = null;
  const openCard = (sourceEl, { link } = {}) => {
    body.textContent = "";
    const clone = sourceEl.cloneNode(true);
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
    const heading = clone.querySelector("h2, h3, h4");
    if (heading) {
      heading.id = "card-title";
      heading.tabIndex = -1;
    }
    body.appendChild(clone);
    source = link || sourceEl;
    const jump = $("card-list");
    jump.hidden = !link && !sourceEl.id;
    card.show();
    (heading || closeBtn).focus({ preventScroll: true });
  };

  const closeCard = (restore = true) => {
    if (!card.open) return;
    card.close();
    if (restore) frame.focus({ preventScroll: true });
    onClose();
  };
  closeBtn.addEventListener("click", () => closeCard(), sig);
  $("card-list").addEventListener("click", () => {
    const el = source && source.id ? document.getElementById(source.id) : null;
    closeCard(false);
    if (el) {
      el.setAttribute("tabindex", "-1");
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    }
  }, sig);
  helpBtn.addEventListener("click", () => setHelp(help.hidden), sig);

  return {
    announce,
    found(n, total) {
      $("hud-found").textContent = String(n);
      $("hud-found-total").textContent = String(total);
    },
    showToast,
    setHelp,
    isHelpOpen: () => !help.hidden,
    openCard,
    closeCard,
    isCardOpen: () => card.open,
    setZone(text) {
      zoneEl.textContent = text;
    },
    setCoins(n, total) {
      coinEl.textContent = String(n);
      if (total !== undefined) totalEl.textContent = String(total);
    },
    fade(on) {
      $("world-fade").classList.toggle("on", on);
    },
    dispose() {
      ac.abort();
      closeCard(false);
      showToast("");
      setHelp(false);
    },
  };
}
