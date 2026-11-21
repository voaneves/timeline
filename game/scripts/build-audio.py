#!/usr/bin/env python3
"""
First-party acoustic foley, modal, and physical-modeling audio generator
for VOANEVES Timeline 3D (Phase 2F: T2.22 + T2.23).

Synthesizes 30 common SFX (`static/sounds/common/*.mp3`) and 2 seamless
Era 1 Origens ambiences (`static/sounds/origens/*.mp3`) using multi-layered
physical models (biquad-filtered pink/brown noise bursts, Karplus-Strong
plucked strings, modal wood/paper/stone/ceramic resonator banks, multi-body
impact transients, early-reflection room convolution, and Baião Mixolydian
harmonic voicings). Encodes via ffmpeg (libmp3lame, 44.1 kHz) and verifies
EBU R128 loudness (`ffmpeg -af ebur128 -t <dur>`).

License: CC0-1.0 / MIT (100% original procedural synthesis by Victor Neves).
"""

from __future__ import annotations

import math
import os
import re
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

SR = 44100
ROOT_DIR = Path(__file__).resolve().parent.parent
SOUNDS_DIR = ROOT_DIR / "static" / "sounds"
COMMON_DIR = SOUNDS_DIR / "common"
ORIGENS_DIR = SOUNDS_DIR / "origens"
LICENSES_AUDIO_PATH = ROOT_DIR / "LICENSES-AUDIO.md"


# ---------------------------------------------------------------------------
# Core DSP & Acoustic Physical Modeling Primitives
# ---------------------------------------------------------------------------

def make_rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def white_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    return rng.standard_normal(n).astype(np.float64)


def pink_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    """1/f pink noise via frequency-domain shaping."""
    w = rng.standard_normal(n)
    spec = np.fft.rfft(w)
    freqs = np.fft.rfftfreq(n, d=1.0 / SR)
    scale = np.ones_like(freqs)
    nonzero = freqs > 0
    scale[nonzero] = 1.0 / np.sqrt(freqs[nonzero])
    scale[0] = 0.0
    out = np.fft.irfft(spec * scale, n=n)
    mx = np.max(np.abs(out)) + 1e-12
    return (out / mx).astype(np.float64)


def brown_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    """1/f^2 brownian noise via frequency-domain shaping (>25 Hz)."""
    w = rng.standard_normal(n)
    spec = np.fft.rfft(w)
    freqs = np.fft.rfftfreq(n, d=1.0 / SR)
    scale = np.zeros_like(freqs)
    mask = freqs >= 25.0
    scale[mask] = 1.0 / freqs[mask]
    out = np.fft.irfft(spec * scale, n=n)
    mx = np.max(np.abs(out)) + 1e-12
    return (out / mx).astype(np.float64)


def fft_bandpass(x: np.ndarray, f_low: float, f_high: float, roll_oct: float = 1.5) -> np.ndarray:
    """Zero-phase smooth bandpass filter in frequency domain."""
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, d=1.0 / SR)
    gain = np.ones_like(freqs)
    if f_low > 0:
        low_mask = freqs < f_low
        gain[low_mask] *= np.power(np.maximum(freqs[low_mask] / f_low, 1e-6), 2.0 * roll_oct)
    if f_high < SR * 0.5:
        high_mask = freqs > f_high
        gain[high_mask] *= np.power(f_high / np.maximum(freqs[high_mask], f_high), 2.0 * roll_oct)
    gain[0] = 0.0
    return np.fft.irfft(spec * gain, n=n)


def fft_formant(x: np.ndarray, f_center: float, bw: float) -> np.ndarray:
    """Resonant formant peak filter in frequency domain."""
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, d=1.0 / SR)
    resp = np.exp(-0.5 * ((freqs - f_center) / max(bw, 1.0)) ** 2)
    return np.fft.irfft(spec * resp, n=n)


def adsr_env(
    n: int,
    attack_s: float = 0.004,
    decay_s: float = 0.08,
    sustain_level: float = 0.0,
    release_s: float = 0.05,
    curve: float = 2.0,
) -> np.ndarray:
    """Exponential-curved attack-decay-sustain-release envelope."""
    t = np.arange(n, dtype=np.float64) / SR
    env = np.zeros(n, dtype=np.float64)
    a_n = max(1, int(attack_s * SR))
    d_n = max(1, int(decay_s * SR))
    r_n = max(1, int(release_s * SR))

    # Attack
    end_a = min(n, a_n)
    env[:end_a] = np.linspace(0.0, 1.0, end_a) ** 0.7

    # Decay to sustain
    if end_a < n:
        end_d = min(n, end_a + d_n)
        span = end_d - end_a
        decay_curve = np.exp(-curve * np.linspace(0.0, 3.0, span))
        env[end_a:end_d] = sustain_level + (1.0 - sustain_level) * decay_curve

        # Sustain & release
        if end_d < n:
            rem = n - end_d
            if sustain_level > 0:
                rel_start = max(end_d, n - r_n)
                env[end_d:rel_start] = sustain_level
                rel_len = n - rel_start
                if rel_len > 0:
                    env[rel_start:] = sustain_level * (np.linspace(1.0, 0.0, rel_len) ** curve)
    return env


def modal_bank(
    n: int,
    modes: list[tuple[float, float, float]],
    pitch_drop_hz: float = 0.0,
    pitch_drop_tau: float = 0.015,
    phases: list[float] | None = None,
) -> np.ndarray:
    """
    Synthesizes an acoustic impact over a bank of damped vibrational modes.
    Each mode is (freq_hz, amp, decay_tau_s).
    """
    t = np.arange(n, dtype=np.float64) / SR
    out = np.zeros(n, dtype=np.float64)
    for idx, (f0, amp, tau) in enumerate(modes):
        ph = phases[idx] if phases is not None else (idx * 1.17)
        if pitch_drop_hz != 0.0:
            inst_phase = 2.0 * math.pi * (
                f0 * t + pitch_drop_hz * pitch_drop_tau * (1.0 - np.exp(-t / pitch_drop_tau))
            ) + ph
        else:
            inst_phase = 2.0 * math.pi * f0 * t + ph
        out += amp * np.sin(inst_phase) * np.exp(-t / max(tau, 0.001))
    # 1.5 ms soft onset to avoid digital DC click while keeping crisp impact transient
    attack = min(n, int(0.0015 * SR))
    if attack > 1:
        out[:attack] *= np.linspace(0.0, 1.0, attack)
    return out


def karplus_strong(
    n: int,
    freq_hz: float,
    damping: float = 0.994,
    brightness: float = 0.65,
    pluck_pos: float = 0.28,
    seed: int = 101,
) -> np.ndarray:
    """
    Extended Karplus-Strong physical string model with pick-position comb filter,
    body resonance modes, and warm low-pass loop damping (viola caipira / nylon guitar).
    """
    rng = make_rng(seed)
    period = max(4, int(round(SR / freq_hz)))
    # Initial excitation: filtered pink noise + warm fundamental half-sine pulse
    exc = pink_noise(period, rng) * brightness + (1.0 - brightness) * np.sin(
        np.linspace(0.0, 2.0 * math.pi, period)
    )
    # Pick-position comb filtering
    comb_delay = max(1, int(round(period * pluck_pos)))
    exc_comb = exc.copy()
    if comb_delay < period:
        exc_comb[comb_delay:] -= 0.55 * exc[:-comb_delay]

    buf = np.zeros(n + period + 2, dtype=np.float64)
    buf[:period] = exc_comb
    # Fractional delay correction via all-pass / weighted 2-point average
    exact_period = SR / freq_hz
    frac = exact_period - math.floor(exact_period)
    alpha = 0.35 + 0.35 * (1.0 - brightness)

    p = int(math.floor(exact_period))
    for i in range(period, n):
        s0 = buf[i - p]
        s1 = buf[i - p - 1]
        s2 = buf[i - p - 2] if (i - p - 2) >= 0 else s1
        interp = (1.0 - frac) * s0 + frac * s1
        lp = (1.0 - alpha) * interp + alpha * s2
        buf[i] = damping * lp

    out = buf[:n]
    # Add wooden guitar body modes (top plate ~195 Hz, air cavity ~108 Hz, bridge ~420 Hz)
    body = modal_bank(
        n,
        [
            (108.0, 0.14, 0.09),
            (196.0, 0.18, 0.075),
            (390.0, 0.10, 0.055),
            (freq_hz, 0.22, 0.42),
            (freq_hz * 2.0, 0.11, 0.28),
        ],
    )
    out = 0.78 * out + 0.22 * body
    mx = np.max(np.abs(out)) + 1e-12
    return out / mx


def apply_early_reflections(
    x: np.ndarray,
    taps_ms: list[tuple[float, float]] | None = None,
) -> np.ndarray:
    """Adds subtle physical room/outdoor early reflections for natural acoustic depth."""
    if taps_ms is None:
        taps_ms = [
            (4.3, 0.22),
            (9.7, -0.15),
            (16.4, 0.11),
            (24.8, 0.07),
            (37.1, -0.045),
        ]
    out = x.copy()
    n = len(x)
    for delay_ms, gain in taps_ms:
        d = int(round(delay_ms * 0.001 * SR))
        if 0 < d < n:
            out[d:] += gain * x[:-d]
    return out


def mix_at(dst: np.ndarray, src: np.ndarray, offset_s: float, gain: float = 1.0) -> None:
    """Mixes `src * gain` into `dst` starting at `offset_s` seconds."""
    idx = max(0, int(round(offset_s * SR)))
    if idx >= len(dst):
        return
    avail = min(len(src), len(dst) - idx)
    dst[idx : idx + avail] += gain * src[:avail]


