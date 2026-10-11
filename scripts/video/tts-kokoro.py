"""Voiceover on Linux/WSL: the CPU twin of tts.py (the `kokoro` package, same Kokoro-82M model, voice af_heart,
24 kHz mono). Voices only the line ids given, into <build_dir>/audio/<id>.wav, then trims them into audio-trim/
with trim.py's filter. Usage:
  ~/workspace/.video-venv/bin/python scripts/video/tts-kokoro.py <build_dir> <story.json> id[,id...]"""
import json, pathlib, subprocess, sys
import numpy as np, soundfile as sf
from kokoro import KPipeline

B, story, ids = pathlib.Path(sys.argv[1]), json.load(open(sys.argv[2])), sys.argv[3].split(",")
voice = story["_meta"]["voice"]
pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
SIL = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.06,areverse"
(B / "audio").mkdir(exist_ok=True); (B / "audio-trim").mkdir(exist_ok=True)
for ln in story["lines"]:
    if ln["id"] not in ids:
        continue
    audio = np.concatenate([np.asarray(a) for _, _, a in pipe(ln.get("say", ln["text"]), voice=voice, speed=1.0)])
    raw = B / "audio" / f"{ln['id']}.wav"
    sf.write(raw, audio, 24000, subtype="PCM_16")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw), "-af", SIL, str(B / "audio-trim" / raw.name)], check=True)
    print("voiced", ln["id"], f"{sf.info(B / 'audio-trim' / raw.name).duration:.2f}s")
