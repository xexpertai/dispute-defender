"""Original score for the story video: synthesised from code, dedicated to the public domain (CC0 1.0)
by its author (see docs/MUSIC_LICENSE.md). No samples, loops or third-party audio of any kind.

Warm and acoustic-leaning, to suit a ceramics studio: 96 BPM in D major / B minor. A plucked nylon
guitar (Karplus-Strong) fingerpicks the chords, a wooden kalimba carries the motif, a felt piano holds
the harmony, an upright-style bass walks under the product section, and brushes, a shaker and a soft
cajon keep time. The arrangement follows video/story.json's timeline: a sparse intro under the hook
and persona, a strum and a low hit on the logo reveal, a lift into the hero run, a warm hit on the
WON beat, a breakdown under the before/after, and a final hit on the closing line with a ring-out.

Usage (needs numpy, scipy, pedalboard; run through uv):
  uv run --python 3.12 --with numpy --with scipy --with pedalboard python scripts/video/score.py <out.wav> [from_s to_s]
"""
import json, pathlib, sys

import numpy as np
from pedalboard import Compressor, Delay, HighpassFilter, HighShelfFilter, Limiter, LowShelfFilter, Pedalboard, Reverb
from scipy.io import wavfile
from scipy.signal import butter, lfilter, sosfilt

ROOT = pathlib.Path(__file__).resolve().parents[2]
TL = json.load(open(ROOT / "video/story.json"))["timeline"]
SR = 48000
BEAT = 60 / TL["bpm"]
BAR = 4 * BEAT
END = TL["end"]
HIT = TL["hits"]
SEC = dict(TL["sections"])
N = int(END * SR) + SR
rng = np.random.default_rng(11)  # fixed seed: the same score every render


def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def at(t): return int(round(t * SR))
def stereo(): return np.zeros((2, N))
def lp(x, fc, o=2): return sosfilt(butter(o, fc, "low", fs=SR, output="sos"), x)
def hp(x, fc, o=2): return sosfilt(butter(o, fc, "high", fs=SR, output="sos"), x)
def bp(x, lo, hi, o=2): return sosfilt(butter(o, [lo, hi], "band", fs=SR, output="sos"), x)


def add(buf, sig, t, pan=0.0, gain=1.0):
    i = at(t)
    if i >= N or i < 0:
        return
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.vstack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
    n = min(sig.shape[1], N - i)
    buf[:, i:i + n] += gain * sig[:, :n]


def section(t):
    s = None
    for name, start in TL["sections"]:
        if t + 1e-6 >= start:
            s = name
    return s


# ---------------------------------------------------------------- instruments
def guitar(m, vel=1.0, dur=3.0, bright=0.5):
    """Karplus-Strong plucked nylon string: a filtered noise burst in a damped delay loop."""
    f = hz(m)
    L = SR / f
    Li = int(L)
    frac = L - Li
    n = int(dur * SR)
    burst = lp(rng.standard_normal(Li + 2), 1500 + 4500 * bright)
    out = np.zeros(n)
    out[:Li] = burst[:Li]
    loss = 0.996 - 0.004 * (m > 64)
    # The loop: y[k] = loss * ((1 - frac) * avg(y[k-L], y[k-L-1]) + frac * y[k-L-1]); computed one
    # period at a time (each block depends only on the previous one), so it stays fast in numpy.
    w0, w1 = loss * (1 - frac) * 0.5, loss * ((1 - frac) * 0.5 + frac)
    k = Li
    while k < n:
        e = min(n, k + Li)
        a = out[k - Li:e - Li]
        b = np.concatenate([[out[k - Li - 1]], out[k - Li:e - Li - 1]])
        out[k:e] += w0 * a + w1 * b
        k = e
    t = np.arange(n) / SR
    body = lp(out, 3200) * np.minimum(1, t / 0.002)
    return body * vel / (np.abs(body).max() + 1e-9) * 0.6