def make_seamless_loop(raw: np.ndarray, crossfade_s: float = 1.5) -> np.ndarray:
    """
    Takes a buffer of length (L + crossfade) and crossfades the tail into the head
    using an equal-power sin/cos window so the resulting buffer of length L loops
    with zero phase/amplitude discontinuity.
    """
    cf_n = int(round(crossfade_s * SR))
    assert len(raw) > 2 * cf_n, "Buffer too short for crossfade loop"
    loop_n = len(raw) - cf_n
    body = raw[:loop_n].copy()
    tail = raw[loop_n : loop_n + cf_n]
    theta = np.linspace(0.0, 0.5 * math.pi, cf_n)
    fade_in = np.sin(theta)
    fade_out = np.cos(theta)
    body[:cf_n] = body[:cf_n] * fade_in + tail * fade_out
    return body


def normalize_signal(
    x: np.ndarray,
    target_peak_dbfs: float = -3.0,
    fade_in_ms: float = 2.0,
    fade_out_ms: float = 15.0,
    seamless: bool = False,
) -> np.ndarray:
    """
    Removes DC offset, applies soft-knee saturation if needed, fades edges (unless seamless),
    and scales peak to `target_peak_dbfs` so MP3 encoding stays safely <= -1.5 dBTP.
    """
    y = x - np.mean(x)
    n = len(y)
    if not seamless:
        fi = min(n // 4, max(1, int(fade_in_ms * 0.001 * SR)))
        fo = min(n // 2, max(1, int(fade_out_ms * 0.001 * SR)))
        y[:fi] *= np.linspace(0.0, 1.0, fi)
        y[-fo:] *= np.linspace(1.0, 0.0, fo) ** 1.5

    # Soft tanh saturation to tame extreme micro-transients before peak scaling
    mx = np.max(np.abs(y)) + 1e-12
    y = y / mx
    y = np.tanh(1.25 * y) / math.tanh(1.25)

    target_lin = 10.0 ** (target_peak_dbfs / 20.0)
    mx2 = np.max(np.abs(y)) + 1e-12
    return y * (target_lin / mx2)


def normalize_lufs_signal(
    x: np.ndarray,
    target_lufs_approx: float = -20.0,
    max_peak_dbfs: float = -3.0,
    seamless: bool = True,
) -> np.ndarray:
    """
    Normalizes continuous ambience signals to a target RMS/LUFS level while clamping
    true peak below `max_peak_dbfs`.
    """
    y = x - np.mean(x)
    # Soft compression on peaks
    mx0 = np.max(np.abs(y)) + 1e-12
    y = np.tanh(1.4 * (y / mx0))
    rms = np.sqrt(np.mean(y ** 2)) + 1e-12
    # Empirical relation for broadband natural ambience: LUFS ~ 20*log10(rms) - 0.6
    target_rms = 10.0 ** ((target_lufs_approx + 0.6) / 20.0)
    y = y * (target_rms / rms)

    max_lin = 10.0 ** (max_peak_dbfs / 20.0)
    peak = np.max(np.abs(y))
    if peak > max_lin:
        # Soft limiter
        y = max_lin * np.tanh(y / max_lin)

    if not seamless:
        fo = min(len(y) // 4, int(0.025 * SR))
        y[-fo:] *= np.linspace(1.0, 0.0, fo)
    return y


# ---------------------------------------------------------------------------
# 1. Common SFX Recipes (30 files in static/sounds/common/)
# ---------------------------------------------------------------------------

def synth_step_laterite(variation: int) -> np.ndarray:
    """
    Red-earth gravel/laterite footstep:
    1) Low earth heel thud (modal damped earth impact 85-135 Hz)
    2) Cluster of 10-16 micro-gravel laterite pebble crunches (bandpassed 1.4-5.5 kHz impulses)
    3) Toe roll-off friction grit (600-2800 Hz)
    """
    rng = make_rng(1000 + variation * 73)
    dur = 0.24 + 0.015 * (variation % 2)
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float64)

    # 1. Earth heel thud
    base_f = 92.0 + variation * 7.5
    heel = modal_bank(
        n,
        [
            (base_f, 1.0, 0.032),
            (base_f * 1.65, 0.55, 0.022),
            (base_f * 2.4, 0.28, 0.014),
        ],
        pitch_drop_hz=35.0,
        pitch_drop_tau=0.012,
    )
    out += 0.68 * heel

    # 2. Micro-gravel pebble crunches (heel cluster at 4-35 ms + toe cluster at 45-95 ms)
    n_grains = 14 + variation * 2
    for g in range(n_grains):
        if g < n_grains // 2:
            t0 = rng.uniform(0.003, 0.038)
            amp = rng.uniform(0.28, 0.55)
        else:
            t0 = rng.uniform(0.045, 0.105)
            amp = rng.uniform(0.18, 0.42)
        g_len = int(rng.uniform(0.008, 0.022) * SR)
        noise = pink_noise(g_len, rng)
        fc = rng.uniform(1350.0, 4800.0)
        grain = fft_bandpass(noise, fc * 0.65, min(SR * 0.45, fc * 1.45))
        grain *= adsr_env(g_len, attack_s=0.001, decay_s=g_len / SR * 0.85, curve=2.5)
        # Add tiny mineral click mode
        grain += 0.25 * modal_bank(g_len, [(fc, 1.0, 0.0035), (fc * 1.43, 0.6, 0.0022)])
        mix_at(out, grain, t0, amp)

    # 3. Laterite dust/grit scrape envelope
    grit = fft_bandpass(pink_noise(n, rng), 450.0, 3400.0)
    grit_env = adsr_env(n, attack_s=0.008, decay_s=0.095, curve=2.2)
    out += 0.34 * grit * grit_env

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.2)


def synth_step_grass(variation: int) -> np.ndarray:
    """
    Dry cerrado grass (capim-dourado / brachiaria) brush + soft soil step:
    1) Soft soil sole thump (110 Hz)
    2) Multi-blade dry grass swish & fibrous crackles (2.2-8.5 kHz formant sweep)
    """
    rng = make_rng(2000 + variation * 89)
    dur = 0.26
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float64)

    # Soft soil base
    soil_f = 104.0 + variation * 5.0
    soil = modal_bank(
        n,
        [(soil_f, 0.75, 0.030), (soil_f * 1.8, 0.35, 0.018)],
        pitch_drop_hz=25.0,
    )
    out += 0.45 * soil

    # Two-phase grass blade swish (foot entry + blade spring-back)
    for phase_idx, (t_start, dur_swish, f_lo, f_hi, g_amp) in enumerate([
        (0.004, 0.085, 1800.0 + variation * 120, 7200.0, 0.65),
        (0.055, 0.120, 2400.0 + variation * 150, 8800.0, 0.50),
    ]):
        sn = int(dur_swish * SR)
        sw = fft_bandpass(pink_noise(sn, rng), f_lo, f_hi)
        # Amplitude modulation simulating individual dry stalks brushing past shoe
        t_sw = np.arange(sn, dtype=np.float64) / SR
        mod = 0.65 + 0.35 * np.sin(2.0 * math.pi * (38.0 + variation * 7 + phase_idx * 13) * t_sw)
        sw *= mod * adsr_env(sn, attack_s=0.012, decay_s=dur_swish * 0.82, curve=1.8)
        mix_at(out, sw, t_start, g_amp)

    # Crisp dry stalk micro-snaps
    for _ in range(9 + variation):
        t0 = rng.uniform(0.010, 0.130)
        sn = int(0.007 * SR)
        snap = fft_bandpass(white_noise(sn, rng), 3200.0, 9500.0)
        snap *= adsr_env(sn, attack_s=0.0006, decay_s=0.005, curve=3.0)
        mix_at(out, snap, t0, rng.uniform(0.18, 0.35))

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.5)


