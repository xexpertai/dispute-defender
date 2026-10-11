#!/bin/zsh
# The story video (docs/VIDEO_STORYBOARD.md), end to end:  scripts/video/make-story.sh [out_dir]
#   1) Kokoro af_heart voice lines (video/story.json)      2) word timings for the captions (mlx-whisper)
#   3) the original score (scripts/video/score.py, CC0)   4) voice + ducked score, -14 LUFS / -1.5 dBTP
#   5) replay footage from a local production build        6) Remotion render (video/remotion)
#   7) mux, then QA: frames every 2 s, loudness, true peak, silence, length, fps, holds, layout
# Offline (e.g. WSL), set REMOTION_BROWSER to a local chrome-headless-shell (npm ci drops Remotion's cached one).
# Everything runs locally and free. FINAL=1 refuses to render without the demo and repo links.
# The LIVE takes (cafe-approve, cafe-sim, cafe-won) are filmed once against PayPal's sandbox and are reused
# from <out_dir>/build/footage; this script never writes to PayPal. REPLAY_TAKES=0 skips re-shooting
# the replay takes too.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-$ROOT/video/out/story}
B=$OUT/build
PORT=${PORT:-4521}
mkdir -p "$B"
cd "$ROOT"
if [[ "$FINAL" == "1" ]]; then
  python3 -c "import json,sys; c=json.load(open('video/config.json')); sys.exit(0 if c.get('demoUrl') and c.get('repoUrl') else 'FINAL render refused: set demoUrl and repoUrl in video/config.json')"
fi
for take in cafe-approve cafe-sim cafe-won; do
  [[ -f "$B/footage/$take.mp4" ]] || { echo "missing live take $take (filmed once against the sandbox; the footage is not in the repo)"; exit 1; }
done
# SKIP_VOICE=1 reuses <out_dir>/build/audio-trim and words.json (e.g. on Linux/WSL, where the mlx
# packages used for Kokoro and whisper don't exist). There, voice new or changed lines with the CPU twins:
#   ~/workspace/.video-venv/bin/python scripts/video/tts-kokoro.py "$B" video/story.json id[,id...]
#   ~/workspace/.video-venv/bin/python scripts/video/align-fw.py "$B" video/story.json id[,id...]
if [[ "$SKIP_VOICE" != "1" ]]; then
  echo "== voice"
  uv run --quiet --python 3.12 --with mlx-audio --with "misaki[en]" --with num2words --with spacy python scripts/video/tts.py "$B" video/story.json
  python3 scripts/video/trim.py "$B"
  echo "== caption timings"
  uv run --quiet --python 3.12 --with mlx-whisper python scripts/video/align.py "$B" video/story.json
fi
echo "== score"
uv run --quiet --python 3.12 --with numpy --with scipy --with pedalboard python scripts/video/score.py "$B/music.wav"
echo "== mix"
uv run --quiet --python 3.12 --with numpy --with scipy --with pyloudnorm python scripts/video/mix.py "$B"
if [[ "$REPLAY_TAKES" != "0" ]]; then
  echo "== replay footage (app on :$PORT, Replay mode, fresh DB)"
  rm -rf "$B/db" && mkdir -p "$B/db"
  npx next build > "$B/build.log" 2>&1
  DD_MODE=replay DD_DB_PATH="$B/db/dd.db" npx next start -p "$PORT" > "$B/server.log" 2>&1 &
  STARTED=$!
  for i in {1..40}; do curl -s -o /dev/null "http://localhost:$PORT/api/health" && break; sleep 1; done
  CAFE_ID=${CAFE_ID:?set CAFE_ID to the KC-CAFE-24 dispute id} TAKES=board,mugs,cafe-draft,fair,plates,insights uv run --quiet --python 3.12 --with playwright python scripts/video/footage.py "$B/footage" "http://localhost:$PORT" || { kill $STARTED; exit 1; }
  kill $STARTED
fi
echo "== MCP beat (a real assess_dispute call to the keyless Replay MCP server; nothing is sent)"
npx tsx scripts/video/mcp-shot.mts "$B/mcp.json"
echo "== render"
python3 scripts/video/story-data.py "$B"
(cd video/remotion && npm ci --silent --no-audit --no-fund && npx remotion render src/index.ts Story "$B/story-silent.mp4" --codec h264 --crf 16 --muted --log=error ${REMOTION_BROWSER:+--browser-executable=$REMOTION_BROWSER})
ffmpeg -hide_banner -loglevel error -y -i "$B/story-silent.mp4" -i "$B/mix.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart "$OUT/dispute-defender-story.mp4"
echo "== qa"
uv run --quiet --python 3.12 --with pillow python scripts/video/story-qa.py "$OUT/dispute-defender-story.mp4" "$B" "$OUT/qa"
