#!/usr/bin/env python3
"""
Prepares the "Lipstick Effect" episode for Remotion from one ElevenLabs dialogue MP3.

  python3 scripts/lipstick_prepare.py            (run from video/; needs ffmpeg, numpy)

The source MP3 is not in git (the repository is public and it is the creator's cloned voice). Put the ElevenLabs
export at video/assets/lipstick-dialogue.mp3 before running (keep the original outside git, e.g. in Google Drive).

1. Cuts the 12 lines out of assets/lipstick-dialogue.mp3 at the boundaries found by silence + pitch analysis
   (see SOURCE below: Uco ~160-290 Hz and loud, Ocu ~110-130 Hz; every boundary is a speaker change).
2. Re-spaces them: Uco interrupting Ocu 0.2 s, Ocu's deadpan beats 0.42 s, same speaker 0.3 s.
3. Voice chain per line (80 Hz high-pass, compression, -14 LUFS); telephone band + reverb on lines 9-10.
4. Loudness per video frame (lip-sync) and per-word timing (syllable-weighted over the voiced frames).
5. Synthesises the pizzicato BGM bed and every SFX (no sample library needed).
Writes public/lipstick/*.wav and src/lipstick/data.json.
"""
import json, math, os, re, subprocess
import numpy as np

FPS = 30
SR = 48000
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "assets", "lipstick-dialogue.mp3")
PUB = os.path.join(HERE, "public", "lipstick")
DATA = os.path.join(HERE, "src", "lipstick", "data.json")

# Voices are the ElevenLabs dialogue file; Gemini clips (if used) are silent visuals only, so captions follow this audio.
LINES = [
    ("uco", "hook", "Katanya kelas menengah lagi turun kelas, daya beli anjlok... tapi kafe penuh, skincare ludes! Drama doang!", "furious", (0.00, 7.62)),
    ("ocu", "counter", "Matcha enam puluh lima ribu di tangan orang bokek itu bukan gaya hidup... Itu obat penenang yang dikasih es batu.", "deadpan", (7.90, 16.52)),
    ("uco", "escalation", "Obat penenang, apaan?! Bilangnya nggak bisa nabung, tapi mutasi rekeningnya matcha, serum, toner!", "furious", (16.88, 24.74)),
    ("ocu", "escalation", "Justru itu. Harga rumah makin mustahil, jadi orang beli kemewahan kecil biar ngerasa masih punya kendali.", "calm", (25.08, 32.04)),
    ("ocu", "escalation", "Nanti rumah cuma jadi brosur, matcha jadi aset utama, kita nyicil es batu pakai paylater... terus matahari meledak. DHUARRR!!!", "worried", (32.55, 41.56)),
    ("uco", "counter", "Teori ngarang dari mana lagi itu?! Ekonom aja masih debat!", "angry", (41.93, 45.38)),
    ("ocu", "insight", "Namanya Lipstick Effect. Leonard Lauder dari Estée Lauder nemuin penjualan lipstik justru naik pas krisis dua ribu satu.", "calm", (45.74, 53.21)),
    ("uco", "counter", "Itu kan cuma pola perilaku, bukan hukum pasti! Kafe rame nggak otomatis bukti ekonomi aman, atau kiamat matahari meledak kayak yang lo bilang.", "excited", (53.49, 62.70)),
    ("uco", "concession", "Sial, bener juga. Orang beli matcha bukan karena kaya, tapi karena capek..", "thinking", (62.97, 69.37)),
    ("ocu", "concession", "Dia ada benernya sih. Kafe penuh juga belum tentu kiamat. hmmmmm.", "thinking", (69.70, 75.03)),
    ("uco", "button", "Ya udah, gue traktir matcha. Bukan karena lo bener ya... cuma, buat terapiii...", "smug", (75.60, 81.62)),
    ("ocu", "button", "Es batunya yang banyaaakkk. Dosisnya harus pas buat gueee.", "deadpan", (81.95, 87.33)),
]
THOUGHTS = {8, 9}  # 0-based: lines 9 and 10
SUBS = [  # tiny English meaning, kept in data for the app's caption export; not drawn (single-caption rule)
    "They say the middle class is sliding and spending power crashed... but cafes are packed, skincare sold out! Pure drama!",
    "A 65k matcha in a broke person's hand isn't a lifestyle... It's a sedative served with ice.",
    "Sedative, my foot?! They say they can't save, but their bank statement is matcha, serum, toner!",
    "Exactly. Houses are getting impossible, so people buy small luxuries to feel they're still in control.",
    "Soon houses are just brochures, matcha is our main asset, we pay off ice cubes with paylater... then the sun explodes. KABOOM!",
    "Where'd you make up that theory?! Even economists are still arguing!",
    "It's called the Lipstick Effect. Leonard Lauder of Estée Lauder found lipstick sales went up in the 2001 crisis.",
    "That's just a behaviour pattern, not a law! Packed cafes don't prove the economy's fine, or that the sun explodes like you said.",
    "Damn, he's right. People buy matcha not because they're rich, but because they're tired..",
    "He's got a point. Packed cafes don't mean the apocalypse either. Hmmmm.",
    "Fine, matcha's on me. Not because you're right... it's just, for therapy...",
    "Lots of ice. The dose has to be right for me.",
]