def synth_step_wood(variation: int) -> np.ndarray:
    """
    Warm hollow wooden porch / desk plank step:
    Modal orthotropic wood plate resonance (fundamental 145-185 Hz + woody overtones
    290, 460, 780, 1250 Hz) + leather/sneaker sole transient.
    """
    rng = make_rng(3000 + variation * 103)
    dur = 0.23
    n = int(dur * SR)
    f0 = 148.0 + variation * 14.0

    # Hollow wooden plank modes
    plank = modal_bank(
        n,
        [
            (f0 * 0.68, 0.55, 0.045),       # sub-cavity air resonance
            (f0, 1.00, 0.052),              # primary plank bending mode
            (f0 * 1.58, 0.68, 0.036),       # torsional wood mode
            (f0 * 2.37, 0.44, 0.025),       # stiff grain mode
            (f0 * 3.85, 0.25, 0.015),       # surface knock brightness
            (f0 * 5.60, 0.14, 0.009),       # sole contact click
        ],
        pitch_drop_hz=18.0,
        pitch_drop_tau=0.008,
    )

    # Secondary toe tap on plank ~38 ms later
    toe = modal_bank(
        int(0.12 * SR),
        [
            (f0 * 1.12, 0.38, 0.032),
            (f0 * 2.45, 0.26, 0.018),
            (f0 * 4.20, 0.15, 0.010),
        ],
    )
    out = plank.copy()
    mix_at(out, toe, 0.036 + variation * 0.004, 0.62)

    # Subtle shoe sole scuff texture
    scuff = fft_bandpass(pink_noise(n, rng), 500.0, 2600.0)
    scuff *= adsr_env(n, attack_s=0.002, decay_s=0.040, curve=2.6)
    out += 0.22 * scuff

    out = apply_early_reflections(
        out,
        [(3.2, 0.28), (7.5, -0.20), (13.8, 0.14), (21.5, -0.08)],
    )
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_step_stone(variation: int) -> np.ndarray:
    """
    Stone / concrete / ceramic patio tile step:
    Crisp high-density mineral transient (900-4200 Hz) + firm slab impact (170-260 Hz)
    + fine sand grain micro-clicks.
    """
    rng = make_rng(4000 + variation * 127)
    dur = 0.21
    n = int(dur * SR)
    f0 = 185.0 + variation * 19.0

    slab = modal_bank(
        n,
        [
            (f0, 0.75, 0.022),
            (f0 * 2.15, 0.55, 0.014),
            (f0 * 4.70, 0.48, 0.009),
            (f0 * 7.80, 0.32, 0.006),
            (f0 * 11.4, 0.20, 0.004),
        ],
        pitch_drop_hz=12.0,
        pitch_drop_tau=0.005,
    )

    # Crisp sole-on-stone transient burst
    click = fft_bandpass(white_noise(n, rng), 1100.0, 6200.0)
    click *= adsr_env(n, attack_s=0.0008, decay_s=0.024, curve=3.2)

    # Toe tap
    toe_n = int(0.10 * SR)
    toe = fft_bandpass(pink_noise(toe_n, rng), 1400.0, 5800.0)
    toe *= adsr_env(toe_n, attack_s=0.001, decay_s=0.019, curve=3.0)
    toe += 0.4 * modal_bank(toe_n, [(f0 * 5.1, 0.5, 0.007), (f0 * 8.3, 0.3, 0.004)])

    out = 0.72 * slab + 0.45 * click
    mix_at(out, toe, 0.032 + variation * 0.005, 0.55)

    out = apply_early_reflections(
        out,
        [(2.6, 0.25), (6.1, 0.18), (11.9, -0.12), (19.4, 0.07)],
    )
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_jump_launch() -> np.ndarray:
    """
    Tactile cloth/foot push-off whoosh + warm wooden marimba upward transient (no 8-bit coin/jump sweep).
    """
    rng = make_rng(5015)
    dur = 0.34
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float64) / SR
    out = np.zeros(n, dtype=np.float64)

    # 1. Foot push-off ground impulse
    push = modal_bank(
        n,
        [(112.0, 0.85, 0.028), (218.0, 0.45, 0.019), (390.0, 0.25, 0.012)],
        pitch_drop_hz=28.0,
    )
    out += 0.55 * push

    # 2. Jacket/scarf cloth whoosh (swept formant noise burst)
    raw_noise = pink_noise(n, rng)
    lo = fft_bandpass(raw_noise, 320.0, 1200.0)
    mid = fft_bandpass(raw_noise, 800.0, 2800.0)
    hi = fft_bandpass(raw_noise, 1800.0, 5200.0)
    w_lo = np.exp(-((t - 0.035) / 0.045) ** 2)
    w_mid = np.exp(-((t - 0.085) / 0.060) ** 2)
    w_hi = np.exp(-((t - 0.145) / 0.075) ** 2)
    whoosh = 0.50 * lo * w_lo + 0.70 * mid * w_mid + 0.45 * hi * w_hi
    out += 0.65 * whoosh

    # 3. Subtle warm wooden marimba double grace-note (D4 -> A4 acoustic wood bars)
    for note_t, f_bar, gain in [(0.008, 293.66, 0.34), (0.042, 440.00, 0.40)]:
        bn = int(0.22 * SR)
        # Marimba bar modes: f0, 3.98*f0, 9.2*f0
        bar = modal_bank(
            bn,
            [
                (f_bar, 1.0, 0.065),
                (f_bar * 2.0, 0.18, 0.040),
                (f_bar * 3.98, 0.35, 0.018),
                (f_bar * 9.20, 0.10, 0.006),
            ],
        )
        mix_at(out, bar, note_t, gain)

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_flutter_ribbon() -> np.ndarray:
    """
    Crisp paper-ribbon kite snap + airy flutter for 2nd-tap glide (`flutter`).
    """
    rng = make_rng(5016)
    dur = 0.48
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float64) / SR
    out = np.zeros(n, dtype=np.float64)

    # 1. Initial taut paper-ribbon snap at t=0.01s
    snap_n = int(0.065 * SR)
    snap_noise = fft_bandpass(white_noise(snap_n, rng), 1100.0, 6800.0)
    snap_noise *= adsr_env(snap_n, attack_s=0.0015, decay_s=0.028, curve=2.8)
    snap_modes = modal_bank(
        snap_n,
        [(340.0, 0.65, 0.018), (690.0, 0.55, 0.014), (1420.0, 0.40, 0.009)],
        pitch_drop_hz=80.0,
        pitch_drop_tau=0.008,
    )
    mix_at(out, 0.65 * snap_noise + 0.55 * snap_modes, 0.006, 0.85)

    # 2. Rhythmic paper-wing flutter (3 rapid airy pulses at ~14 Hz modulation)
    air = fft_bandpass(pink_noise(n, rng), 550.0, 4400.0)
    crisp = fft_bandpass(pink_noise(n, rng), 2200.0, 7500.0)
    flutter_mod = 0.55 + 0.45 * np.sin(2.0 * math.pi * 13.5 * t - 0.6)
    env = adsr_env(n, attack_s=0.025, decay_s=0.36, curve=1.6)
    out += (0.55 * air + 0.30 * crisp * (flutter_mod ** 2)) * flutter_mod * env

    # 3. Gentle harmonic paper-reed shimmer (F#4 + A4 + E5)
    reed = modal_bank(
        n,
        [
            (369.99, 0.16, 0.19),
            (440.00, 0.14, 0.21),
            (659.25, 0.10, 0.17),
        ],
    ) * np.sin(2.0 * math.pi * 13.5 * t) ** 2
    out += 0.45 * reed

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_land_soft() -> np.ndarray:
    """
    Soft earth/shoe thud + cloth settle (`land_soft`).
    """
    rng = make_rng(5017)
    dur = 0.28
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float64)

    # First foot + second foot 22 ms later
    for offset, f0, g in [(0.003, 96.0, 0.78), (0.024, 114.0, 0.58)]:
        fn = int(0.18 * SR)
        thud = modal_bank(
            fn,
            [
                (f0, 1.0, 0.036),
                (f0 * 1.72, 0.48, 0.022),
                (f0 * 2.85, 0.22, 0.013),
            ],
            pitch_drop_hz=32.0,
            pitch_drop_tau=0.012,
        )
        grit = fft_bandpass(pink_noise(fn, rng), 500.0, 2900.0)
        grit *= adsr_env(fn, attack_s=0.003, decay_s=0.055, curve=2.3)
        mix_at(out, thud + 0.32 * grit, offset, g)

    # Jacket/backpack cloth settle at 45 ms
    cn = int(0.16 * SR)
    cloth = fft_bandpass(pink_noise(cn, rng), 750.0, 3800.0)
    cloth *= adsr_env(cn, attack_s=0.015, decay_s=0.11, curve=2.0)
    mix_at(out, cloth, 0.045, 0.35)

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.2)


def synth_land_hard() -> np.ndarray:
    """
    Heavier dual-transient thud + dust puff (`land_hard`).
    """
    rng = make_rng(5018)
    dur = 0.38
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float64)

    # Dual impact transients: soles hit (t=0.004) + knees/body compression thump (t=0.034)
    for offset, f0, drop, g in [(0.003, 74.0, 42.0, 0.95), (0.034, 88.0, 30.0, 0.75)]:
        fn = int(0.24 * SR)
        impact = modal_bank(
            fn,
            [
                (f0, 1.0, 0.052),
                (f0 * 1.55, 0.65, 0.035),
                (f0 * 2.40, 0.40, 0.022),
                (f0 * 3.90, 0.22, 0.012),
            ],
            pitch_drop_hz=drop,
            pitch_drop_tau=0.016,
        )
        mix_at(out, impact, offset, g)

    # Laterite gravel scatter + dust puff
    for g in range(18):
        t0 = rng.uniform(0.006, 0.140)
        gn = int(rng.uniform(0.010, 0.025) * SR)
        fc = rng.uniform(1200.0, 4600.0)
        grain = fft_bandpass(pink_noise(gn, rng), fc * 0.7, fc * 1.4)
        grain *= adsr_env(gn, attack_s=0.001, decay_s=gn / SR * 0.85, curve=2.6)
        mix_at(out, grain, t0, rng.uniform(0.18, 0.36))

    dust = fft_bandpass(pink_noise(n, rng), 320.0, 2600.0)
    dust *= adsr_env(n, attack_s=0.015, decay_s=0.25, curve=1.8)
    out += 0.42 * dust

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-2.8)


