"""Assemble the draft video at 1920×1080.

Per scene: the take fills the app area (1920×910) above a 170 px caption band; a subtle push-in so
no shot is a frozen hold; a deliberate bottom fade on the app frame; timed overlays (stat card over
a blurred base, architecture build, band labels); captions in the band (never over the UI); the
trimmed voice lines with short pauses. Then concatenate, normalise loudness (two-pass loudnorm to
-14 LUFS, true peak -1.5 dBTP), write captions.srt, and fail if the cut is 150 s or longer.

Usage: python3 scripts/video/assemble.py <build_dir> <output.mp4>"""
import json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILD = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
SCENES = json.load(open(ROOT / "video/scenes.json"))["scenes"]
META = json.load(open(BUILD / "takes.json"))
GAP, TAIL, LEAD_IN = 0.3, 0.25, 0.15
W, H, FPS = 1920, 1080, 30
AW, AH = 1920, 910  # app area; the header is at its top edge, fully in frame
DESK = "0xe7ebf0"
OVERLAY_RULES = {"hookstat": {"scrim": 0.74, "blur": 14}}  # floating overlays must hide what's under them
LOUD = {"I": -14.0, "TP": -1.5, "LRA": 11.0}


def run(args, capture=False):
    return subprocess.run(["ffmpeg", "-hide_banner", "-y", *args], check=True, capture_output=True, text=True) if capture else subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def ts(t):
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def push(label_in, label_out, w, h, z, total):
    """Subtle push-in: scale up by z over the shot, centre-cropped back to w×h."""
    if z <= 0:
        return f"[{label_in}]null[{label_out}]"
    return (f"[{label_in}]scale=w='trunc({w}*(1+{z}*t/{total:.3f})/2)*2':h='trunc({h}*(1+{z}*t/{total:.3f})/2)*2':eval=frame,"
            f"crop={w}:{h}:(iw-{w})/2:(ih-{h})/2[{label_out}]")