def run(*a):
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *a], check=True)

def read_wav(path):
    raw = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768

def write_wav(path, x, sr=SR):
    x = np.clip(x, -1, 1)
    pcm = (x * 32767).astype(np.int16).tobytes()
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(sr), "-ac", "1", "-i", "-", path], input=pcm, check=True)


def speech_runs(env, quiet=0.06, min_gap=6):
    """Runs of speech separated by pauses of at least min_gap frames."""
    runs, cur, silent = [], None, 0
    for k, v in enumerate(env):
        if v > quiet:
            if cur is None: cur = [k, k]
            cur[1] = k; silent = 0
        elif cur is not None:
            silent += 1
            if silent >= min_gap:
                runs.append(tuple(cur)); cur = None; silent = 0
    if cur is not None: runs.append(tuple(cur))
    return runs or [(0, len(env) - 1)]

def group(n_small, sizes_big):
    """DP: split the longer list (weights sizes_big) into n_small consecutive groups whose shares best match."""
    import functools
    tot = sum(sizes_big)
    @functools.lru_cache(None)
    def best(i, g):  # cover big[i:] with g groups
        if g == 0: return (0.0, ()) if i == len(sizes_big) else (1e9, ())
        out = (1e9, ())
        for j in range(i + 1, len(sizes_big) - g + 2):
            cost = (sum(sizes_big[i:j]) / tot - 1 / n_small) ** 2
            rest = best(j, g - 1)
            if cost + rest[0] < out[0]: out = (cost + rest[0], ((i, j),) + rest[1])
        return out
    return best(0, n_small)[1]

def time_words(text, env):
    """Per-word frame timing: phrases (split at punctuation) are matched to speech runs, words spread by syllables."""
    words = text.split()
    phrases, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[,.!?…]$", w): phrases.append(cur); cur = []
    if cur: phrases.append(cur)
    runs = speech_runs(env)
    psyl = [sum(syllables(w) for w in ph) for ph in phrases]
    rlen = [b - a + 1 for a, b in runs]
    # pair them up: whichever list is longer gets grouped so both have the same count
    if len(phrases) >= len(runs):
        pg = group(len(runs), tuple(psyl)) if len(phrases) > len(runs) else tuple((k, k + 1) for k in range(len(runs)))
        pairs = [(sum(phrases[a:b], []), runs[k]) for k, (a, b) in enumerate(pg)]
    else:
        rg = group(len(phrases), tuple(rlen))
        pairs = [(phrases[k], (runs[a][0], runs[b - 1][1])) for k, (a, b) in enumerate(rg)]
    timings = []
    for ph, (a, b) in pairs:
        wts = [syllables(w) for w in ph]; tot = sum(wts); acc = 0; span = b - a + 1
        for w, wt in zip(ph, wts):
            s_idx = a + int(acc / tot * span); acc += wt
            e_idx = a + int(acc / tot * span)
            timings.append({"w": w, "s": s_idx, "e": max(s_idx + 2, e_idx)})
    return timings

