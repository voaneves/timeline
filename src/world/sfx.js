// Procedural WebAudio: no samples, muted by default. The AudioContext is created on the
// first unmute gesture. Original sounds (pentatonic and fifth intervals, noise whooshes).
export function createSfx(initialMuted = true) {
  let ctx = null;
  let master = null;
  let muted = initialMuted;
  let noiseBuf = null;

  const ensure = () => {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  };

  const tone = (type, f0, f1, dur, vol = 0.5, delay = 0) => {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  };
  const noise = (dur, freq, vol = 0.4, delay = 0) => {
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freq * 0.35, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t);
    s.stop(t + dur + 0.02);
  };

  const fx = {
    jump: (p) => tone("square", 220 * p, 440 * p, 0.12, 0.22),
    // Perfect fifth blips.
    coin: (p) => {
      tone("triangle", 660 * p, 660 * p, 0.07, 0.4);
      tone("triangle", 990 * p, 990 * p, 0.14, 0.4, 0.07);
    },
    bump: (p) => {
      tone("sine", 90 * p, 55 * p, 0.18, 0.8);
      noise(0.05, 2400, 0.25);
    },
    pipe: () => {
      noise(0.5, 1800, 0.45);
      tone("sine", 420, 90, 0.5, 0.3);
    },
    land: () => tone("sine", 140, 70, 0.08, 0.35),
    // Paper-and-board crate thump: low knock plus a short rustle.
    crate: (p) => {
      tone("sine", 160 * p, 60 * p, 0.12, 0.55);
      noise(0.09, 1400, 0.3);
    },
    // Rising pentatonic phrase (A minor pentatonic: A4 C5 D5 E5... then A5).
    flag: () => [440, 523.25, 587.33, 880].forEach((f, i) => tone("triangle", f, f, 0.22, 0.45, i * 0.13)),
  };

  return {
    isMuted: () => muted,
    setMuted(m) {
      muted = m;
      if (!muted && ensure() && ctx.state === "suspended") ctx.resume();
    },
    hasContext: () => !!ctx,
    play(name, pitch = 1) {
      if (muted || !ctx || !fx[name]) return;
      try {
        fx[name](pitch * (0.94 + Math.random() * 0.12));
      } catch (e) {}
    },
    dispose() {
      if (ctx) ctx.close();
      ctx = null;
    },
  };
}