def synth_skid_dust() -> np.ndarray:
    """
    Gravel/earth shoe slide scrape (`skid_dust`).
    """
    rng = make_rng(5019)
    dur = 0.36
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float64) / SR
    out = np.zeros(n, dtype=np.float64)

    # Shoe sole friction scrape across red earth
    noise = pink_noise(n, rng)
    band1 = fft_bandpass(noise, 550.0, 2200.0)
    band2 = fft_bandpass(noise, 1800.0, 5600.0)
    # Decelerating granular modulation
    mod_freq = 48.0 - 24.0 * (t / dur)
    mod = 0.60 + 0.40 * np.sin(2.0 * math.pi * np.cumsum(mod_freq) / SR)
    env = adsr_env(n, attack_s=0.018, decay_s=0.29, curve=1.7)
    out += (0.55 * band1 + 0.65 * band2) * mod * env

    # Rolling pebbles
    for _ in range(22):
        t0 = rng.uniform(0.010, 0.270)
        gn = int(rng.uniform(0.007, 0.018) * SR)
        fc = rng.uniform(1500.0, 5400.0)
        pebble = fft_bandpass(white_noise(gn, rng), fc * 0.7, fc * 1.35)
        pebble *= adsr_env(gn, attack_s=0.0008, decay_s=gn / SR * 0.85, curve=2.8)
        mix_at(out, pebble, t0, rng.uniform(0.16, 0.38) * (1.0 - 0.6 * (t0 / dur)))

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_stamp_lock() -> np.ndarray:
    """
    Rubber stamp pull-out click + taut paper tension (`stamp_lock`).
    """
    rng = make_rng(5020)
    dur = 0.30
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float64)

    # 1. Wooden handle + brass spring latch click at t=0.008s
    click1 = modal_bank(
        int(0.08 * SR),
        [
            (320.0, 0.65, 0.016),
            (740.0, 0.85, 0.012),
            (1580.0, 0.60, 0.007),
            (3120.0, 0.35, 0.004),
        ],
        pitch_drop_hz=25.0,
    )
    mix_at(out, click1, 0.006, 0.75)

    # 2. Second ratchet lock snap at t=0.048s (higher pitch, firmer lock)
    click2 = modal_bank(
        int(0.10 * SR),
        [
            (440.0, 0.75, 0.018),
            (980.0, 0.90, 0.013),
            (2150.0, 0.55, 0.008),
            (3840.0, 0.30, 0.004),
        ],
    )
    mix_at(out, click2, 0.048, 0.85)

    # 3. Taut paper-creak tension swell (0.04s -> 0.25s)
    creak_n = int(0.22 * SR)
    t_c = np.arange(creak_n, dtype=np.float64) / SR
    # Micro-stick-slip pulses of taut cardstock
    stick_slip = np.sin(2.0 * math.pi * (145.0 * t_c + 40.0 * (t_c ** 2)))
    stick_slip += 0.5 * np.sin(2.0 * math.pi * (290.0 * t_c + 80.0 * (t_c ** 2)))
    paper_tex = fft_bandpass(pink_noise(creak_n, rng), 600.0, 2800.0)
    creak = (0.45 * stick_slip + 0.55 * paper_tex) * adsr_env(
        creak_n, attack_s=0.035, decay_s=0.16, curve=1.8
    )
    mix_at(out, creak, 0.052, 0.48)

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_stamp_impact() -> np.ndarray:
    """
    Deep authoritative rubber-stamp ink thump + wooden desk resonance (`stamp_impact`).
    """
    rng = make_rng(5021)
    dur = 0.44
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float64)

    # 1. Heavy rubber pad + wooden desk impact thump
    desk = modal_bank(
        n,
        [
            (68.0, 1.00, 0.075),    # deep desk cavity resonance
            (132.0, 0.88, 0.058),   # primary wooden table mode
            (224.0, 0.62, 0.042),   # rubber stamp block body
            (369.99, 0.40, 0.035),  # F#4 warm wooden harmonic
            (587.33, 0.26, 0.025),  # D5 harmonic body
            (940.0, 0.20, 0.012),   # crisp paper slap
        ],
        pitch_drop_hz=45.0,
        pitch_drop_tau=0.015,
    )
    out += 0.85 * desk

    # 2. Wet ink pad suction/imprint transient on heavy cream paper
    ink_n = int(0.09 * SR)
    ink = fft_bandpass(pink_noise(ink_n, rng), 700.0, 4800.0)
    ink *= adsr_env(ink_n, attack_s=0.001, decay_s=0.042, curve=2.8)
    mix_at(out, ink, 0.003, 0.55)

    # 3. Subtle spring release micro-rebound at t=0.085s
    reb_n = int(0.14 * SR)
    rebound = modal_bank(
        reb_n,
        [(293.66, 0.35, 0.032), (587.33, 0.25, 0.022), (1174.66, 0.14, 0.014)],
    )
    paper_settle = fft_bandpass(pink_noise(reb_n, rng), 900.0, 3600.0) * adsr_env(
        reb_n, attack_s=0.005, decay_s=0.08, curve=2.4
    )
    mix_at(out, rebound + 0.4 * paper_settle, 0.085, 0.42)

    out = apply_early_reflections(
        out,
        [(3.8, 0.28), (8.9, -0.19), (17.2, 0.13), (28.5, 0.08)],
    )
    return normalize_signal(out, target_peak_dbfs=-2.8)


def synth_block_bump() -> np.ndarray:
    """
    Hollow paper/wood milestone block hit from below + warm resonant chime (`block_bump`).
    """
    rng = make_rng(5022)
    dur = 0.42
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float64)

    # 1. Hollow cardboard/wood diorama box knock
    box = modal_bank(
        n,
        [
            (138.0, 0.85, 0.045),
            (246.94, 0.90, 0.042),
            (392.00, 0.55, 0.030),
            (640.0, 0.35, 0.018),
        ],
        pitch_drop_hz=28.0,
        pitch_drop_tau=0.010,
    )
    out += 0.65 * box

    # 2. Crisp paper fold pop as the block springs up (t=0.022s)
    pop_n = int(0.08 * SR)
    pop = fft_bandpass(pink_noise(pop_n, rng), 900.0, 4500.0)
    pop *= adsr_env(pop_n, attack_s=0.002, decay_s=0.045, curve=2.4)
    mix_at(out, pop, 0.018, 0.45)

    # 3. Warm acoustic rosewood marimba + vibraphone milestone chord (D4 + A4 + F#5, Mixolydian triad)
    chime = modal_bank(
        n,
        [
            (293.66, 0.48, 0.14),   # D4
            (440.00, 0.44, 0.16),   # A4
            (739.99, 0.34, 0.15),   # F#5
            (1174.66, 0.16, 0.09),  # D6 overtone
        ],
    )
    mix_at(out, chime, 0.015, 0.62)

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_block_solid() -> np.ndarray:
    """
    Dull solid brick/masonry bump (`block_solid` / `hurtBump`).
    """
    rng = make_rng(5023)
    dur = 0.25
    n = int(dur * SR)

    # Dense non-harmonic masonry/brick modes with fast damping
    masonry = modal_bank(
        n,
        [
            (105.0, 1.00, 0.034),
            (168.0, 0.80, 0.026),
            (262.0, 0.55, 0.018),
            (415.0, 0.35, 0.011),
            (690.0, 0.18, 0.007),
        ],
        pitch_drop_hz=24.0,
        pitch_drop_tau=0.010,
    )
    grit = fft_bandpass(pink_noise(n, rng), 350.0, 2100.0)
    grit *= adsr_env(n, attack_s=0.0015, decay_s=0.038, curve=2.8)

    out = 0.82 * masonry + 0.35 * grit
    out = apply_early_reflections(out, [(2.9, 0.22), (7.1, -0.14), (13.5, 0.08)])
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_signal_collect() -> np.ndarray:
    """
    Warm ink-drop marimba/kalimba double-note 'plim' (`signal_collect`).
    Distinctly non-Nintendo contour: a warm Brazilian kalimba/marimba syncopated
    falling-then-blooming sixth interval (A5 -> F#5 with D5 resonance + subtle ink-drop bubble),
    completely unlike the B5->E6 coin fourth.
    """
    rng = make_rng(5024)
    dur = 0.42
    n = int(dur * SR)
    out = np.zeros(n, dtype=np.float64)

    # 1. Tactile ink-drop water/paper droplet transient at t=0.003s (upward formant chirp 380->680 Hz)
    drop_n = int(0.045 * SR)
    t_d = np.arange(drop_n, dtype=np.float64) / SR
    f_chirp = 380.0 + 320.0 * (t_d / 0.045) ** 1.5
    droplet = np.sin(2.0 * math.pi * np.cumsum(f_chirp) / SR) * adsr_env(
        drop_n, attack_s=0.002, decay_s=0.035, curve=2.2
    )
    mix_at(out, droplet, 0.002, 0.32)

    # 2. Note 1 (t=0.005s): Kalimba/Marimba tine at A5 (880.0 Hz) + D5 warm body (587.33 Hz)
    # 3. Note 2 (t=0.068s): Warm resolution to F#5 (739.99 Hz) + D6 harmonic shimmer (1174.66 Hz)
    notes = [
        (0.004, 880.00, 587.33, 0.72),
        (0.068, 739.99, 1174.66, 0.85),
    ]
    for t0, f_main, f_partner, gain in notes:
        nn = int(0.32 * SR)
        # Kalimba tine + rosewood resonator box: fundamental + 2.92x clang tine mode (fast decay)
        tine = modal_bank(
            nn,
            [
                (f_main * 0.5, 0.25, 0.14),     # wooden gourd sub-octave warmth
                (f_main, 1.00, 0.135),          # primary kalimba/marimba tone
                (f_partner, 0.42, 0.120),       # harmonic partner voice
                (f_main * 2.0, 0.24, 0.075),    # 2nd harmonic
                (f_main * 2.92, 0.30, 0.018),   # metallic tine attack transient
                (f_main * 4.85, 0.12, 0.007),   # thumb pluck sparkle
            ],
        )
        # Subtle wooden mallet noise attack
        mallet = fft_bandpass(pink_noise(nn, rng), 1200.0, 5500.0) * adsr_env(
            nn, attack_s=0.0008, decay_s=0.010, curve=3.2
        )
        mix_at(out, tine + 0.16 * mallet, t0, gain)

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.0)