# ---------- 1-3. lines ----------
LEVEL = "highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=2,loudnorm=I=-14:TP=-1.5:LRA=7"
THOUGHT = "highpass=f=300,lowpass=f=3400,aecho=0.8:0.55:45|90:0.25|0.15,"

def gap_before(i):
    if i == 0:
        return 0.0
    sp, prev = LINES[i][0], LINES[i - 1][0]
    if i in THOUGHTS:
        return 0.40
    if sp == "uco" and prev == "ocu":
        return 0.20  # Uco interrupts
    if sp == "ocu" and prev == "uco":
        return 0.42  # Ocu's deadpan beat
    return 0.30

def syllables(word):
    w = re.sub(r"[^a-zA-Zéè]", "", word.lower())
    w = re.sub(r"(.)\1{2,}", r"\1", w)  # "banyaaakkk" → "banyak"
    return max(1, len(re.findall(r"[aiueoé]+", w)))

os.makedirs(PUB, exist_ok=True)
os.makedirs(os.path.dirname(DATA), exist_ok=True)
lines_out = []
t = 0.0
for i, (sp, beat, text, expr, (a, b)) in enumerate(LINES):
    n = f"{i + 1:02d}"
    tmp = os.path.join(PUB, f"_raw{n}.wav")
    run("-ss", f"{max(0, a - 0.04):.3f}", "-to", f"{b + 0.06:.3f}", "-i", SRC, "-ac", "1", "-ar", str(SR), tmp)
    out = os.path.join(PUB, f"line-{n}.wav")
    run("-i", tmp, "-af", (THOUGHT if i in THOUGHTS else "") + LEVEL, "-ar", str(SR), "-ac", "1", out)
    os.remove(tmp)
    x = read_wav(out)
    per = SR // FPS
    rms = np.array([math.sqrt(float(np.mean(x[k:k + per] ** 2)) + 1e-12) for k in range(0, len(x), per)])
    loud, floor = np.percentile(rms, 95), np.percentile(rms, 20)
    env = np.clip((rms - floor * 1.5) / max(1e-6, loud - floor * 1.5), 0, 1)
    env = [round(float(v), 2) for v in env]
    frames = len(env)
    timings = time_words(text, env)
    t += gap_before(i)
    start = round(t * FPS)
    lines_out.append({
        "index": i, "speaker": sp, "beat": beat, "text": text, "subtitle": SUBS[i], "expression": expr,
        "thought": i in THOUGHTS, "audio": f"lipstick/line-{n}.wav", "start": start, "frames": frames,
        "envelope": env, "words": timings, "source": [a, b],
    })
    t = start / FPS + frames / FPS
    print(f"line {n} {sp}: starts {start / FPS:6.2f}s, {frames / FPS:4.1f}s, {len(timings)} words")

SLURP_S, END_S = 1.0, 1.5
speech_end = round(t * FPS)
total_frames = speech_end + round((SLURP_S + END_S) * FPS)

# ---------- 5. music + SFX ----------
rng = np.random.default_rng(7)
def tone(f, dur, decay=6.0, partials=(1, 0.5, 0.25)):
    n = int(dur * SR); tt = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * f * (k + 1) * tt) for k, a in enumerate(partials))
    return y * np.exp(-decay * tt)
def pluck(f, dur=0.35):  # Karplus-Strong pizzicato
    n = int(dur * SR); p = max(2, int(SR / f)); buf = rng.uniform(-1, 1, p); y = np.zeros(n)
    for k in range(n):
        y[k] = buf[k % p]; buf[k % p] = 0.5 * (buf[k % p] + buf[(k + 1) % p]) * 0.994
    return y * np.exp(-3 * np.arange(n) / SR)
def noise(dur):
    return rng.uniform(-1, 1, int(dur * SR))
