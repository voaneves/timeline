// Small motion helpers: damped spring, critically damped follower, tweens.

// Underdamped spring around 0 (block bump, pipe squash, avatar squash and stretch).
export class Spring {
  constructor(k = 220, c = 11) {
    this.k = k;
    this.c = c;
    this.x = 0;
    this.v = 0;
  }
  kick(v) {
    this.v += v;
  }
  update(dt) {
    // Sub-step for stability at low frame rates.
    const n = Math.ceil(dt / 0.008) || 1;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * this.x - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

// Critically damped follower (smooth-damp), used by the camera.
export class Damper {
  constructor(x = 0) {
    this.x = x;
    this.v = 0;
  }
  update(target, smoothTime, dt) {
    const omega = 2 / Math.max(0.0001, smoothTime);
    const x = omega * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.x - target;
    const temp = (this.v + omega * change) * dt;
    this.v = (this.v - omega * temp) * e;
    this.x = target + (change + temp) * e;
    return this.x;
  }
  snap(x) {
    this.x = x;
    this.v = 0;
  }
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Tween runner: tween(seconds, fn(t 0..1)) returns a promise, advanced by update(dt).
export function createTweens() {
  const list = [];
  return {
    tween(seconds, fn) {
      return new Promise((resolve) => list.push({ t: 0, d: Math.max(0.0001, seconds), fn, resolve }));
    },
    wait(seconds) {
      return this.tween(seconds, () => {});
    },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const a = list[i];
        a.t += dt;
        const k = Math.min(1, a.t / a.d);
        a.fn(k);
        if (k >= 1) {
          list.splice(i, 1);
          a.resolve();
        }
      }
    },
    clear() {
      list.length = 0;
    },
  };
}
