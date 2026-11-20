// Input: keyboard (only while the stage has focus), dynamic touch joystick, tap/click.
// The state object is read by the controller each fixed step.
export function createInput(frame, stage, { onTap, onKey, onHold, onDrag, onRelease }) {
  const s = {
    x: 0,
    z: 0,
    jumpHeld: false,
    jumpPressed: false,
    interactPressed: false,
    interactHeld: false,
    interactUp: false,
    downPressed: false,
    anyMove: false,
  };
  const keys = new Set();

  const MAP = {
    ArrowLeft: "l",
    KeyA: "l",
    ArrowRight: "r",
    KeyD: "r",
    ArrowUp: "u",
    KeyW: "u",
    ArrowDown: "d",
    KeyS: "d",
  };

  const recompute = () => {
    s.x = (keys.has("r") ? 1 : 0) - (keys.has("l") ? 1 : 0);
    s.z = (keys.has("d") ? 1 : 0) - (keys.has("u") ? 1 : 0);
    s.anyMove = s.x !== 0 || s.z !== 0;
  };

  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = MAP[e.code];
    let handled = true;
    if (dir) {
      if (!keys.has(dir) && dir === "d") s.downPressed = true;
      keys.add(dir);
      recompute();
    } else if (e.code === "Space") {
      if (!s.jumpHeld) s.jumpPressed = true;
      s.jumpHeld = true;
    } else if (e.code === "KeyE" || e.code === "Enter") {
      if (!e.repeat) {
        s.interactPressed = true;
        s.interactHeld = true;
      }
    } else if (e.code === "Escape" || e.code === "KeyM" || e.code === "KeyH") {
      onKey(e.code);
    } else handled = false;
    if (handled) e.preventDefault();
  };
  const onKeyUp = (e) => {
    const dir = MAP[e.code];
    if (dir) {
      keys.delete(dir);
      recompute();
    } else if (e.code === "Space") s.jumpHeld = false;
    else if (e.code === "KeyE" || e.code === "Enter") {
      s.interactHeld = false;
      s.interactUp = true;
    }
  };
  const onBlur = () => {
    keys.clear();
    s.jumpHeld = false;
    if (s.interactHeld) s.interactUp = true;
    s.interactHeld = false;
    recompute();
  };
  frame.addEventListener("keydown", onKeyDown);
  frame.addEventListener("keyup", onKeyUp);
  frame.addEventListener("blur", onBlur);
  // Esc also closes a card when focus is inside the dialog.
  const stageKey = (e) => {
    if (e.code === "Escape" && !frame.contains(e.target)) onKey("Escape");
  };
  stage.addEventListener("keydown", stageKey);

  // Pointer: touch joystick on the left half; short press without drag = tap / click.
  const joy = document.createElement("div");
  joy.className = "joy";
  joy.hidden = true;
  joy.innerHTML = '<i></i>';
  stage.appendChild(joy);
  const knob = joy.firstChild;
  let ptr = null;
  let holdT = 0;
  const RADIUS = 56;

  const onDown = (e) => {
    if (e.button > 0) return;
    frame.focus({ preventScroll: true });
    const rect = frame.getBoundingClientRect();
    ptr = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      t: performance.now(),
      joystick: e.pointerType === "touch" && e.clientX - rect.left < rect.width * 0.5,
      moved: false,
      rect,
    };
    frame.setPointerCapture(e.pointerId);
    // Long press (500 ms, no movement): grab, drag and release for the ribbon pull.
    clearTimeout(holdT);
    if (onHold) {
      const mine = ptr;
      holdT = setTimeout(() => {
        if (ptr === mine && !mine.moved && onHold(mine.sx, mine.sy)) mine.holding = true;
      }, 500);
    }
  };
  const onMove = (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const dx = e.clientX - ptr.sx;
    const dy = e.clientY - ptr.sy;
    if (ptr.holding) {
      if (onDrag) onDrag(dx, dy);
      return;
    }
    if (Math.hypot(dx, dy) > 10) {
      ptr.moved = true;
      clearTimeout(holdT);
    }
    if (ptr.joystick && ptr.moved) {
      joy.hidden = false;
      joy.style.left = ptr.sx - ptr.rect.left + "px";
      joy.style.top = ptr.sy - ptr.rect.top + "px";
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, len / RADIUS);
      s.x = (dx / len) * k;
      s.z = (dy / len) * k;
      if (Math.abs(s.x) < 0.2) s.x = 0;
      if (Math.abs(s.z) < 0.2) s.z = 0;
      s.anyMove = s.x !== 0 || s.z !== 0;
      knob.style.transform = `translate(${(dx / len) * k * RADIUS}px, ${(dy / len) * k * RADIUS}px)`;
    }
  };
  const onUp = (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    clearTimeout(holdT);
    if (ptr.holding) {
      ptr = null;
      if (onRelease) onRelease();
      return;
    }
    const wasTap = !ptr.moved && performance.now() - ptr.t < 350;
    if (ptr.joystick && ptr.moved) {
      s.x = 0;
      s.z = 0;
      s.anyMove = false;
      recompute();
    }
    joy.hidden = true;
    if (wasTap) onTap(e.clientX, e.clientY);
    ptr = null;
  };
  frame.addEventListener("pointerdown", onDown);
  frame.addEventListener("pointermove", onMove);
  frame.addEventListener("pointerup", onUp);
  frame.addEventListener("pointercancel", onUp);

  // Touch jump button (DOM, visible on coarse pointers).
  const jumpBtn = stage.querySelector("#jump-btn");
  const jd = (e) => {
    e.preventDefault();
    if (!s.jumpHeld) s.jumpPressed = true;
    s.jumpHeld = true;
  };
  const ju = () => {
    s.jumpHeld = false;
  };
  const ac = new AbortController();
  if (jumpBtn) {
    const o = { signal: ac.signal };
    jumpBtn.addEventListener("pointerdown", jd, o);
    jumpBtn.addEventListener("pointerup", ju, o);
    jumpBtn.addEventListener("pointercancel", ju, o);
    jumpBtn.addEventListener("pointerleave", ju, o);
  }

  return {
    state: s,
    dispose() {
      frame.removeEventListener("keydown", onKeyDown);
      frame.removeEventListener("keyup", onKeyUp);
      frame.removeEventListener("blur", onBlur);
      stage.removeEventListener("keydown", stageKey);
      frame.removeEventListener("pointerdown", onDown);
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerup", onUp);
      frame.removeEventListener("pointercancel", onUp);
      clearTimeout(holdT);
      ac.abort();
      joy.remove();
    },
  };
}