def lowpass(x, a):  # one-pole
    y = np.zeros_like(x); s = 0.0
    for k in range(len(x)):
        s += a * (x[k] - s); y[k] = s
    return y
def env_ad(n, att, dec):
    tt = np.arange(n) / SR
    return np.minimum(1, tt / max(att, 1e-4)) * np.exp(-tt / dec)
def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return x / m * peak

# Pizzicato bed: bouncy C-major walk, 116 bpm, staccato bass on beats, plucked melody on offbeats.
bpm = 116; beat = 60 / bpm; dur = total_frames / FPS + 1
bed = np.zeros(int(dur * SR))
NOTE = lambda m: 440 * 2 ** ((m - 69) / 12)
prog = [(48, [64, 67, 72, 67]), (53, [65, 69, 72, 69]), (55, [67, 71, 74, 71]), (48, [64, 67, 76, 72])]
k = 0; tpos = 0.0
while tpos < dur - 1:
    root, mel = prog[(k // 4) % len(prog)]
    i0 = int(tpos * SR)
    b = pluck(NOTE(root - 12 if k % 2 == 0 else root - 5), 0.3) * 0.9
    bed[i0:i0 + len(b)] += b[: len(bed) - i0]
    m = pluck(NOTE(mel[k % 4]), 0.25) * 0.55
    j0 = int((tpos + beat / 2) * SR)
    if j0 < len(bed):
        bed[j0:j0 + len(m)] += m[: len(bed) - j0]
    if k % 8 == 7:  # little trill
        for q, mm in enumerate([mel[2] + 2, mel[2]]):
            r = pluck(NOTE(mm), 0.15) * 0.4; jj = int((tpos + beat * (0.25 + q * 0.25)) * SR)
            if jj < len(bed): bed[jj:jj + len(r)] += r[: len(bed) - jj]
    tpos += beat; k += 1
write_wav(os.path.join(PUB, "bgm.wav"), norm(bed, 0.8))

SFX = {}
def sfx(name, x):
    write_wav(os.path.join(PUB, f"sfx-{name}.wav"), norm(x)); SFX[name] = f"lipstick/sfx-{name}.wav"
# rapid phone taps
taps = np.zeros(int(1.4 * SR))
for q in range(12):
    c = tone(2400 + rng.uniform(-200, 200), 0.03, 120, (1, 0.3)) + noise(0.03) * 0.3 * np.exp(-np.arange(int(0.03 * SR)) / SR * 150)
    j = int(q * 0.11 * SR); taps[j:j + len(c)] += c[: len(taps) - j]
sfx("taps", taps)
# kettle: rising boil noise into a whistle
n = int(2.4 * SR); tt = np.arange(n) / SR
boil = lowpass(noise(2.4), 0.05) * (0.3 + tt / 2.4) * 2.5
whistle = np.sin(2 * np.pi * np.cumsum(1800 + 900 * (tt / 2.4) ** 2) / SR) * np.clip((tt - 1.2) / 0.6, 0, 1) * 0.5
sfx("kettle", boil + whistle)
# ice clinks
clink = np.zeros(int(0.8 * SR))
for q, f in enumerate([3100, 4200, 3600]):
    c = tone(f, 0.25, 22, (1, 0.4, 0.2)); j = int(q * 0.13 * SR); clink[j:j + len(c)] += c[: len(clink) - j] * (1 - q * 0.2)
sfx("ice", clink)
# paper snap
ps = noise(0.12) * env_ad(int(0.12 * SR), 0.001, 0.025)
sfx("paper", ps - lowpass(ps, 0.2))
# bell ding
sfx("ding", tone(1568, 1.4, 2.2, (1, 0.6, 0.35, 0.2)) + tone(2350, 1.4, 3, (0.4,)))
# steam hiss
st = noise(1.2); st = st - lowpass(st, 0.3)
sfx("steam", st * env_ad(len(st), 0.05, 0.5))
# slide whistle down
n = int(1.4 * SR); tt = np.arange(n) / SR
sfx("slide", np.sin(2 * np.pi * np.cumsum(1400 - 900 * tt / 1.4) / SR) * np.minimum(1, tt / 0.05) * np.exp(-tt * 0.6))
# cartoon explosion pop
n = int(1.2 * SR); tt = np.arange(n) / SR
boom = np.sin(2 * np.pi * np.cumsum(120 * np.exp(-tt * 3)) / SR) * np.exp(-tt * 3.5)
crack = lowpass(noise(1.2), 0.15) * np.exp(-tt * 6)
sfx("boom", boom * 0.9 + crack * 0.8)
# paper whoosh
w = noise(0.6); n = len(w); tt = np.arange(n) / SR
sfx("whoosh", lowpass(w, 0.08) * np.sin(np.pi * tt / 0.6) ** 2 * 3)
# slap / WHACK
n = int(0.35 * SR); tt = np.arange(n) / SR
sfx("whack", noise(0.35) * np.exp(-tt * 40) + np.sin(2 * np.pi * 90 * tt) * np.exp(-tt * 18) * 0.8)
# bubble pop
n = int(0.15 * SR); tt = np.arange(n) / SR
sfx("bubble", np.sin(2 * np.pi * np.cumsum(500 + 2500 * tt / 0.15) / SR) * np.exp(-tt * 25))
# cup slide on a table
cs = lowpass(noise(0.8), 0.04); tt = np.arange(len(cs)) / SR
sfx("cupslide", cs * np.sin(np.pi * tt / 0.8) * 4)
# straw slurp: gurgly band-limited noise with wobble
n = int(1.0 * SR); tt = np.arange(n) / SR
gurgle = lowpass(noise(1.0), 0.12) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 14 * tt)))
sfx("slurp", (gurgle - lowpass(gurgle, 0.01)) * np.minimum(1, tt / 0.05) * np.minimum(1, (1 - tt) / 0.15) * 2)

