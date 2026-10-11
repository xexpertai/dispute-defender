# FINAL video render: what must change

> **Done 11 Oct (v4, 2:32.7; re-rendered 14:23 so the lessons beat opens on the whole section, heading and TEMPLATE stamp uncut, before the push; full QA pass: −14.1 LUFS, −1.4 dBTP, no silence > 0.6 s):** items 1–5 are in the cut. Board re-shot on the current app ($286 · 5 open) with the calls card; the plates (VYZ) shown with "You can't prove delivery" plus the "Actions PayPal allows right now" panel; Insights lessons with the TEMPLATE stamp; the MCP beat is a real `assess_dispute` call to `npm run -s mcp:replay` (`scripts/video/mcp-shot.mts`), drawn as a terminal card (no Inspector UI); end card with both URLs. New voice lines were made on WSL with `scripts/video/tts-kokoro.py` + `align-fw.py` (Kokoro af_heart). The repo URL only resolves once the repo is public.

The story video (119.9 s, last rendered 7 Oct) was cut before the board card, the single-case lessons and the keyless MCP server existed. The FINAL render (`FINAL=1 scripts/video/make-story.sh`, submit day, after the repo is public) must bring it in line with the app as deployed. Nothing here has been rendered yet.

## 1. Board beat (0:00–0:27): re-capture on the current app
- The current board frame shows an older state ("$598 · 6 open"). Re-capture the `board` take against the hosted app, so it shows today's numbers ($286 at risk · 5 open in Replay).
- Show the new card, **"The agent's call on all 7 of your cases"**: Defend 2 · $401 / Fair offer 1 · $64 / Refund 3 · $80 / Hold 1 · $142, with the refund note "1 where the buyer is right, 1 where you can't prove delivery, 1 where your time costs more".
- The card's footer line is an assumption, not a measurement ("By hand … ≈ 3.5 h. An assumption (the app's cost-to-fight figure), not a measured time."). If it is on screen, keep that label legible; the voiceover must not call it a measured saving.
- Re-measure the take's rects (`board.risk`, `board.watch`, `board.deadline`, `caseFile`, `checker*`): the card and the footer line move the content below it.

## 2. Wording that changed (check every frame and the voiceover)
- **VYZ plates ($42, no tracking):** the app now says "You can't prove delivery: no tracking on record", never "The buyer is right". If VYZ appears anywhere in the cut, it must use the new wording.
- **FDW planter ($28.50, returned to sender, the store's own label error):** still "The buyer is right". The scene at 1:16–1:20 (callout "Fair to the buyer, too") stays correct. Re-capture it anyway so the pills match the current build.
- **KWQ platter (HOLD):** the strength pill now reads a neutral "Not proven yet" instead of a red "Weak evidence". Re-capture it if the HOLD view is on screen.

## 3. New: Insights lessons (about 3 s)
- After the Insights patterns, show **"Lessons from single cases"** with its TEMPLATE stamp: the incomplete address that sent the planter back (the carrier is labelled mock), and the shipment without tracking.
- Keep the TEMPLATE label in frame. These lessons come from a rules template, not AI.

## 4. New: MCP in "Under the hood" (about 5 s)
- Use the MCP Inspector against the keyless server: `npx @modelcontextprotocol/inspector npm run -s mcp:replay`.
- Show `assess_dispute` on `PP-R-VYZ-10190425`. The result reads `"verdict": "Refund"`, `"seller_cannot_prove_delivery": true` and `"decided_by": "Fixed rules, no AI"`.
- Optionally, show a write tool returning `"sent": false` with `would_send`.
- Label the shot **Replay**. Nothing is sent to PayPal.
- Suggested line: "Any AI assistant gets the same judgement through MCP, and you can try it without keys."
- Before using the Inspector UI in the video, check it shows no third-party marks beyond plain text; crop to the result pane if needed.

## 5. End card URLs
- `video/config.json` already has `demoUrl` (https://dispute-defender-vz4eriizbq-uc.a.run.app) and `repoUrl` (https://github.com/xexpertai/dispute-defender). The end card must show both; `FINAL=1` refuses to render without them.
- The repo URL only works once the repo is public. Render after the visibility change, and open both links before upload.

## 6. Timing and QA
- Total runtime must stay under 3:00. The current cut is 119.9 s, and items 3 and 4 add about 8 s.
- Re-run the full video QA before anyone watches it:
  - frames every 2 s at ≥ 1000 px wide;
  - −14 LUFS integrated, true peak ≤ −1 dBTP;
  - no silence longer than 0.6 s.
- Update `docs/YOUTUBE.md` chapter times if scenes move, then fill `<VIDEO_URL>` in `docs/SUBMISSION.md` after the upload.
