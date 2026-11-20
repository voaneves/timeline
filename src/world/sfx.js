// Procedural WebAudio: no samples, muted by default. The AudioContext is created on the
// first unmute gesture. Original sounds (pentatonic and fifth intervals, noise whooshes).
export function createSfx(initialMuted = true) {
  let ctx = null;
  let master = null;
  let muted = initialMuted;
  let noiseBuf = null;
  let amb = null;
  let ambLp = null;
  let windSrc = null;
  let birdTimer = 0;

  const ensure = () => {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    // Ambient bus: low-passed, so wind and birds sit behind the effects.
    amb = ctx.createGain();
    amb.gain.value = 0;
    ambLp = ctx.createBiquadFilter();
    ambLp.type = "lowpass";
    ambLp.frequency.value = 2600;
    amb.connect(ambLp).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  };

  // Wind (looped noise through a slow low-pass sweep) and procedural birdsong; started only after unmute.
  const chirp = (base, n) => {
    const t = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = base * (1 + (i % 2 ? 0.18 : 0) + Math.random() * 0.06);
      const s = t + i * 0.09;
      o.type = "sine";
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * (1.25 + Math.random() * 0.3), s + 0.07);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.5, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      o.connect(g).connect(amb);
      o.start(s);
      o.stop(s + 0.1);
    }
  };
  const startBed = () => {
    if (!ctx || windSrc) return;
    windSrc = ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 0.11;
    lg.gain.value = 220;
    lfo.connect(lg).connect(lp.frequency);
    lfo.start();
    const wg = ctx.createGain();
    wg.gain.value = 0.09;
    windSrc.connect(lp).connect(wg).connect(amb);
    windSrc.start();
    const sing = () => {
      if (!ctx) return;
      if (!muted) chirp(2400 + Math.random() * 1600, 2 + Math.floor(Math.random() * 4));
      birdTimer = setTimeout(sing, 2500 + Math.random() * 4500);
    };
    birdTimer = setTimeout(sing, 1200);
  };
  const bed = (on) => {
    if (!ctx || !amb) return;
    if (on) startBed();
    amb.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.4);
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
    // Layered kick: sub thump, mid knock, paper click and a rustle tail.
    crate: (p) => {
      tone("sine", 130 * p, 42 * p, 0.2, 0.7);
      tone("triangle", 220 * p, 90 * p, 0.1, 0.35);
      tone("square", 1800 * p, 900 * p, 0.02, 0.12);
      noise(0.09, 1400, 0.3);
      noise(0.22, 3200, 0.12, 0.05);
    },
    // Warp sting: rising sweep, then a bright fifth.
    warp: (p) => {
      noise(0.45, 900, 0.3);
      tone("sawtooth", 180 * p, 720 * p, 0.4, 0.14);
      tone("triangle", 880 * p, 880 * p, 0.25, 0.3, 0.38);
      tone("triangle", 1320 * p, 1320 * p, 0.35, 0.28, 0.46);
    },
    // Secret reveal: hushed shimmer and a rising minor-pentatonic arpeggio.
    secret: (p) => {
      noise(0.5, 6000, 0.1);
      [392, 466.16, 587.33, 783.99, 1174.66].forEach((f, i) => tone("sine", f * p, f * p, 0.4, 0.34, i * 0.08));
      tone("triangle", 196 * p, 196 * p, 0.8, 0.3);
    },
    // Rising pentatonic phrase (A minor pentatonic: A4 C5 D5 E5... then A5).
    flag: () => [440, 523.25, 587.33, 880].forEach((f, i) => tone("triangle", f, f, 0.22, 0.45, i * 0.13)),
  };

  return {
    isMuted: () => muted,
    setMuted(m) {
      muted = m;
      if (!muted && ensure() && ctx.state === "suspended") ctx.resume();
      if (ctx) bed(!muted);
    },
    hasContext: () => !!ctx,
    play(name, pitch = 1) {
      if (muted || !ctx || !fx[name]) return;
      try {
        fx[name](pitch * (0.92 + Math.random() * 0.16)); // +-8% per event
      } catch (e) {}
    },
    dispose() {
      clearTimeout(birdTimer);
      if (ctx) ctx.close();
      ctx = null;
    },
  };
}
