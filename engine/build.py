"""
ROAR — build the demo artifacts.

Pipeline:  generator (Ingest) -> analytics (Interpret) -> perception agents
           (Explain) -> verification rail (audit) -> web/app data (Render).

Emits:
  web/app/data.js   : the full bundle the app loads (engine + verification)
  web/app/data.json : same, machine-readable (the "render-ready" output)
  web/perception.json / web/perception-data.js : the legacy overlay bundle

Run:  python3 engine/build.py [seed]
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from generator import generate              # noqa: E402
from analytics import analyse               # noqa: E402
from perception import compile_perception    # noqa: E402
from verify import claim_of, state_at, verify  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "web", "app")
WEB = os.path.join(ROOT, "web")

CORRECTION_CAPTION = {
    "en": {"casual": "VAR check: {player}'s goal is disallowed. The score is updated.",
           "analyst": "Correction — {player} ({team}) goal overturned; revision 2 supersedes revision 1.",
           "cognitive": "That goal is cancelled. The score changed."},
    "es": {"casual": "Revisión VAR: el gol de {player} queda anulado. Marcador actualizado.",
           "analyst": "Corrección — gol de {player} ({team}) anulado; la revisión 2 reemplaza la 1.",
           "cognitive": "Ese gol está anulado. El marcador cambió."},
    "fr": {"casual": "VAR : le but de {player} est refusé. Le score est mis à jour.",
           "analyst": "Correction — but de {player} ({team}) annulé ; la révision 2 remplace la 1.",
           "cognitive": "Ce but est annulé. Le score a changé."},
    "sw": {"casual": "VAR: goli la {player} linafunguliwa. Matokeo yamesahihishwa.",
           "analyst": "Marekebisho — goli la {player} ({team}) limebatilishwa; marekebisho 2 yanachukua nafasi.",
           "cognitive": "Goli hilo limefutwa. Matokeo yamebadilika."},
}


def _correction_cue(goal_ev, corrected, meta):
    team = meta["home"] if goal_ev["team"] == "home" else meta["away"]
    slots = {"player": goal_ev.get("player", ""), "team": team}
    caption = {lang: {r: t.format(**slots) for r, t in reg.items()}
               for lang, reg in CORRECTION_CAPTION.items()}
    return {
        "t": corrected["arrival"], "minute": f"{int(corrected['arrival'] // 60)}'",
        "kind": "correction", "team": goal_ev["team"], "player": goal_ev.get("player"),
        "salience": 100.0, "glyph": {"shape": "ring", "team": goal_ev["team"]},
        "haptic": {"pattern": "double", "intensity": 0.9, "duration_ms": 700},
        "caption": caption, "spatial": {"pan": 0.0, "depth": 0.1, "label": "centre"},
        "evidence": [goal_ev["id"]], "metrics": {"score": "corrected"},
        "vetoed": False, "veto_reason": None,
        "claim": {"kind": "event_fact", "event_id": goal_ev["id"], "revision": 2,
                  "player": goal_ev.get("player"), "team": goal_ev["team"],
                  "type": "goal", "outcome": "disallowed"},
        "correction": {"event_id": goal_ev["id"], "from_revision": 1, "to_revision": 2,
                       "new_outcome": corrected["outcome"]},
    }


def build_bundle(seed: int = 42) -> dict:
    raw = generate(seed=seed)
    analysed = analyse(raw)
    cues = compile_perception(analysed)
    meta = analysed["meta"]

    # 1) event stream with arrival + revision (revision 1 by default)
    events = []
    by_id = {}
    for e in analysed["events"]:
        rec = dict(e)
        rec.setdefault("arrival", e["t"])
        rec.setdefault("revision", 1)
        events.append(rec)
        by_id[e["id"]] = rec

    # 2) correction scenario: the last goal is overturned by VAR after 90s
    goals = [e for e in analysed["events"] if e["type"] == "goal" and e.get("outcome") == "scored"]
    correction = None
    if goals:
        g = goals[-1]
        corrected = dict(by_id[g["id"]])
        corrected["revision"] = 2
        corrected["arrival"] = round(g["t"] + 90, 1)
        corrected["outcome"] = "disallowed"
        events.append(corrected)
        correction = {"event_id": g["id"], "at": corrected["arrival"],
                      "player": g.get("player"), "team": g["team"]}
        cues.append(_correction_cue(g, corrected, meta))
    cues.sort(key=lambda c: c["t"])

    # 3) attach a typed-fact claim to every cue (unless it already carries one)
    for c in cues:
        if "claim" in c:
            continue
        src = by_id.get(c["evidence"][0])
        c["claim"] = claim_of(src) if src else {"kind": "event_fact", "event_id": None}

    # 4) audit snapshot at the end of the match (shows what airs vs what's blocked)
    end_state = state_at(events, 10 ** 9)
    audit = []
    for c in cues:
        v = verify(c["claim"], end_state)
        audit.append({"event_id": c["claim"].get("event_id"),
                      "claim": c["claim"], "accepted": v["accepted"], "reason": v["reason"]})
    # two deliberately bad claims to demonstrate the veto
    sample = by_id[next(iter(by_id))]
    audit.append({"event_id": sample["id"], "claim": {"kind": "certain_goal", "event_id": sample["id"]},
                  "accepted": False, "reason": "Unsupported claim kind. Only typed event facts can air."})
    audit.append({"event_id": sample["id"],
                  "claim": {**claim_of(sample), "player": "Invented Name"},
                  "accepted": False, "reason": "Claim 'player' does not match the source event."})

    return {
        "meta": meta,
        "players": analysed["players"],
        "summary": analysed["summary"],
        "momentum": analysed["momentum"],
        "events": events,
        "cues": cues,
        "correction": correction,
        "audit": audit,
    }


def main(seed: int = 42):
    bundle = build_bundle(seed)

    os.makedirs(APP, exist_ok=True)
    with open(os.path.join(APP, "data.json"), "w") as f:
        json.dump(bundle, f)
    with open(os.path.join(APP, "data.js"), "w") as f:
        f.write("window.ROAR = ")
        json.dump(bundle, f)
        f.write(";\n")

    # legacy overlay bundle (kept in sync for the original broadcast UI)
    with open(os.path.join(WEB, "perception.json"), "w") as f:
        json.dump(bundle, f)
    with open(os.path.join(WEB, "perception-data.js"), "w") as f:
        f.write("window.ROAR_DATA = ")
        json.dump(bundle, f)
        f.write(";\n")

    blocked = sum(1 for a in bundle["audit"] if not a["accepted"])
    print(f"events={len(bundle['events'])}  cues={len(bundle['cues'])}  "
          f"score={bundle['meta']['score']}  "
          f"xG={bundle['summary']['xg_home']}-{bundle['summary']['xg_away']}")
    print(f"correction={bundle['correction']}  audit_blocked={blocked}/{len(bundle['audit'])}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 42)