def synth_card_open() -> np.ndarray:
    """
    Crisp pop-up book paper unfold + soft brush (`card_open`).
    """
    rng = make_rng(5025)
    dur = 0.38
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float64) / SR
    out = np.zeros(n, dtype=np.float64)

    # 1. Initial cardstock release flick
    flick_n = int(0.06 * SR)
    flick = fft_bandpass(white_noise(flick_n, rng), 1400.0, 6500.0) * adsr_env(
        flick_n, attack_s=0.002, decay_s=0.035, curve=2.6
    )
    flick += 0.4 * modal_bank(flick_n, [(310.0, 0.7, 0.016), (620.0, 0.5, 0.011)])
    mix_at(out, flick, 0.005, 0.65)

    # 2. Pop-up page slide & unfold brush (upward spectral contour 600 -> 4200 Hz)
    raw = pink_noise(n, rng)
    b_low = fft_bandpass(raw, 450.0, 1600.0)
    b_mid = fft_bandpass(raw, 1200.0, 3600.0)
    b_hi = fft_bandpass(raw, 2800.0, 7200.0)
    env_low = np.exp(-((t - 0.065) / 0.055) ** 2)
    env_mid = np.exp(-((t - 0.130) / 0.070) ** 2)
    env_hi = np.exp(-((t - 0.200) / 0.075) ** 2)
    slide = 0.55 * b_low * env_low + 0.75 * b_mid * env_mid + 0.60 * b_hi * env_hi
    out += 0.75 * slide

    # 3. Soft taut pop-up lock settle at t=0.22s
    lock_n = int(0.12 * SR)
    lock = modal_bank(
        lock_n,
        [(220.0, 0.55, 0.025), (440.0, 0.40, 0.020), (659.25, 0.25, 0.018)],
        pitch_drop_hz=15.0,
    )
    mix_at(out, lock, 0.215, 0.42)

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.2)


def synth_card_close() -> np.ndarray:
    """
    Gentle paper fold shut (`card_close`).
    """
    rng = make_rng(5026)
    dur = 0.30
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float64) / SR
    out = np.zeros(n, dtype=np.float64)

    # 1. Downward paper fold brush (4000 -> 500 Hz)
    raw = pink_noise(n, rng)
    b_hi = fft_bandpass(raw, 2200.0, 6200.0)
    b_mid = fft_bandpass(raw, 900.0, 2800.0)
    b_low = fft_bandpass(raw, 350.0, 1200.0)
    slide = (
        0.55 * b_hi * np.exp(-((t - 0.045) / 0.045) ** 2)
        + 0.70 * b_mid * np.exp(-((t - 0.095) / 0.055) ** 2)
        + 0.60 * b_low * np.exp(-((t - 0.145) / 0.050) ** 2)
    )
    out += 0.70 * slide

    # 2. Gentle book cover shut pat at t=0.145s
    shut_n = int(0.14 * SR)
    shut = modal_bank(
        shut_n,
        [(135.0, 0.85, 0.032), (245.0, 0.55, 0.022), (420.0, 0.30, 0.014)],
        pitch_drop_hz=22.0,
    )
    pat = fft_bandpass(pink_noise(shut_n, rng), 600.0, 3200.0) * adsr_env(
        shut_n, attack_s=0.0015, decay_s=0.032, curve=2.6
    )
    mix_at(out, shut + 0.38 * pat, 0.140, 0.78)

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.2)


def synth_grind_loop() -> np.ndarray:
    """
    Seamless 2.0 s tonal paper-ribbon slide + warm harmonic hum (`grind_loop`)
    whose playback `rate` scales with speed in T2.24b.
    Designed with integer-cycle harmonic frequencies over 2.0 s + crossfaded filtered
    paper-friction texture so looping has zero click.
    """
    rng = make_rng(5027)
    loop_dur = 2.0
    cf_dur = 0.4
    total_n = int((loop_dur + cf_dur) * SR)
    loop_n = int(loop_dur * SR)

    # 1. Continuous paper-ribbon friction texture (seamless via crossfade)
    raw_noise = pink_noise(total_n, rng)
    slide_mid = fft_bandpass(raw_noise, 550.0, 2400.0)
    slide_air = fft_bandpass(raw_noise, 2200.0, 5800.0)
    t_total = np.arange(total_n, dtype=np.float64) / SR
    # Smooth rhythmic ribbon weave modulation (3.0 Hz -> exactly 6 cycles in 2.0 s)
    weave = 0.72 + 0.28 * np.sin(2.0 * math.pi * 3.0 * t_total)
    shimmer = 0.75 + 0.25 * np.cos(2.0 * math.pi * 6.0 * t_total + 0.8)
    friction_raw = (0.65 * slide_mid * weave + 0.38 * slide_air * shimmer)
    friction = make_seamless_loop(friction_raw, crossfade_s=cf_dur)

    # 2. Exact integer-cycle warm harmonic hum in D Mixolydian (D3=147 Hz -> 294 cycles in 2.0 s,
    #    A3=220.5 Hz -> 441 cycles, D4=294 Hz -> 588 cycles, F#4=370 Hz -> 740 cycles, A4=441 Hz -> 882 cycles)
    t = np.arange(loop_n, dtype=np.float64) / SR
    hum = (
        0.38 * np.sin(2.0 * math.pi * 147.0 * t)
        + 0.30 * np.sin(2.0 * math.pi * 220.5 * t + 0.7)
        + 0.26 * np.sin(2.0 * math.pi * 294.0 * t + 1.4)
        + 0.14 * np.sin(2.0 * math.pi * 370.0 * t + 2.1) * (0.8 + 0.2 * np.sin(2.0 * math.pi * 2.0 * t))
        + 0.11 * np.sin(2.0 * math.pi * 441.0 * t + 0.3) * (0.8 + 0.2 * np.cos(2.0 * math.pi * 3.0 * t))
    )

    out = 0.56 * friction + 0.44 * hum
    return normalize_signal(out, target_peak_dbfs=-5.0, seamless=True)


def synth_line_pluck(variation: int) -> np.ndarray:
    """
    3 tuned acoustic nylon-guitar / viola-caipira + gentle sanfona reed harmonic plucks
    in Baião D Mixolydian scale for passing milestones on the Line:
      - variation 1 (`line_pluck_01`): D major tonic voicing (D4 293.66 Hz, F#4 369.99 Hz, A4 440.00 Hz)
      - variation 2 (`line_pluck_02`): G major subdominant Baião voicing (G4 392.00 Hz, B4 493.88 Hz, D5 587.33 Hz)
      - variation 3 (`line_pluck_03`): Cadd9 / D7 Mixolydian cadence voicing (C5 523.25 Hz, F#4 369.99 Hz, A4 440.00 Hz, D5 587.33 Hz)
    """
    dur = 0.56
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float64) / SR
    out = np.zeros(n, dtype=np.float64)

    voicings = {
        1: [(293.66, 0.000, 0.90), (369.99, 0.018, 0.78), (440.00, 0.035, 0.85)],
        2: [(392.00, 0.000, 0.88), (493.88, 0.018, 0.78), (587.33, 0.036, 0.86)],
        3: [(369.99, 0.000, 0.75), (440.00, 0.015, 0.80), (523.25, 0.030, 0.85), (587.33, 0.046, 0.92)],
    }[variation]

    for idx, (freq, strum_delay, gain) in enumerate(voicings):
        sn = n - int(strum_delay * SR)
        if sn <= 0:
            continue
        # Viola caipira paired courses (slight +1.8 cent natural chorus detune on octave/unison pair)
        s_main = karplus_strong(
            sn,
            freq_hz=freq,
            damping=0.9945,
            brightness=0.62,
            pluck_pos=0.27 + 0.03 * idx,
            seed=6000 + variation * 31 + idx * 7,
        )
        s_pair = karplus_strong(
            sn,
            freq_hz=freq * 1.0011,
            damping=0.9935,
            brightness=0.55,
            pluck_pos=0.31,
            seed=6100 + variation * 31 + idx * 7,
        )
        string_voice = 0.65 * s_main + 0.35 * s_pair
        string_voice *= adsr_env(sn, attack_s=0.002, decay_s=0.45, curve=1.8)
        mix_at(out, string_voice, strum_delay, gain)

    # Warm sanfona (accordion) reed breath swell underneath the pluck
    root_f = voicings[0][0]
    fifth_f = voicings[-1][0]
    reed_env = adsr_env(n, attack_s=0.035, decay_s=0.38, curve=1.7)
    reed = (
        0.14 * np.sin(2.0 * math.pi * root_f * t)
        + 0.10 * np.sin(2.0 * math.pi * (root_f * 1.0022) * t + 0.4)  # accordion musette beating
        + 0.09 * np.sin(2.0 * math.pi * fifth_f * t + 1.1)
    ) * reed_env
    out += reed

    out = apply_early_reflections(out)
    return normalize_signal(out, target_peak_dbfs=-3.0, fade_out_ms=25.0)


# ---------------------------------------------------------------------------
# 2. Era 1 "Origens" Ambiences (2 files in static/sounds/origens/)
# ---------------------------------------------------------------------------