parts, srt, clock, n = [], [], 0.0, 1
for sc in SCENES:
    sid, m = sc["id"], META[sc["id"]]
    wavs = [BUILD / "audio_trim" / f"{sid}_{i}.wav" for i in range(len(sc["lines"]))]
    lens = [dur(w) for w in wavs]
    total = max(LEAD_IN + sum(lens) + GAP * (len(lens) - 1) + TAIL, sc.get("minSeconds", 0))
    z = sc.get("push", 0.025 if m["kind"] != "still" else 0.04)

    windows, t = [], LEAD_IN
    for i, L in enumerate(lens):
        end = t + L + (GAP if i < len(lens) - 1 else max(0.1, total - t - L - 0.03))
        windows.append((t, end))
        srt.append(f"{n}\n{ts(clock + t)} --> {ts(clock + t + L)}\n{sc['lines'][i]}\n")
        n += 1
        t += L + GAP

    inputs, filt, idx = ["-f", "lavfi", "-t", f"{total:.3f}", "-i", f"color=c={DESK}:s={W}x{H}:r={FPS}"], [], 1

    def add(args):
        global idx
        inputs.extend(args)
        idx += 1
        return idx - 1

    loop = lambda f: ["-loop", "1", "-t", f"{total:.3f}", "-i", str(f)]
    if m["kind"] == "still":
        i = add(loop(BUILD / m["file"]))
        filt.append(f"[{i}:v]scale={W}:{H},fps={FPS},setsar=1[s0]")
        filt.append(push("s0", "s1", W, H, z, total))
        filt.append("[0:v][s1]overlay=0:0[b0]")
    elif m["kind"] == "screen":
        i = add(["-i", str(BUILD / m["file"])])
        filt.append(f"[{i}:v]trim=start={max(0.0, m['lead'] - 0.1):.2f},setpts=PTS-STARTPTS,scale={AW}:{AH},fps={FPS},setsar=1,"
                    f"tpad=stop_mode=clone:stop_duration={total:.3f},trim=duration={total:.3f}[s0]")
        filt.append(push("s0", "s1", AW, AH, z, total))
        fade = add(loop(BUILD / "cards/fade.png"))
        filt.append(f"[{fade}:v]scale={W}:{H}[fd];[0:v][s1]overlay=0:0[p0];[p0][fd]overlay=0:0[b0]")
    else:  # phone: large phone in a bezel beside the same case on desktop
        ph = add(["-i", str(BUILD / m["file"])])
        dk = add(loop(BUILD / "cards/desk.png"))
        filt.append(f"[{ph}:v]trim=start={max(0.0, m['lead'] - 0.1):.2f},setpts=PTS-STARTPTS,scale=-2:850:flags=lanczos,fps={FPS},setsar=1,"
                    f"tpad=stop_mode=clone:stop_duration={total:.3f},trim=duration={total:.3f},pad=iw+32:ih+32:16:16:color=0x0d1424[ph]")
        filt.append(f"[{dk}:v]scale=1180:-2,setsar=1,pad=iw+4:ih+4:2:2:color=0xc1cad6[dk]")
        filt.append("[0:v][dk]overlay=600:(910-h)/2[p0];[p0][ph]overlay=150:(910-h)/2[s1]")
        filt.append(push("s1", "b0", W, H, z, total))
    last = "b0"

    for k, ov in enumerate(sc.get("overlays", [])):
        a, b = ov["from"], ov["to"]
        if ov["card"] == "hookstat":
            rule = OVERLAY_RULES["hookstat"]
            if not (rule["scrim"] >= 0.65 and rule["blur"] > 0):
                sys.exit("video QA: a floating overlay needs a scrim >= 0.65 and a blurred base")
            i = add(loop(BUILD / "cards/hookstat.png"))
            filt.append(f"[{last}]boxblur={rule['blur']}:2:enable='between(t,{a:.2f},{b:.2f})'[bl{k}];[{i}:v]scale={W}:{H}[hs{k}];[bl{k}][hs{k}]overlay=0:0:enable='between(t,{a:.2f},{b:.2f})'[o{k}]")
        else:
            i = add(loop(BUILD / f"cards/architecture-{ov['step']}.png"))
            filt.append(f"[{i}:v]scale={W}:{H}[ar{k}];[{last}][ar{k}]overlay=0:0:enable='between(t,{a:.2f},{b:.2f})'[o{k}]")
        last = f"o{k}"

    for k, lab in enumerate(sc.get("bandLabels", [])):
        a, b = windows[lab.get("line", 0)]
        i = add(loop(BUILD / "cards" / f"label-{sid}-{k}.png"))
        filt.append(f"[{i}:v]scale={W}:{H}[lb{k}];[{last}][lb{k}]overlay=0:0:enable='between(t,{max(0, a - LEAD_IN):.3f},{b:.3f})'[l{k}]")
        last = f"l{k}"

    for k, (a, b) in enumerate(windows):
        i = add(loop(BUILD / "captions" / f"{sid}_{k}.png"))
        filt.append(f"[{i}:v]scale={W}:{H}[cp{k}];[{last}][cp{k}]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'[k{k}]")
        last = f"k{k}"

    first_audio = idx
    for w in wavs:
        add(["-i", str(w)])
    t = LEAD_IN
    for k, L in enumerate(lens):
        d = int(t * 1000)
        filt.append(f"[{first_audio + k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={d}|{d}[a{k}]")
        t += L + GAP
    filt.append("".join(f"[a{k}]" for k in range(len(lens))) + f"amix=inputs={len(lens)}:normalize=0,apad=whole_dur={total:.3f}[aout]")

    part = BUILD / f"part_{len(parts):02d}_{sid}.mp4"
    run([*inputs, "-filter_complex", ";".join(filt), "-map", f"[{last}]", "-map", "[aout]", "-t", f"{total:.3f}",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "pcm_s16le", str(part.with_suffix(".mkv"))])
    parts.append(part.with_suffix(".mkv"))
    clock += total
    print(f"{sid}: {total:.1f}s")

lst = BUILD / "parts.txt"
lst.write_text("".join(f"file '{p}'\n" for p in parts))
joined = BUILD / "joined.mkv"
run(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(joined)])

# Loudness: two-pass loudnorm to -14 LUFS integrated, true peak <= -1.5 dBTP.
pass1 = run(["-i", str(joined), "-af", f"loudnorm=I={LOUD['I']}:TP={LOUD['TP']}:LRA={LOUD['LRA']}:print_format=json", "-f", "null", "-"], capture=True)
m1 = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", pass1.stderr).group(0))
af = (f"loudnorm=I={LOUD['I']}:TP={LOUD['TP']}:LRA={LOUD['LRA']}:measured_I={m1['input_i']}:measured_TP={m1['input_tp']}:"
      f"measured_LRA={m1['input_lra']}:measured_thresh={m1['input_thresh']}:offset={m1['target_offset']}:linear=true")
OUT.parent.mkdir(parents=True, exist_ok=True)
run(["-i", str(joined), "-af", af, "-ar", "48000", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(OUT)])
OUT.with_suffix(".srt").write_text("\n".join(srt))
length = dur(OUT)
print(f"draft video: {OUT} ({length:.1f}s)")
if length >= 150:
    sys.exit(f"too long: {length:.1f}s >= 150s")
