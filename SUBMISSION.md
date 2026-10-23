# ROAR — submission copy

## Elevator pitch (short)
ROAR turns synthetic football events into a real-time, **verifiable**, **accessible**
match experience. It compiles events into a sensory broadcast — haptic timeline,
visual glyph overlay, and cited captions — and blocks every claim that can't be
traced to its source event and revision. Sound off, still felt.

## Long description
Football stories don't start and end with the scoreline — but most AI match tools
stop at commentary. ROAR is a **perception engine**: it takes a synthetic event
stream (passes, carries, shots, tackles, pressure, goals) and turns it into the
moments a fan can actually *feel*.

A supervisor agent graph scores every event for **salience**, maps it to a haptic
pattern, a glyph, and grounded captions in **three registers × four languages**,
and a guardrail agent caps intensity for accessibility. Every cue carries a
**typed fact** — actor, team, event type, outcome, revision — and the verification
rail refuses to air anything that doesn't match the evidence available at the
viewer's clock. When VAR overturns a goal, revision 2 enters the stream, the stale
claim is blocked, and the score corrects itself on screen.

The result is a broadcast-ready console: a 3D pitch, cinematic transitions,
win-probability, xG and momentum — personalized for **Accessible**, **Casual** and
**Analyst** viewers, in English, Spanish, French and Kiswahili.

## What we built (five mandated stages)
1. **Ingest** — `engine/generator.py`: deterministic synthetic match (1,700+ events).
2. **Interpret** — `engine/analytics.py`: Expected Threat learned from the match's
   own pass network, xG, ΔxT, momentum, in-game win probability, salience.
3. **Explain** — `engine/perception.py`: multi-agent supervisor + specialists.
4. **Render** — `web/app/`: WebGL stadium replay, glyphs, haptics (vibration + on-screen shockwaves), captions, verification chain.
5. **Personalize** — mode × language × focus, driven by viewer profile.

Plus the differentiator: **`engine/verify.py`** — a revision-aware typed-fact audit
rail that sits between Explain and Render.

## Microsoft / Azure technologies
- **Microsoft Foundry** — agent hosting + evaluation harness for caption quality.
- **Microsoft Agent Framework** — supervisor + connected agents (the local build
  ships the same graph deterministically so the demo cannot fail).
- **Azure MCP** — tools exposed to the agents for match-state and stat lookups.
- **Azure Web PubSub / SignalR** — low-latency haptic + overlay fan-out.
- **Azure Cosmos DB + Redis** — match state and hot cache (<500 ms target).
- **Azure AI Search** — grounded glossary / Laws / terminology retrieval.
- **Azure Functions / Container Apps** — cloud-native ingest and scaling.
- **Microsoft Fabric** — medallion pipeline for the synthetic dataset.

## Categories
- Grand Prize (primary)
- **Best Multi-Agent System** — supervisor + specialists + veto guardrail.
- **Best Use of Microsoft Foundry** — agent hosting + eval.
- **Best Azure Cloud Native** — Functions/Container Apps + PubSub + Cosmos/Redis.

## Data & compliance
All data is **synthetic and football-realistic**; clubs and players are fictional
(Northbridge FC, Riverside United). No Premier League footage, logos, marks or real
match data are used or redistributed. Visuals are drawn procedurally in-browser —
no third-party image assets.

## Links
- Repo: `https://github.com/DG10911/premier`
- Demo: `http://localhost:8788/web/app/?auto=highlights` (local; see README to run)
