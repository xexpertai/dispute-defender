"""Regenerates the "## Scenes" section of docs/VIDEO_SCRIPT.md from video/scenes.json (lines,
visuals) and, when a build exists, the measured scene durations. Usage:
python3 scripts/video/script_md.py [build_dir]"""
import json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SC = json.load(open(ROOT / "video/scenes.json"))["scenes"]
BUILD = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
GAP, TAIL, LEAD = 0.3, 0.25, 0.15


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True, check=True).stdout)


def secs(s):
    if not BUILD:
        return None
    ls = [dur(BUILD / "audio_trim" / f"{s['id']}_{i}.wav") for i in range(len(s["lines"]))]
    return max(LEAD + sum(ls) + GAP * (len(ls) - 1) + TAIL, s.get("minSeconds", 0))


mmss = lambda t: f"{int(t // 60)}:{int(t % 60):02d}"
rows, t = [], 0.0
for i, s in enumerate(SC, 1):
    d = secs(s)
    when = f" · {mmss(t)}–{mmss(t + d)}" if d else ""
    rows.append(f"### {i}. {s['id']}{when}\n\n**Visual:** {s.get('visual', '')}\n\n**Voice:**\n\n" + "\n".join(f"> {l}" for l in s["lines"]) + "\n")
    t += d or 0
md = (ROOT / "docs/VIDEO_SCRIPT.md").read_text()
new = "## Scenes\n\n" + "\n".join(rows) + "\n"
md = re.sub(r"## Scenes\n.*?(?=\n## Re-shoot plan)", new.rstrip() + "\n", md, flags=re.S)
if t:
    md = re.sub(r"Draft v1 runs \*\*\d+ s\*\*", f"Draft v1 runs **{t:.0f} s**", md)
(ROOT / "docs/VIDEO_SCRIPT.md").write_text(md)
print("VIDEO_SCRIPT.md scenes regenerated", f"({t:.0f} s)" if t else "")
