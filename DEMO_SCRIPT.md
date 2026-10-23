# ROAR — 2-minute demo video script

> Record at **1600×1000** (or 1920×1080), 60 fps, on a machine with a real GPU.
> The app directs itself: open `web/app/?auto=highlights` and record one take.
> The highlights cut runs **~45 s**; the rest of the runtime is the intro and the live audit beat.

## Pre-roll
1. `python3 engine/build.py` (regenerates `web/app/data.js`)
2. `python3 -m http.server 8788`
3. Open `http://localhost:8788/web/app/` (intro) — or `?auto=highlights` to skip straight to the take
4. Hide the browser chrome; full-screen the tab. Start recording, then reload.

## Beat sheet

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:10 | Intro over the live stadium: **SOUND OFF. STILL FELT.** Click *Play the match story*. | "Four hundred and thirty million people can't hear the game. ROAR lets them see it, read it, and feel it." |
| 0:10–0:14 | Camera dives from the stands to the broadcast angle. | "Every moment comes from a synthetic match engine — no real data." |
| 0:14–0:24 | **22′ blocked shot**, **30′ Riverside goal**: name tag, xG cone, ball flight, reverse-angle cam, crowd erupts, net ripples, `GOAL`. | "That goal arrived three ways: the replay, a plain-language caption, and a haptic surge — on your phone, and as a shockwave on screen." |
| 0:24–0:32 | Right panel: *Why it matters* (23% chance, win-chance swing); verification chain lights **Claim → Evidence → Verdict: CLEARED TO AIR**. | "And every caption is a typed fact, checked against its source event before it airs." |
| 0:32–0:50 | 39′ save, 59′ and 64′ Northbridge goals; score bug bumps 0–1 → 1–1 → 2–1. | "Shot by shot, the story stays readable — what happened, why it mattered, what changed." |
| 0:50–1:02 | **68′ goal → VAR**: desaturated top-down VAR room, laser line, `GOAL DISALLOWED`, score rolls back 3–1 → 2–1; chain shows **STALE · BLOCKED**, then **CORRECTION AIRED**. | "At sixty-eight minutes VAR overturns the goal. The event is revised, the old claim goes stale and is blocked, and the score corrects itself." |
| 1:02–1:12 | Full-time recap: *The match, explained.* 2–1, xG, 50 claims cleared / 3 blocked. | "At full time, an automated recap — every number traced to an event." |
| 1:12–1:30 | Click a goal on the timeline; switch **Analyst** + **Español**; hit **Try a false outcome** → BLOCKED. | "Switch register or language and the same verified fact follows the fan. Try to air a false outcome — the verifier refuses." |
| 1:30–1:40 | Hold on the stadium with the haptic track pulsing. | "Ingest, interpret, explain, render, personalize — verified before air. ROAR. Sound off, still felt." |

## Capture notes
- Keep the cursor out of frame until the 1:12 interactive beat.
- Thumbnail: the **GOAL** reverse-angle frame (net ripple + confetti + crowd) with the score bug visible.
- Music bed at −22 dB (royalty-free; no Premier League or broadcast audio).
