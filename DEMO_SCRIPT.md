# ROAR — 2-minute demo video script

> Record at **1600×1000** (or 1920×1080). Open `web/app/index.html?demo=1` and
> screen-record in one take — the app auto-directs the whole story.
> Total runtime **~85 s**, leaving headroom under the 2:00 hard cap.

## Pre-roll (before recording)
1. `python3 engine/build.py` (regenerates `web/app/data.js`)
2. `python3 -m http.server 8788`
3. Open `http://localhost:8788/web/app/?demo=1`
4. Hide the browser chrome / bookmarks bar. Full-screen the tab.
5. Start recording, then reload the tab so the take begins at 0:00.

## Beat sheet (what the auto-director does)

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:04 | Title card: **SOUND OFF. STILL FELT.** | "Every fan feels the game. Four hundred and thirty million people can't hear it." |
| 0:04–0:12 | Replay starts, pitch tilts into 3D, ball moves | "ROAR turns a synthetic match into a sensory broadcast — haptics, glyphs and captions." |
| 0:12–0:20 | **GOAL** — kinetic type, light sweep, shockwave, stadium flash | "That goal arrived three ways: you saw it, you read it, you felt it." |
| 0:20–0:27 | Switch to **Analyst** | "Switch mode and the same moment gets a different register — xG, ΔxT, win probability." |
| 0:27–0:34 | Switch to **Español**, Accessible | "Switch language or accessibility profile and the intelligence follows the fan." |
| 0:34–0:45 | Scrub to 68′, VAR banner, correction fires | "At 68 minutes, VAR overturns the goal. Revision 2 enters the stream." |
| 0:45–0:50 | Score drops, cue struck through, audit pill **BLOCKED** | "The stale claim is blocked before it can air. The score corrects itself." |
| 0:50–1:06 | Click **Test an incorrect outcome** then **unsupported claim** | "Try to air a false outcome, or a claim type we don't support — the verifier refuses." |
| 1:06–1:14 | Full time, final score | "Every number comes from code. Every sentence cites the event that produced it." |
| 1:14–1:25 | End card: **ROAR** + pipeline | "Ingest, Interpret, Explain, Render, Personalize — verified before air." |

## Voiceover (full read, ~150 words)

> Every fan feels the game. Four hundred and thirty million people can't hear it.
> ROAR turns a synthetic match into a sensory broadcast: a haptic timeline, a
> visual glyph overlay, and captions that cite the exact event behind them.
>
> That goal arrived three ways — you saw it, you read it, you felt it. Switch to
> Analyst and the same moment opens up: expected goals, threat gained, win
> probability. Switch language or accessibility profile and the intelligence
> follows the fan, not the other way round.
>
> At sixty-eight minutes, VAR overturns the goal. A revision enters the stream.
> ROAR blocks the stale claim before it can air and corrects the score on screen.
> Try to air a false outcome, or a claim type we don't support — the verifier
> refuses. Every number comes from code; every sentence cites its evidence.
>
> Ingest, Interpret, Explain, Render, Personalize. Verified before air.
> ROAR. Sound off — still felt.

## Shot list / capture notes
- **Do not** show a mouse cursor wandering; the demo director drives everything.
- If you need a second take of just the audit beat: `?t=4300&auto=1`, then click the two test buttons.
- If the recording tool supports it, capture at **60 fps** — the parallax and beams read much better.
- Add a subtle music bed at −22 dB (royalty-free; do **not** use Premier League or broadcast audio).

## Thumbnail / social card
Use a still at the **GOAL** beat (t≈12s): kinetic gold "GOAL" over the tilted 3D pitch,
with the score bug and the verified audit pill visible.