def synth_amb_cerrado_dawn() -> np.ndarray:
    """
    `amb_cerrado_dawn.mp3` (~12.5 s seamless loop):
    - Warm morning breeze through buriti palm fronds (slowly modulated pink/brown noise)
    - Gentle rhythmic cerrado cicada/cricket chorus (high-frequency pulsed stridulation 3.6-6.2 kHz)
    - Soft distant morning bird calls (seriema / bem-te-vi / sabia inspired organic woodwind chirps)
    - Warm introductory sanfona/zabumba sunrise breath (subtle D Mixolydian accordion pad + soft distant zabumba heartbeat)
    Target loudness: ~ -20 LUFS, true peak <= -2.0 dBTP.
    """
    rng = make_rng(7001)
    loop_dur = 12.5
    cf_dur = 1.5
    total_dur = loop_dur + cf_dur
    total_n = int(round(total_dur * SR))

    raw = np.zeros(total_n, dtype=np.float64)
    t = np.arange(total_n, dtype=np.float64) / SR

    # 1. Warm morning breeze through buriti palms
    breeze_base = fft_bandpass(brown_noise(total_n, rng), 85.0, 520.0)
    fronds_mid = fft_bandpass(pink_noise(total_n, rng), 380.0, 1650.0)
    fronds_rustle = fft_bandpass(pink_noise(total_n, rng), 1500.0, 4200.0)

    gust1 = 0.55 + 0.45 * np.sin(2.0 * math.pi * (t / loop_dur) * 2.0 + 0.3)
    gust2 = 0.60 + 0.40 * np.cos(2.0 * math.pi * (t / loop_dur) * 3.0 - 0.8)
    raw += 0.42 * breeze_base * gust1 + 0.36 * fronds_mid * gust2 + 0.16 * fronds_rustle * (gust1 * gust2)

    # 2. Gentle rhythmic cerrado cicada & dawn cricket chorus
    cicada_carrier = fft_bandpass(white_noise(total_n, rng), 3700.0, 5900.0)
    # Double-pulsed stridulation rhythm (~16 Hz pulse train inside slow 0.4 Hz phrases)
    strid_fast = 0.55 + 0.45 * np.sin(2.0 * math.pi * 16.0 * t)
    strid_phrase = np.maximum(0.15, np.sin(2.0 * math.pi * (t / loop_dur) * 4.0) ** 2)
    raw += 0.11 * cicada_carrier * strid_fast * strid_phrase

    # Soft tonal tree-cricket trill at 2850 Hz & 2862 Hz (distant, warm)
    for t_trill in [0.9, 4.1, 7.6, 10.8]:
        tn = int(1.6 * SR)
        tt = np.arange(tn, dtype=np.float64) / SR
        pulse = 0.5 + 0.5 * np.sin(2.0 * math.pi * 24.0 * tt)
        cricket = (
            np.sin(2.0 * math.pi * 2780.0 * tt) + 0.4 * np.sin(2.0 * math.pi * 2794.0 * tt)
        ) * pulse * adsr_env(tn, attack_s=0.25, decay_s=1.1, sustain_level=0.3, release_s=0.25, curve=1.5)
        mix_at(raw, cricket, t_trill, 0.045)

    # 3. Soft distant morning bird calls of the Tocantins cerrado
    #    (organic two- and three-syllable whistle glides with natural room reflections)
    bird_events = [
        # (time_s, [(f_start, f_end, dur_s, gap_s), ...], gain)
        (1.65, [(1320.0, 1480.0, 0.11, 0.13), (1560.0, 1760.0, 0.14, 0.16), (1680.0, 1240.0, 0.28, 0.0)], 0.13),
        (5.20, [(1760.0, 1980.0, 0.12, 0.14), (1640.0, 1380.0, 0.24, 0.0)], 0.11),
        (8.45, [(1180.0, 1420.0, 0.13, 0.15), (1480.0, 1660.0, 0.13, 0.15), (1520.0, 1175.0, 0.26, 0.0)], 0.12),
        (11.15, [(1920.0, 1680.0, 0.14, 0.16), (1740.0, 1480.0, 0.22, 0.0)], 0.10),
    ]
    for t_bird, syllables, b_gain in bird_events:
        cursor = t_bird
        for f0, f1, s_dur, gap in syllables:
            sn = int(s_dur * SR)
            st = np.arange(sn, dtype=np.float64) / SR
            # Smooth S-curve frequency trajectory + subtle vibrato
            prog = 0.5 - 0.5 * np.cos(math.pi * st / s_dur)
            f_inst = f0 + (f1 - f0) * prog + 14.0 * np.sin(2.0 * math.pi * 22.0 * st)
            phase = 2.0 * math.pi * np.cumsum(f_inst) / SR
            call = (np.sin(phase) + 0.22 * np.sin(2.0 * phase)) * adsr_env(
                sn, attack_s=0.018, decay_s=s_dur * 0.78, curve=1.8
            )
            call = apply_early_reflections(
                call,
                [(18.0, 0.35), (42.0, 0.22), (79.0, 0.14)],
            )
            mix_at(raw, call, cursor, b_gain)
            cursor += gap

    # 4. Warm introductory sanfona (accordion) sunrise breath + soft distant zabumba pulse
    #    Two gentle breathing D Mixolydian chord swells across the 12.5 s loop (D3, A3, D4, F#4, A4)
    chord_freqs = [146.83, 220.00, 293.66, 369.99, 440.00]
    chord_amps = [0.24, 0.22, 0.20, 0.14, 0.12]
    sanfona = np.zeros(total_n, dtype=np.float64)
    for f_c, a_c in zip(chord_freqs, chord_amps):
        # Dual-reed accordion warmth (slight +0.35 Hz musette detune + soft 2nd harmonic)
        sanfona += a_c * (
            0.65 * np.sin(2.0 * math.pi * f_c * t)
            + 0.25 * np.sin(2.0 * math.pi * (f_c + 0.32) * t + 0.6)
            + 0.10 * np.sin(2.0 * math.pi * (2.0 * f_c) * t + 1.2)
        )
    breath_env = 0.45 + 0.55 * (np.sin(2.0 * math.pi * (t / loop_dur) * 2.0 - 0.5 * math.pi) ** 2)
    raw += 0.16 * sanfona * breath_env

    # Subtle distant zabumba low heartbeat double-thump (Baião cell) twice per loop
    for z_t in [2.8, 3.18, 9.05, 9.43]:
        zn = int(0.28 * SR)
        zab = modal_bank(
            zn,
            [(65.0, 1.0, 0.065), (118.0, 0.45, 0.038)],
            pitch_drop_hz=22.0,
            pitch_drop_tau=0.018,
        )
        mix_at(raw, zab, z_t, 0.14)

    looped = make_seamless_loop(raw, crossfade_s=cf_dur)
    return normalize_lufs_signal(looped, target_lufs_approx=-20.0, max_peak_dbfs=-3.2, seamless=True)


def synth_amb_rio_tocantins() -> np.ndarray:
    """
    `amb_rio_tocantins.mp3` (~11.0 s seamless loop):
    - Gentle flowing river water lapping over laterite stones (multi-band modulated current + shore wavelets)
    - Organic water droplets / stone eddies (resonant hydrodynamic bubble plops 320-1150 Hz)
    - Light reed breeze along the south riverbank
    Target loudness: ~ -21 LUFS, true peak <= -2.0 dBTP.
    """
    rng = make_rng(7002)
    loop_dur = 11.0
    cf_dur = 1.5
    total_dur = loop_dur + cf_dur
    total_n = int(round(total_dur * SR))

    raw = np.zeros(total_n, dtype=np.float64)
    t = np.arange(total_n, dtype=np.float64) / SR

    # 1. Deep river current + mid-band stone flow
    current_low = fft_bandpass(brown_noise(total_n, rng), 75.0, 380.0)
    current_mid = fft_bandpass(pink_noise(total_n, rng), 320.0, 1450.0)
    lapping_hi = fft_bandpass(pink_noise(total_n, rng), 1200.0, 3900.0)

    # Periodic shore wavelet lapping (3 gentle waves across the 11.0 s loop)
    wave1 = 0.50 + 0.50 * np.sin(2.0 * math.pi * (t / loop_dur) * 3.0)
    wave2 = 0.55 + 0.45 * np.cos(2.0 * math.pi * (t / loop_dur) * 5.0 + 0.9)
    ripple = 0.60 + 0.40 * np.sin(2.0 * math.pi * (t / loop_dur) * 11.0 + 0.4)

    raw += (
        0.46 * current_low * wave1
        + 0.44 * current_mid * wave2
        + 0.25 * lapping_hi * (wave1 * ripple)
    )

    # 2. Hydrodynamic Minnaert bubble/eddy droplets lapping over submerged laterite pebbles
    n_droplets = 48
    for _ in range(n_droplets):
        t0 = rng.uniform(0.05, total_dur - 0.15)
        dn = int(rng.uniform(0.025, 0.055) * SR)
        dt = np.arange(dn, dtype=np.float64) / SR
        f_base = rng.uniform(340.0, 1080.0)
        # Characteristic upward pitch bend of an acoustic water bubble (f_base -> 1.38 * f_base)
        f_inst = f_base * (1.0 + 0.38 * (dt / (dn / SR)) ** 1.4)
        bubble = np.sin(2.0 * math.pi * np.cumsum(f_inst) / SR) * adsr_env(
            dn, attack_s=0.002, decay_s=(dn / SR) * 0.85, curve=2.3
        )
        # Splash micro-noise
        splash = fft_bandpass(pink_noise(dn, rng), f_base * 0.8, min(SR * 0.45, f_base * 2.6))
        splash *= adsr_env(dn, attack_s=0.003, decay_s=(dn / SR) * 0.75, curve=2.5)
        mix_at(raw, 0.72 * bubble + 0.28 * splash, t0, rng.uniform(0.05, 0.13))

    # 3. Light reed breeze along the riverbank
    reed_breeze = fft_bandpass(pink_noise(total_n, rng), 650.0, 2600.0)
    breeze_env = 0.50 + 0.50 * np.sin(2.0 * math.pi * (t / loop_dur) * 2.0 + 1.2)
    raw += 0.22 * reed_breeze * breeze_env

    looped = make_seamless_loop(raw, crossfade_s=cf_dur)
    return normalize_lufs_signal(looped, target_lufs_approx=-21.0, max_peak_dbfs=-3.5, seamless=True)


