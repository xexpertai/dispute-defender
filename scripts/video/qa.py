"""Video QA (fails the render on any issue):
  - output is 1920×1080
  - loudness -14 ±1 LUFS integrated, true peak <= -1.0 dBTP
  - no silence > 0.6 s inside the narration (the last 1.5 s end-card tail is allowed)
  - no frozen hold > 3 s (ffmpeg freezedetect)
  - take-level layout QA from takes.py (header in frame, no half rows under the header, no stamp
    over text, nothing clipped, each scene's referenced UI element fully visible)
Also writes a frame every 2 s and 3×3 contact sheets to <out>/qa for frame-by-frame review.
Usage: python3 scripts/video/qa.py <video.mp4> <out_dir>"""
import json, pathlib, re, shutil, subprocess, sys

video, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
qa = out / "qa"
shutil.rmtree(qa, ignore_errors=True)
(qa / "frames").mkdir(parents=True)


def probe(args):
    return subprocess.run(["ffprobe", "-v", "error", *args, str(video)], capture_output=True, text=True).stdout.strip()


def ff(af_or_vf, kind):
    flag = "-af" if kind == "a" else "-vf"
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), flag, af_or_vf, "-f", "null", "-"], capture_output=True, text=True).stderr


issues = []
dur = float(probe(["-show_entries", "format=duration", "-of", "csv=p=0"]))
wh = probe(["-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0"])
if wh != "1920,1080":
    issues.append(f"resolution {wh} (want 1920,1080)")

m = json.loads(re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", ff("loudnorm=I=-14:TP=-1.5:print_format=json", "a")).group(0))
lufs, tp = float(m["input_i"]), float(m["input_tp"])
if abs(lufs + 14) > 1:
    issues.append(f"loudness {lufs:.1f} LUFS (want -14 ±1)")
if tp > -1.0:
    issues.append(f"true peak {tp:.1f} dBTP (want <= -1.0)")

silences = []
for s, e in re.findall(r"silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)", ff("silencedetect=noise=-45dB:d=0.6", "a")):
    s, e = float(s), float(e)
    if e < dur - 1.5:
        silences.append((round(s, 2), round(e - s, 2)))
if silences:
    issues.append(f"silence > 0.6 s inside narration at {silences}")

freezes = [(round(float(a), 2), round(float(b), 2)) for a, b in re.findall(r"freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)", ff("freezedetect=n=0.002:d=3", "v"))]
if freezes:
    issues.append(f"frozen holds > 3 s at {freezes}")

takes = out / "build" / "qa-takes.json"
take_issues = json.loads(takes.read_text()) if takes.exists() else []
issues += take_issues

t, n = 0.0, 0
while t < dur:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1", "-vf", "scale=960:540", str(qa / "frames" / f"{n:03d}_{int(t // 60)}m{int(t % 60):02d}s.png")], check=True)
    t += 2.0
    n += 1
frames = sorted((qa / "frames").glob("*.png"))
for s in range(0, len(frames), 9):
    chunk = frames[s : s + 9]
    lst = qa / f"list-{s // 9:02d}.txt"
    lst.write_text("".join(f"file '{f}'\n" for f in chunk))
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-vf", f"tile=3x{(len(chunk) + 2) // 3}:padding=6:color=white", "-frames:v", "1", str(qa / f"sheet-{s // 9 + 1:02d}.png")], check=True)
    lst.unlink()

report = {"video": str(video), "seconds": round(dur, 1), "resolution": wh, "lufs": lufs, "true_peak": tp, "silences": silences, "freezes": freezes, "frames": len(frames), "issues": issues}
(qa / "report.json").write_text(json.dumps(report, indent=2))
print(f"QA: {round(dur, 1)} s, {wh}, {lufs:.1f} LUFS, TP {tp:.1f}; {len(frames)} frames in {qa}; issues: {len(issues)}")
for i in issues:
    print("  -", i)
sys.exit(1 if issues else 0)
