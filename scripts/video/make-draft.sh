#!/bin/zsh
# One command for the whole video draft:  scripts/video/make-draft.sh [out_dir]
# 1) Kokoro af_heart voiceover per line  2) scripted Playwright takes against Replay
# 3) ffmpeg assembly with burned-in captions + .srt.   Local and free: no paid TTS, no API calls.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-$ROOT/video/out}
# FINAL=1: the end card must carry the real demo + repo URLs (video/config.json), no placeholders.
if [[ -n "$FINAL" ]]; then
  node -e 'const c=require(process.argv[1]);const bad=["demoUrl","repoUrl"].filter(k=>!/^https?:\/\/\S+$/.test(c[k]||"")||/coming soon|added after|placeholder/i.test(c[k]));if(bad.length){console.error("FINAL render blocked: set "+bad.join(", ")+" in video/config.json");process.exit(1)}' "$ROOT/video/config.json"
fi
PORT=${PORT:-4517}
mkdir -p "$OUT/build"
cd "$ROOT"
echo "== voiceover"
uv run --quiet --python 3.12 --with mlx-audio --with "misaki[en]" --with num2words --with spacy python scripts/video/tts.py "$OUT/build"
python3 scripts/video/trim_audio.py "$OUT/build"
echo "== app (Replay) on :$PORT"
STARTED=""
if ! curl -s -o /dev/null "http://localhost:$PORT/"; then
  [[ -d .next ]] || npx next build
  DD_MODE=replay npx next start -p "$PORT" > "$OUT/build/server.log" 2>&1 &
  STARTED=$!
  for i in {1..30}; do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 1; done
fi
echo "== takes"
python3 scripts/video/takes.py "$OUT/build" "http://localhost:$PORT" || { [[ -n "$STARTED" ]] && kill $STARTED; exit 1; }
[[ -n "$STARTED" ]] && kill $STARTED
echo "== assemble"
python3 scripts/video/assemble.py "$OUT/build" "$OUT/dispute-defender-draft.mp4"
echo "== QA (frame every 2 s + contact sheets)"
python3 scripts/video/qa.py "$OUT/dispute-defender-draft.mp4" "$OUT"
python3 scripts/video/script_md.py "$OUT/build"