# ---------------------------------------------------------------------------
# Asset Registry & Metadata
# ---------------------------------------------------------------------------

@dataclass
class AudioSpec:
    rel_path: str
    category: str
    recipe_desc: str
    bitrate_kbps: int
    builder: Callable[[], np.ndarray]


def get_audio_specs() -> list[AudioSpec]:
    specs: list[AudioSpec] = []

    # 1-4: step_laterite_01..04
    for i in range(1, 5):
        specs.append(
            AudioSpec(
                rel_path=f"common/step_laterite_0{i}.mp3",
                category="common / Locomoção (Terra Laterita)",
                recipe_desc=f"Síntese modal de impacto de sola em laterita + cluster granular de cascalho (var. {i}, seed {1000 + i * 73})",
                bitrate_kbps=64,
                builder=lambda v=i: synth_step_laterite(v),
            )
        )

    # 5-8: step_grass_01..04
    for i in range(1, 5):
        specs.append(
            AudioSpec(
                rel_path=f"common/step_grass_0{i}.mp3",
                category="common / Locomoção (Capim do Cerrado)",
                recipe_desc=f"Fricção fibrosa multi-banda de capim seco + impacto macio de solo (var. {i}, seed {2000 + i * 89})",
                bitrate_kbps=64,
                builder=lambda v=i: synth_step_grass(v),
            )
        )

    # 9-11: step_wood_01..03
    for i in range(1, 4):
        specs.append(
            AudioSpec(
                rel_path=f"common/step_wood_0{i}.mp3",
                category="common / Locomoção (Madeira)",
                recipe_desc=f"Banco modal ortotrópico de tábua oca (f0={148 + i * 14} Hz) + toque de ponta (var. {i})",
                bitrate_kbps=64,
                builder=lambda v=i: synth_step_wood(v),
            )
        )

    # 12-14: step_stone_01..03
    for i in range(1, 4):
        specs.append(
            AudioSpec(
                rel_path=f"common/step_stone_0{i}.mp3",
                category="common / Locomoção (Pedra/Lajota)",
                recipe_desc=f"Transiente mineral de alta densidade + modos de laje rígida (f0={185 + i * 19} Hz, var. {i})",
                bitrate_kbps=64,
                builder=lambda v=i: synth_step_stone(v),
            )
        )

    # 15-27: core character & world interactions
    specs.extend([
        AudioSpec(
            rel_path="common/jump_launch.mp3",
            category="common / Locomoção (Pulo)",
            recipe_desc="Impulso de solo + whoosh formântico de tecido + nota dupla de marimba de madeira (D4->A4)",
            bitrate_kbps=64,
            builder=synth_jump_launch,
        ),
        AudioSpec(
            rel_path="common/flutter_ribbon.mp3",
            category="common / Locomoção (Planada Fita)",
            recipe_desc="Estalo de fita de papel tensionada + batimento aerodinâmico a 13.5 Hz + harmônicos de palheta",
            bitrate_kbps=64,
            builder=synth_flutter_ribbon,
        ),
        AudioSpec(
            rel_path="common/land_soft.mp3",
            category="common / Locomoção (Pouso Leve)",
            recipe_desc="Impacto duplo amortecido de sola na terra (96/114 Hz) + acomodação de tecido",
            bitrate_kbps=64,
            builder=synth_land_soft,
        ),
        AudioSpec(
            rel_path="common/land_hard.mp3",
            category="common / Locomoção (Pouso Forte)",
            recipe_desc="Transiente duplo grave (74/88 Hz) + dispersão granular de cascalho e sopro de poeira",
            bitrate_kbps=64,
            builder=synth_land_hard,
        ),
        AudioSpec(
            rel_path="common/skid_dust.mp3",
            category="common / Locomoção (Derrapagem)",
            recipe_desc="Arrasto desacelerado de sola em terra vermelha + micro-grãos de laterita",
            bitrate_kbps=64,
            builder=synth_skid_dust,
        ),
        AudioSpec(
            rel_path="common/stamp_lock.mp3",
            category="common / Interação (Carimbo Armar)",
            recipe_desc="Duplo clique mecânico de madeira/latão + tensão stick-slip de papel cartão",
            bitrate_kbps=64,
            builder=synth_stamp_lock,
        ),
        AudioSpec(
            rel_path="common/stamp_impact.mp3",
            category="common / Interação (Carimbo Impacto)",
            recipe_desc="Impacto grave de borracha/madeira em mesa (68/132 Hz) + sucção de tinta + rebote de mola",
            bitrate_kbps=64,
            builder=synth_stamp_impact,
        ),
        AudioSpec(
            rel_path="common/block_bump.mp3",
            category="common / Interação (Bloco de Marco)",
            recipe_desc="Batida oca em caixa de papel/madeira + acorde modal de marimba em D Mixolídio (D4-A4-F#5)",
            bitrate_kbps=64,
            builder=synth_block_bump,
        ),
        AudioSpec(
            rel_path="common/block_solid.mp3",
            category="common / Interação (Bloco Sólido)",
            recipe_desc="Impacto inelástico curto em alvenaria/tijolo (modos não-harmônicos 105-690 Hz)",
            bitrate_kbps=64,
            builder=synth_block_solid,
        ),
        AudioSpec(
            rel_path="common/signal_collect.mp3",
            category="common / Interação (Sinal Colecionável)",
            recipe_desc="Gota de tinta + nota dupla sincopada de kalimba/marimba (A5->F#5 com corpo em D5, contorno original)",
            bitrate_kbps=64,
            builder=synth_signal_collect,
        ),
        AudioSpec(
            rel_path="common/card_open.mp3",
            category="common / UI & Livro Pop-up (Abrir Card)",
            recipe_desc="Desdobrar de papel cartão pop-up (varredura ascendente 450->7200 Hz) + trava suave",
            bitrate_kbps=64,
            builder=synth_card_open,
        ),
        AudioSpec(
            rel_path="common/card_close.mp3",
            category="common / UI & Livro Pop-up (Fechar Card)",
            recipe_desc="Dobra descendente de folha de papel + fechamento macio de capa (135/245 Hz)",
            bitrate_kbps=64,
            builder=synth_card_close,
        ),
        AudioSpec(
            rel_path="common/grind_loop.mp3",
            category="common / Locomoção (Grind na Linha)",
            recipe_desc="Loop seamless 2.0 s de deslizamento em fita de papel + bordão harmônico em D Mixolídio",
            bitrate_kbps=64,
            builder=synth_grind_loop,
        ),
    ])

    # 28-30: line_pluck_01..03
    pluck_notes = {
        1: "D4-F#4-A4 (Tônica D Mixolídio)",
        2: "G4-B4-D5 (Subdominante Baião)",
        3: "F#4-A4-C5-D5 (Cadência Sétima Mixolídia)",
    }
    for i in range(1, 4):
        specs.append(
            AudioSpec(
                rel_path=f"common/line_pluck_0{i}.mp3",
                category="common / Linha Musical (Marco)",
                recipe_desc=f"Dedilhado Karplus-Strong de viola caipira/violão nylon + sopro de sanfona: {pluck_notes[i]}",
                bitrate_kbps=64,
                builder=lambda v=i: synth_line_pluck(v),
            )
        )

    # Origens ambiences (2 files)
    specs.extend([
        AudioSpec(
            rel_path="origens/amb_cerrado_dawn.mp3",
            category="origens / Ambiência (Amanhecer no Cerrado)",
            recipe_desc="Loop seamless 12.5 s: brisa em buritis + coro de cigarras + pássaros do cerrado + respiração de sanfona/zabumba (-20 LUFS)",
            bitrate_kbps=64,
            builder=synth_amb_cerrado_dawn,
        ),
        AudioSpec(
            rel_path="origens/amb_rio_tocantins.mp3",
            category="origens / Ambiência (Margem Rio Tocantins)",
            recipe_desc="Loop seamless 11.0 s: correnteza e marolas em pedras de laterita + bolhas hidrodinâmicas + brisa nos juncos (-21 LUFS)",
            bitrate_kbps=64,
            builder=synth_amb_rio_tocantins,
        ),
    ])

    return specs


# ---------------------------------------------------------------------------
# Encoding & EBU R128 Loudness Measurement via FFmpeg
# ---------------------------------------------------------------------------

def write_wav_int16(path: Path, samples: np.ndarray) -> None:
    clipped = np.clip(samples, -0.9999, 0.9999)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())


def encode_mp3(wav_path: Path, mp3_path: Path, bitrate_kbps: int) -> None:
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(wav_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(SR),
        "-c:a",
        "libmp3lame",
        "-b:a",
        f"{bitrate_kbps}k",
        "-write_xing",
        "0",
        "-id3v2_version",
        "0",
        str(mp3_path),
    ]
    subprocess.run(cmd, check=True)