# ---------- cue points (frames, absolute), locked to words ----------
def word_frame(li, pattern, nth=0, edge="s"):
    hits = [w for w in lines_out[li]["words"] if re.search(pattern, w["w"], re.I)]
    w = hits[min(nth, len(hits) - 1)]
    return lines_out[li]["start"] + w[edge]
L = lambda i: lines_out[i]
cues = {
    "matchaWord": word_frame(2, r"^matcha"),
    "dhuarr": word_frame(4, r"DHUARR"),
    "slap": word_frame(7, r"pasti"),
    "paylater": word_frame(4, r"paylater"),
    "slide": L(10)["start"] + int(L(10)["frames"] * 0.45),
}
sfx_track = [
    ("taps", L(0)["start"] + 3, 0.5), ("kettle", L(0)["start"] + L(0)["frames"] - 72, 0.35),
    ("ice", L(1)["start"] + 20, 0.55),
    ("paper", L(2)["start"] + 6, 0.6), ("ding", cues["matchaWord"], 0.5), ("steam", cues["matchaWord"] + 4, 0.35),
    ("slide", L(3)["start"] + 24, 0.4),
    ("boom", cues["dhuarr"], 0.8),
    ("whoosh", L(6)["start"] + 10, 0.45),
    ("whack", cues["slap"], 0.85),
    ("bubble", L(8)["start"] + 4, 0.6), ("bubble", L(9)["start"] + 4, 0.6),
    ("cupslide", cues["slide"], 0.6),
    ("slurp", speech_end + 2, 0.8),
]
json.dump({
    "fps": FPS, "totalFrames": total_frames, "speechEnd": speech_end, "slurpFrames": round(SLURP_S * FPS),
    "endFrames": round(END_S * FPS), "lines": lines_out, "cues": cues,
    "bgm": "lipstick/bgm.wav", "sfx": [{"src": SFX[n], "at": at, "volume": v, "name": n} for n, at, v in sfx_track],
    "cta": "Struk 'terapi' paling mahal kamu bulan ini apa? Tulis di komen.",
}, open(DATA, "w"), ensure_ascii=False)
print(f"total {total_frames / FPS:.1f}s ({total_frames} frames); cues {cues}")