def kalimba(m, vel=1.0, dur=2.2):
    """Wooden tine: a sine with a short inharmonic 'clink' (5.4x) and a soft woody thump."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 2.4)
    x += 0.35 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 26)
    x += 0.12 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 5)
    x *= np.minimum(1, t / 0.0015)
    return x * vel * 0.5


def piano(m, vel=1.0, dur=3.0):
    """Felt piano: a few slightly stretched partials, soft hammer, gentle decay."""
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = np.zeros(n)
    for k, a in ((1, 1.0), (2, 0.42), (3, 0.18), (4, 0.08), (5, 0.04)):
        fk = f * k * (1 + 0.0004 * k * k)
        x += a * np.sin(2 * np.pi * fk * t) * np.exp(-t * (0.9 + 0.55 * k))
    rel = np.clip((dur - t) / 0.6 + 1, 0, 1)
    x *= np.minimum(1, t / 0.006) * rel
    return lp(x, 2400) * vel * 0.35


def upright(m, dur):
    """Plucked upright-style bass: a low guitar string, darker, with a round thump."""
    x = guitar(m, 1.0, dur + 0.4, bright=0.1)
    t = np.arange(len(x)) / SR
    x += 0.4 * np.sin(2 * np.pi * hz(m) * t) * np.exp(-t * 3.5)
    rel = np.clip((dur - t) / 0.12 + 1, 0, 1)
    return lp(x * rel, 420)


def cajon(vel=1.0):
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 62 + 70 * np.exp(-t * 30)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    slap = bp(rng.standard_normal(n), 300, 1400) * np.exp(-t * 60) * 0.35
    return np.tanh(1.3 * (body + slap)) * vel


def brush(vel=1.0, length=0.32):
    """A brushed-snare swish: band-passed noise with a slow attack."""
    n = int(length * SR)
    t = np.arange(n) / SR
    e = np.minimum(1, t / 0.05) * np.exp(-t * 9)
    return bp(rng.standard_normal(n), 1800, 7000) * e * 0.28 * vel


def tap(vel=1.0):
    """Brush tap on the backbeat."""
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    return bp(rng.standard_normal(n), 900, 5000) * np.exp(-t * 32) * 0.45 * vel


def shaker(vel=1.0):
    n = int(0.11 * SR)
    t = np.arange(n) / SR
    e = np.sin(np.pi * np.clip(t / 0.09, 0, 1)) ** 2
    return lp(hp(rng.standard_normal(n), 6000, 4), 11000) * e * 0.12 * vel


def low_hit(vel=1.0):
    """A floor-tom and timpani-like hit."""
    n = int(2.4 * SR)
    t = np.arange(n) / SR
    f = 52 + 38 * np.exp(-t * 7)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.8)
    x += bp(rng.standard_normal(n), 120, 900) * np.exp(-t * 22) * 0.4
    return np.tanh(1.4 * x) * vel


def swell(length):
    """A soft cymbal swell (reversed-decay noise) that ends exactly at its target."""
    n = int(length * SR)
    t = np.arange(n) / SR
    x = hp(rng.standard_normal(n), 4000, 2)
    return lp(x, 12000) * (t / length) ** 2.6 * 0.3


def cymbal(vel=1.0, length=3.5):
    n = int(length * SR)
    t = np.arange(n) / SR
    return lp(hp(rng.standard_normal(n), 3800, 2), 11000) * np.exp(-t * 1.7) * 0.28 * vel


# ---------------------------------------------------------------- harmony
# (bass midi, guitar voicing low->high, kalimba tones)
CH = {
    "Bm7":    (47, [47, 54, 57, 62, 66], [78, 81, 83, 86]),
    "Gmaj9":  (43, [43, 50, 54, 57, 62], [74, 78, 81, 83]),
    "D/F#":   (42, [42, 50, 54, 57, 62], [74, 78, 81, 86]),
    "Asus":   (45, [45, 52, 57, 62, 64], [76, 81, 83, 86]),
    "A":      (45, [45, 52, 57, 61, 64], [76, 81, 85, 88]),
    "D":      (50, [50, 57, 62, 66, 69], [74, 78, 81, 86]),
    "Gmaj7":  (43, [43, 50, 54, 59, 62], [74, 78, 79, 83]),
    "Em7":    (40, [40, 47, 50, 55, 59], [74, 76, 79, 83]),
}
INTRO = ["Bm7", "Bm7", "Gmaj9", "Gmaj9", "D/F#", "D/F#", "Asus", "Asus"]
LOOP = ["D", "Bm7", "Gmaj7", "A"]
BREAK = ["Gmaj7", "D/F#", "Em7", "Asus"]
LOGO_BAR = round(HIT["logo"] / BAR)
FINAL_BAR = round(HIT["final"] / BAR)
TOTAL_BARS = int(np.ceil(END / BAR))
SPLIT_BAR = round(SEC["split"] / BAR)
HOW_BAR = round(HIT["howLand"] / BAR)


def chord_at(b):
    if b < LOGO_BAR - 1:
        return INTRO[min(b, len(INTRO) - 1)]
    if b in (LOGO_BAR - 1, FINAL_BAR - 1, HOW_BAR - 1):
        return "Asus"
    if b >= FINAL_BAR:
        return "D"
    if SPLIT_BAR <= b < HOW_BAR - 1:
        return BREAK[(b - SPLIT_BAR) % 4]
    return LOOP[(b - LOGO_BAR) % 4]


GROOVE = {"board", "calls", "hero", "draft", "spanish", "second", "receives", "live", "fair", "vyz", "actions", "won", "mcp", "how"}
gtr, kal, pno, bass, drums, fx = (stereo() for _ in range(6))

# Guitar: fingerpicked 8ths (thumb on the bass, fingers on the top strings). Sparse in the intro.
PICK = [0, 3, 2, 4, 1, 3, 2, 4]
for b in range(TOTAL_BARS):
    t0, sec = b * BAR, section(b * BAR)
    v = CH[chord_at(b)][1]
    if b >= FINAL_BAR:
        continue
    if sec == "hook":  # a quiet, open pluck per half bar: tension under the dispute notice
        add(gtr, guitar(v[0], 0.6, 4.0, 0.25), t0 + 0.05, pan=-0.1)
        add(gtr, guitar(v[3 + b % 2], 0.38, 4.0, 0.25), t0 + 0.05 + 2 * BEAT, pan=0.2)
        continue
    sparse = sec in ("persona", "split", "insights", "lessons") or (sec == "turn" and b < LOGO_BAR)
    steps = [0, 2, 4, 6] if sparse else range(8)
    for k in steps:
        if b in (LOGO_BAR - 1, FINAL_BAR - 1, HOW_BAR - 1) and k >= 6:
            break
        idx = PICK[k]
        vel = (0.85 if k % 4 == 0 else 0.55) * (0.75 if sparse else 1.0)
        add(gtr, guitar(v[idx], vel, 2.4, 0.35 + 0.25 * (sec in GROOVE)), t0 + k * BEAT / 2 + rng.uniform(0, 0.008), pan=-0.35 + 0.18 * idx)

# Hook and persona: a low felt-piano chord per two bars, so the bed never drops out.
for b in range(0, LOGO_BAR - 1, 2):
    for i, m in enumerate(CH[chord_at(b)][1][1:4]):
        add(pno, piano(m, 0.45 - 0.08 * i, 2 * BAR - 0.1), b * BAR + i * 0.015, pan=-0.15 + 0.15 * i)

# Felt piano: whole-bar chords from the turn on (soft), fuller in the groove.
for b in range(TOTAL_BARS):
    t0, sec = b * BAR, section(b * BAR)
    if b < LOGO_BAR or b >= FINAL_BAR + 2:
        continue
    name = chord_at(b)
    g = 0.5 if sec in ("split", "insights", "lessons") else 0.75
    for i, m in enumerate(CH[name][1][1:]):
        add(pno, piano(m + 12, g * (0.9 - 0.08 * i), BAR * (2 if b >= FINAL_BAR else 1) - 0.05), t0 + i * 0.012, pan=-0.2 + 0.13 * i)

# Kalimba motif: a lifting four-note phrase in the persona and the breakdown; answers in the groove.
for b in range(TOTAL_BARS):
    t0, sec = b * BAR, section(b * BAR)
    tones = CH[chord_at(b)][2]
    if sec in ("persona", "split") or (sec == "turn" and b < LOGO_BAR):  # not under the insights line
        for k, (i, d) in enumerate(((0, 0), (1, 1), (2, 2), (3, 3.5))):
            add(kal, kalimba(tones[i], 0.8 - 0.1 * k), t0 + d * BEAT / 1.0 * 0.5 + (BEAT if k == 3 else 0), pan=0.3 - 0.2 * k)
    elif sec in GROOVE and b % 2 == 1 and b < FINAL_BAR - 1 and b != HOW_BAR - 1:
        for k, i in enumerate((3, 2, 0)):
            add(kal, kalimba(tones[i], 0.45), t0 + 2 * BEAT + k * BEAT / 2, pan=0.4 - 0.3 * k)

# Bass: on the root (and the fifth) in the groove.
for b in range(TOTAL_BARS):
    t0, sec = b * BAR, section(b * BAR)
    if LOGO_BAR <= b < FINAL_BAR - 1 and sec in GROOVE | {"turn"} and b != HOW_BAR - 1:
        r = CH[chord_at(b)][0]
        r = r - 12 if r > 45 else r
        add(bass, upright(r, 1.9 * BEAT), t0, gain=0.6)
        add(bass, upright(r + 7, 0.9 * BEAT), t0 + 2.5 * BEAT, gain=0.45)
        add(bass, upright(r, 0.9 * BEAT), t0 + 3 * BEAT, gain=0.4)

# Drums: cajon + brushes + shaker in the groove; brushes only in the breakdown.
for b in range(TOTAL_BARS):
    t0, sec = b * BAR, section(b * BAR)
    if b < LOGO_BAR or b >= FINAL_BAR - 1:
        continue
    if sec in GROOVE and b != HOW_BAR - 1:
        for k in (0, 2.5):
            add(drums, cajon(0.8), t0 + k * BEAT, gain=0.55)
        for k in (1, 3):
            add(drums, tap(0.8), t0 + k * BEAT, pan=0.1)
        for k in range(8):
            add(drums, shaker(0.9 if k % 2 else 0.5), t0 + k * BEAT / 2, pan=0.45)
    if sec in GROOVE or sec in ("split", "insights", "lessons"):
        for k in range(4):
            add(drums, brush(0.7 if sec in ("split", "insights", "lessons") else 0.5), t0 + k * BEAT - 0.06, pan=-0.3)

# Hits: a swell into each, a low hit and a full strum on each (bigger on the logo and the final line).
STRUM = lambda name, vel: [(guitar(m, vel * (0.9 - 0.05 * i), 4.0, 0.7), i * 0.018) for i, m in enumerate(CH[name][1])]
for name, t in HIT.items():
    big = name in ("logo", "final")  # the WON hit is lighter: it lands right after a spoken word
    add(fx, swell(BAR * (1.0 if big else 0.6)), t - BAR * (1.0 if big else 0.6), gain=0.7 if big else 0.4)
    add(fx, low_hit(1.0 if big else 0.6), t, gain=0.6)
    add(fx, cymbal(1.0 if big else 0.5, 4.5 if big else 2.5), t, gain=0.6)
    for s, d in STRUM("D", 0.9 if big else 0.6):
        add(fx, s, t + d, pan=-0.3 + d * 8)
    if big:
        add(fx, kalimba(86, 0.7, 3.0) + kalimba(90, 0.45, 3.0), t + 0.02, pan=0.25)


# ---------------------------------------------------------------- mix and master
def process(board, buf):
    return board(buf.astype(np.float32), SR)


room = Reverb(room_size=0.45, damping=0.55, wet_level=0.16, dry_level=0.9, width=0.9)
hall = Reverb(room_size=0.8, damping=0.5, wet_level=0.3, dry_level=0.78, width=1.0)
stems = {
    "gtr": process(Pedalboard([room]), gtr),
    "kal": process(Pedalboard([Delay(delay_seconds=BEAT * 0.75, feedback=0.25, mix=0.2), hall]), kal),
    "pno": process(Pedalboard([hall]), pno),
    "bass": process(Pedalboard([room]), bass),
    "drums": process(Pedalboard([room]), drums),
    "fx": process(Pedalboard([Reverb(room_size=0.92, damping=0.5, wet_level=0.33, dry_level=0.8, width=1.0)]), fx),
}
gains = {"gtr": 1.0, "kal": 0.8, "pno": 0.75, "bass": 1.1, "drums": 0.85, "fx": 0.9}
mix = sum(stems[k] * g for k, g in gains.items())

RIDE = [(0, -4), (SEC["turn"], -3), (HIT["logo"] - 0.05, -1), (HIT["logo"], 0),
        (SEC["split"], 0), (SEC["split"] + 1, -2.5), (HIT["howLand"] - 2.5, -2.5), (HIT["howLand"], 0)]
tt = np.arange(mix.shape[1]) / SR
mix *= 10 ** (np.interp(tt, [p[0] for p in RIDE], [p[1] for p in RIDE]) / 20)
fade = np.clip((END - tt) / 1.5, 0, 1)  # linear: the tail stays audible until the last ~0.5 s (the picture fades over the last 0.5 s)
fade[tt < HIT["final"] + 1.0] = 1
mix = (mix * fade)[:, : int(END * SR)]

master = Pedalboard([
    HighpassFilter(cutoff_frequency_hz=32),
    LowShelfFilter(cutoff_frequency_hz=140, gain_db=1.0),
    HighShelfFilter(cutoff_frequency_hz=9000, gain_db=-2.5),
    Compressor(threshold_db=-20, ratio=2.0, attack_ms=25, release_ms=220),
    Limiter(threshold_db=-1.5, release_ms=120),
])
mix = mix / np.max(np.abs(mix)) * 0.6
out = master(mix.astype(np.float32), SR)

frm, to = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (0.0, END)
seg = out[:, int(frm * SR): int(to * SR)]
if frm > 0 or to < END:
    f = np.minimum(1, np.arange(seg.shape[1]) / (0.02 * SR))
    seg = seg * f * f[::-1]
wavfile.write(sys.argv[1], SR, (np.clip(seg.T, -1, 1) * 32767).astype(np.int16))
print(f"score: {sys.argv[1]} {seg.shape[1] / SR:.1f}s")