def measure_ebur128(mp3_path: Path, orig_dur_s: float) -> tuple[float, float]:
    """
    Runs `ffmpeg -i <file> -af ebur128=peak=true -f null -` and extracts
    Integrated Loudness (I, LUFS) and True Peak (TP, dBTP).
    For short SFX (< 1.5 s) where gated EBU R128 400ms blocks return -70 LUFS,
    loops the input seamlessly for 3.0 s so the EBU R128 gate integrates the active event,
    while measuring true peak directly on the file.
    """
    # 1. Direct measurement on the file
    cmd_direct = [
        "ffmpeg",
        "-hide_banner",
        "-i",
        str(mp3_path),
        "-af",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
    ]
    proc = subprocess.run(cmd_direct, capture_output=True, text=True, check=True)
    stderr = proc.stderr

    i_matches = re.findall(r"I:\s*([-\d.]+)\s*LUFS", stderr)
    tp_matches = re.findall(r"Peak:\s*([-\d.]+)\s*dBFS", stderr)
    i_lufs = float(i_matches[-1]) if i_matches else -70.0
    tp_dbtp = float(tp_matches[-1]) if tp_matches else -99.0

    # If short SFX gated out (-70.0 LUFS), measure gated loudness over 3s looped window
    if i_lufs <= -65.0 or orig_dur_s < 1.2:
        cmd_loop = [
            "ffmpeg",
            "-hide_banner",
            "-stream_loop",
            "16",
            "-t",
            "2.5",
            "-i",
            str(mp3_path),
            "-af",
            "ebur128=peak=true",
            "-f",
            "null",
            "-",
        ]
        proc_loop = subprocess.run(cmd_loop, capture_output=True, text=True, check=True)
        i_loop = re.findall(r"I:\s*([-\d.]+)\s*LUFS", proc_loop.stderr)
        if i_loop:
            i_lufs = float(i_loop[-1])

    return i_lufs, tp_dbtp


def generate_licenses_markdown(rows: list[dict]) -> str:
    common_bytes = sum(r["bytes"] for r in rows if r["rel_path"].startswith("common/"))
    origens_bytes = sum(r["bytes"] for r in rows if r["rel_path"].startswith("origens/"))
    total_bytes = common_bytes + origens_bytes

    common_kb = common_bytes / 1024.0
    origens_kb = origens_bytes / 1024.0
    total_kb = total_bytes / 1024.0
    max_tp = max(r["tp_dbtp"] for r in rows)

    lines = [
        "# LICENSES-AUDIO — Inventário, Proveniência e Loudness de Áudio (Fase 2F: T2.22 & T2.23)",
        "",
        "Este documento registra a proveniência, autoria, licença, receita acústica, duração, tamanho em bytes/KB e medição EBU R128 (`ffmpeg -af ebur128=peak=true`) de todos os **32 arquivos de áudio** da fatia vertical (**30 SFX comuns** em `static/sounds/common/` + **2 ambiências de Origens** em `static/sounds/origens/`).",
        "",
        "## 1. Política de Originalidade e Licenciamento (R8)",
        "",
        "- **100% First-Party Procedural / Foley Acústico Original:** Todos os 32 arquivos são gerados deterministicamente a partir de `game/scripts/build-audio.py` (sementes fixas de RNG, síntese modal multi-corpo, cordas dedilhadas Karplus-Strong, ruído rosa/marrom filtrado por formantes, convolução de reflexões iniciais e harmonias em Ré Mixolídio / Baião).",
        "- **Zero bytes de terceiros:** Nenhum arquivo, amostra ou contorno melódico provém de repositórios de referência ou de jogos comerciais.",
        "- **Licença de distribuição:** `CC0-1.0 OR MIT` — autoria original de **Victor Neves (`voaneves`)**, verificável e reproduzível localmente via `python scripts/build-audio.py`.",
        "- **Nota sobre Música (Decisão D4 — PLAN-3D §9.2):** Conforme a seção 9.2 (D4) e T2.22 do plano, os stems de música de fundo permanecem omitidos na fatia vertical até decisão formal D4 do proprietário (sendo excluídos da pontuação de música do Gate G2 enquanto D4 estiver em padrão sem música). A camada harmônica diegética já está presente na respiração de sanfona de `amb_cerrado_dawn.mp3`, no bordão de `grind_loop.mp3` e nos 3 dedilhados `line_pluck_01..03.mp3` afinados em Ré Mixolídio.",
        "",
        "## 2. Resumo de Orçamento e Normalização (Gate `check-size` / T2.23)",
        "",
        "| Lote / Pasta | Arquivos | Tamanho (Bytes) | Tamanho (KB) | Orçamento Alvo | Status |",
        "|---|---:|---:|---:|---:|---|",
        f"| `static/sounds/common/` (SFX Base) | 30 | {common_bytes:,} B | **{common_kb:.2f} KB** | ≤ 400.00 KB | PASS |",
        f"| `static/sounds/origens/` (Ambiências Era 1) | 2 | {origens_bytes:,} B | **{origens_kb:.2f} KB** | ≤ 350.00 KB | PASS |",
        f"| **Total Combinado (`audio` budget)** | **32** | **{total_bytes:,} B** | **{total_kb:.2f} KB** | **≤ 750.00 KB** | **PASS** |",
        "",
        f"- **True Peak máximo medido (`ffmpeg -af ebur128=peak=true`):** `{max_tp:.2f} dBTP` (limite exigido: `≤ -1.0 dBTP`).",
        "- **Taxa de amostragem / formato:** MP3 (`libmp3lame`), 44.1 kHz, Mono, 64 kbps CBR sem cabeçalhos ID3/Xing supérfluos.",
        "",
        "## 3. Tabela Completa de Arquivos (30 SFX + 2 Ambiências)",
        "",
        "| # | Arquivo (`static/sounds/…`) | Categoria | Duração (s) | Tamanho (KB) | Loudness (LUFS / dBTP) | Autor / Fonte (URL / Script) | Licença |",
        "|---:|---|---|---:|---:|---|---|---|",
    ]

    for idx, r in enumerate(rows, start=1):
        kb_str = f"{r['bytes'] / 1024.0:.2f} KB ({r['bytes']} B)"
        loud_str = f"`{r['i_lufs']:.1f} LUFS` / `{r['tp_dbtp']:.2f} dBTP`"
        source_str = f"Victor Neves — `game/scripts/build-audio.py` ({r['recipe_desc']})"
        lines.append(
            f"| {idx} | `{r['rel_path']}` | {r['category']} | {r['dur_s']:.2f} s | {kb_str} | {loud_str} | {source_str} | CC0-1.0 / MIT |"
        )

    lines.extend([
        "",
        "## 4. Reprodução e Auditoria",
        "",
        "Para regerar todos os 32 arquivos e revalidar tamanhos e loudness EBU R128:",
        "",
        "```powershell",
        "python game/scripts/build-audio.py",
        "node game/scripts/audit-originality.mjs",
        "```",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    specs = get_audio_specs()
    assert len(specs) == 32, f"Expected 32 audio specs, got {len(specs)}"

    rows: list[dict] = []
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        for idx, spec in enumerate(specs, start=1):
            samples = spec.builder()
            dur_s = len(samples) / SR
            wav_file = tmp_path / f"item_{idx:02d}.wav"
            mp3_file = SOUNDS_DIR / spec.rel_path

            write_wav_int16(wav_file, samples)
            encode_mp3(wav_file, mp3_file, spec.bitrate_kbps)

            # Verify true peak; if MP3 quantization nudged peak > -1.2 dBTP, attenuate and re-encode
            i_lufs, tp_dbtp = measure_ebur128(mp3_file, dur_s)
            if tp_dbtp > -1.2:
                atten_db = (-1.8) - tp_dbtp
                samples = samples * (10.0 ** (atten_db / 20.0))
                write_wav_int16(wav_file, samples)
                encode_mp3(wav_file, mp3_file, spec.bitrate_kbps)
                i_lufs, tp_dbtp = measure_ebur128(mp3_file, dur_s)

            size_bytes = mp3_file.stat().st_size
            rows.append({
                "rel_path": spec.rel_path.replace("\\", "/"),
                "category": spec.category,
                "dur_s": dur_s,
                "bytes": size_bytes,
                "i_lufs": i_lufs,
                "tp_dbtp": tp_dbtp,
                "recipe_desc": spec.recipe_desc,
            })
            print(
                f"[{idx:02d}/32] {spec.rel_path:<32} "
                f"dur={dur_s:5.2f}s  size={size_bytes / 1024.0:6.2f} KB  "
                f"I={i_lufs:6.1f} LUFS  TP={tp_dbtp:6.2f} dBTP"
            )

    common_bytes = sum(r["bytes"] for r in rows if r["rel_path"].startswith("common/"))
    origens_bytes = sum(r["bytes"] for r in rows if r["rel_path"].startswith("origens/"))
    total_bytes = common_bytes + origens_bytes
    max_tp = max(r["tp_dbtp"] for r in rows)

    print("-" * 78)
    print(f"common/  (30 files): {common_bytes:7,d} B ({common_bytes / 1024.0:6.2f} KB) / 400.00 KB max")
    print(f"origens/ ( 2 files): {origens_bytes:7,d} B ({origens_bytes / 1024.0:6.2f} KB) / 350.00 KB max")
    print(f"TOTAL    (32 files): {total_bytes:7,d} B ({total_bytes / 1024.0:6.2f} KB) / 750.00 KB max")
    print(f"Max True Peak      : {max_tp:6.2f} dBTP (limit <= -1.00 dBTP)")

    assert common_bytes <= 400 * 1024, f"common/ exceeded 400 KB: {common_bytes}"
    assert origens_bytes <= 350 * 1024, f"origens/ exceeded 350 KB: {origens_bytes}"
    assert total_bytes <= 750 * 1024, f"total exceeded 750 KB: {total_bytes}"
    assert max_tp <= -1.0, f"True peak exceeded -1.0 dBTP: {max_tp}"

    md = generate_licenses_markdown(rows)
    LICENSES_AUDIO_PATH.write_text(md, encoding="utf-8", newline="\n")
    print(f"Wrote {LICENSES_AUDIO_PATH}")


if __name__ == "__main__":
    main()
