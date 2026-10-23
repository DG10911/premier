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


# ---------------------------------------------------------------- moments
OUTCOME_LABEL = {
    ("shot", "goal"): "GOAL",
    ("shot", "saved"): "SAVED BY KEEPER",
    ("shot", "blocked"): "BLOCKED",
    ("shot", "off_target"): "OFF TARGET",
    ("tackle", "won"): "TACKLE WON",
    ("interception", "won"): "INTERCEPTION",
    ("correction", "disallowed"): "GOAL OVERTURNED",
}


def _score_at(events, t, inclusive=False):
    """(home, away) goals standing before t, revision-aware: a goal that VAR
    has already disallowed by t (a newer revision has arrived) does not count."""
    latest = {}
    for e in events:
        arr = e.get("arrival", e["t"])
        ok = (arr <= t) if inclusive else (arr < t)
        if not ok:
            continue
        cur = latest.get(e["id"])
        if cur is None or e.get("revision", 1) >= cur.get("revision", 1):
            latest[e["id"]] = e
    h = a = 0
    for e in latest.values():
        if e["type"] == "goal" and e.get("outcome") == "scored":
            if e["team"] == "home":
                h += 1
            else:
                a += 1
    return h, a


def build_moments(analysed: dict, corrected=None) -> list:
    """The story of the match: only the moments that changed something."""
    events = analysed["events"]
    meta = analysed["meta"]
    # score is revision-aware: once VAR's revision has arrived, the disallowed goal no longer counts
    score_events = events + ([corrected] if corrected else [])

    shots = [e for e in events if e["type"] == "shot"]
    goals = [e for e in shots if e.get("outcome") == "goal"]
    big = [e for e in shots if e.get("outcome") != "goal" and (e.get("xg") or 0) >= 0.08]
    duels = sorted([e for e in events if e["type"] in ("tackle", "interception")],
                   key=lambda e: -(e.get("xt") or 0))[:3]

    picked = sorted(goals + big + duels, key=lambda e: e["t"])
    if len(picked) > 18:                       # keep the story readable
        keep = set(id(x) for x in goals + duels)
        extra = sorted([e for e in picked if id(e) not in keep],
                       key=lambda e: -(e.get("xg") or 0))[:18 - len(keep)]
        picked = sorted(goals + duels + extra, key=lambda e: e["t"])

    best_xg = 0.0
    out = []
    for e in picked:
        is_home = e["team"] == "home"
        xg = e.get("xg") or 0.0
        best_so_far = xg > best_xg and xg >= 0.10
        best_xg = max(best_xg, xg)

        bh, ba = _score_at(score_events, e["t"])
        ah, aa = bh, ba
        if e["type"] == "shot" and e.get("outcome") == "goal":
            if is_home:
                ah += 1
            else:
                aa += 1

        outcome = OUTCOME_LABEL.get((e["type"], e.get("outcome")), (e.get("outcome") or "").upper())
        # a VAR correction lands on the goal event; match it to its shot moment
        overturned = bool(corrected) and e["type"] == "shot" and e.get("outcome") == "goal" \
            and abs(e["t"] - corrected["t"]) < 2.0 and e["team"] == corrected["team"]
        if overturned:
            outcome = "GOAL OVERTURNED"

        team_name = meta["home"] if is_home else meta["away"]
        player = e.get("player", "—")

        if overturned:
            title = f"{player} scores — later struck off by VAR"
        elif e["type"] == "shot" and e.get("outcome") == "goal":
            title = f"{player} scores for {team_name}"
        elif e["type"] == "shot" and e.get("outcome") == "saved":
            title = f"{player} forces a save"
        elif e["type"] == "shot" and e.get("outcome") == "blocked":
            title = f"{player}'s shot is blocked"
        elif e["type"] == "shot":
            title = f"{player} shoots wide"
        elif e["type"] == "tackle":
            title = f"{player} wins the ball back"
        else:
            title = f"{player} cuts out the pass"

        bits = []
        if e["type"] == "shot":
            bits.append(f"{xg:.2f} xG")
            if best_so_far:
                bits.append("best chance so far")
            if overturned:
                bits.append("struck off after review")
            elif (ah, aa) != (bh, ba):
                bits.append(f"score {bh}–{ba} to {ah}–{aa}")
        else:
            bits.append(f"{e.get('xt', 0):.3f} xT in the danger zone")
            bits.append("possession turned over")
        if e.get("under_pressure"):
            bits.append("under pressure")

        out.append({
            "i": len(out) + 1,
            "t": e["t"], "minute": f"{int(e['t'] // 60)}'",
            "kind": e["type"], "team": e["team"], "player": player,
            "outcome": outcome, "overturned": overturned,
            "title": title, "why": " · ".join(bits),
            "xg": round(xg, 3) if e["type"] == "shot" else None,
            "xt": round(e.get("xt", 0), 4),
            "score_before": f"{bh}–{ba}", "score_after": f"{ah}–{aa}",
            "event_id": e["id"],
            "verify_event_id": corrected["id"] if overturned else e["id"],
            "revision": 1,
            "x": e["x"], "y": e["y"],
            "end_x": e.get("end_x"), "end_y": e.get("end_y"),
            "mirror": (not is_home),
        })
    return out


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
    corrected = None
    if goals:
        g = goals[-1]
        corrected = {"id": g["id"], "t": g["t"], "player": g.get("player"), "team": g["team"]}
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
        "moments": build_moments(analysed, corrected),
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
