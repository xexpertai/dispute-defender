"""Trim the leading/trailing silence Kokoro leaves on each line (it was most of the dead air between
scenes). Writes <build>/audio_trim/<scene>_<i>.wav; everything downstream uses these.
Usage: python3 scripts/video/trim_audio.py <build_dir>"""
import pathlib, subprocess, sys

build = pathlib.Path(sys.argv[1])
src, dst = build / "audio", build / "audio_trim"
dst.mkdir(exist_ok=True)
TRIM = "silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.08,areverse"
for wav in sorted(src.glob("*.wav")):
    out = dst / wav.name
    if out.exists() and out.stat().st_mtime >= wav.stat().st_mtime:
        continue
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav), "-af", TRIM, str(out)], check=True)
print(f"trimmed {len(list(dst.glob('*.wav')))} lines")
