# ROAR — The match, for every fan

> **Inside the Game: Developer Hackathon** (Microsoft × Premier League) submission.
>
> 50% of the 177 registered projects are the same product: *"AI broadcast crew /
> personalized explainable multilingual commentary."* **ROAR owns a different
> lane** — it turns synthetic football events into a real-time, **verifiable**,
> **accessible** match experience: a **haptic timeline + visual glyph overlay +
> cited captions**, personalized for every fan.
>
> **Sound off — still felt.** And **every on-screen claim is a typed fact, tied
> to its source event and revision, and checked before it can air.**

---

## What it does

ROAR turns a synthetic match into a **story you can read**: 18 numbered moments,
each with a clear **outcome**, the **score change**, a plain-language explanation,
and the **evidence** behind it. Click any moment to replay it on a 3D pitch; the
ball travels, the outcome lands, and the verification rail checks the claim in
front of you.

Under the hood, synthetic events are compiled through a real multi-agent pipeline
into **cues** — synchronised moments, each carrying:

| Field | Purpose |
|---|---|
| `glyph` | shape + team colour for the on-screen overlay |
| `haptic` | pattern + intensity + duration for wearables / phone vibration |
| `caption` | **3 registers × 4 languages** (casual / analyst / cognitive × en/es/fr/sw) |
| `spatial` | pan + depth, for a directional (spatial-audio) view |
| `claim` + `verdict` | a **typed fact** + the audit result, checked before air |

Nothing is generated without a number behind it. The narrative agents can only
*select and phrase* grounded slots — they cannot invent.

## The five-stage pipeline (mandated by the challenge)

| Stage | Where | What happens |
|---|---|---|
| **1. Ingest** | `engine/generator.py` | Synthetic, football-realistic events — passes, carries, shots, tackles, interceptions, pressure — with xG. No real match data. |
| **2. Interpret** | `engine/analytics.py` | Expected Threat (learned from the match's own pass network), xG, ΔxT, momentum, win probability, salience. |
| **3. Explain** | `engine/perception.py` | Multi-agent layer: Salience → Explain → Glyph → Haptic → Spatial → **Guardrail (veto)** → Director. Grounded captions. |
| **3b. Audit** | `engine/verify.py` | **Verification rail.** Every cue carries a typed fact; a claim airs only if actor, team, type, outcome and revision match the evidence available at the viewer's clock. Supports **live corrections** (a goal overturned by VAR). |
| **4. Render** | `web/app/` | **WebGL stadium** (Three.js): floodlit 105×68 m pitch, a 35k-seat crowd that erupts on goals, LED perimeter boards, rippling goal nets, 22 animated players, ball flight with trail, xG cone, a camera director that cuts every moment like a broadcast (side-on → reverse angle → top-down VAR room). Haptic cues render as **shockwaves on the turf** and a pulsing screen edge, plus real device vibration. |
| **5. Personalize** | `web/app/index.html` | **Mode** (Accessible · Casual · Analyst) selects the caption register and detail level; **Language** (en/es/fr/sw). |

## The verification rail (our differentiator)

The field *claims* grounding; ROAR **proves** it:

- **Typed facts only.** A cue can air only as a typed `event_fact`.
- **Revision-aware.** When VAR overturns a goal, the stream carries a **revision 2**;
  any cue still citing revision 1 becomes **stale** and is blocked, and the score
  updates. Watch the app's `AUDIT` pill flip to **blocked**.
- **Veto demo.** Buttons let you inject an incorrect outcome or an unsupported
  claim kind and see the verifier reject it, with a reason.

## Multi-agent design (Microsoft Agent Framework shape)

```
Match Director (supervisor)
├── SalienceAgent      — which moments deserve to be felt (threshold + cooldown)
├── ExplainAgent       — grounded captions, 3 registers x 4 languages (no free text)
├── GlyphAgent         — moment -> overlay glyph
├── HapticAgent        — moment -> haptic pattern + intensity
├── SpatialAgent       — moment -> directional encoding
└── GuardrailAgent     — VETO: intensity caps, reduced-motion / accessibility limits
Verification rail (verify.py) sits between Explain and Render: nothing airs unverified.
```

On Azure this maps to an Agent Framework supervisor + connected agents, Azure Web
PubSub for the haptic/overlay stream, Cosmos DB + Redis for match state, and Azure
AI Search for the glossary. The local build ships a deterministic, dependency-free
implementation of the same graph so the demo can never fail on stage.

## Run it

No third-party dependencies — Python 3.9+ and any browser.

```bash
python3 engine/build.py            # generate + analyse + explain + verify -> web/app/data.js
python3 -m http.server 8788        # serve from the repo root
# open http://localhost:8788/web/app/
# ?auto=highlights  — 45-second demo cut (goals, a save, a block, the VAR overturn, recap)
# ?auto             — the full 18-moment story
# ?m=16             — jump straight to a moment (0-based); add &mode=analyst&lang=es
```

Regenerate a different match: `python3 engine/build.py <seed>`.
Open on a **phone** (or DevTools device mode) to feel the haptic track.

Tests (all green): `python3 -m unittest discover -s tests`

## Repository layout

```
engine/generator.py    synthetic match generator            (Ingest)
engine/analytics.py    xT / xG / momentum / win-prob        (Interpret)
engine/perception.py   multi-agent perception compiler      (Explain)
engine/verify.py       typed-fact verification rail         (Audit)
engine/build.py        pipeline runner -> web/app/data.js    (Render prep)
web/app/index.html     console HUD: sensory caption, haptic track, verification chain, timeline (Render + Personalize)
web/app/stage.js       Three.js stadium stage + camera director (WebGL)
web/app/vendor/        vendored three.js r186 (MIT) — works offline, no build step
web/app/data.js        the compiled bundle the console loads
tests/                 integrity, verification & bundle tests
```

## Why this wins

- **Owns the #1 white space** — accessibility *beyond audio*; no Deaf/HoH haptic
  entrant exists across all 177 projects.
- **Verification as a product** — revision-aware audit is rarer than commentary;
  here it is a visible, testable rail.
- **Real impact** — broadcast accessibility mandates + hundreds of millions of
  people with disabling hearing loss.
- **Unforgettable demo** — mute the sound and the goal is still *felt*; then watch
  an unsupported claim get **blocked**.
- **Machine-readable, timed, cited** output (App data JSON) built for a broadcast
  rendering partner.
- **Genuine agentic design** with a veto guardrail — not a thin LLM wrapper.

See `.context/winning-concept.md` and `.context/join-strategy.md` for the full
pitch, scorecard, and competitive teardown.
