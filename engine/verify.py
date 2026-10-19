"""
ROAR — Verification rail (typed-fact audit).

Every claim that can reach the screen must reduce to a typed fact about a
single event, at a specific revision. The verifier accepts a claim only if the
actor, team, event type, outcome and revision exactly match the evidence that
is available at the viewer's clock. Anything else is blocked before air.

This is the "audit-as-product" rail: it is what turns a generative pipeline
into something a studio can put on air.
"""

from __future__ import annotations

from copy import deepcopy
from math import isfinite
from typing import Dict, List, Optional

CLAIM_FIELDS = ("player", "team", "type", "outcome")


def claim_of(ev: dict) -> dict:
    return {
        "kind": "event_fact",
        "event_id": ev["id"],
        "revision": ev.get("revision", 1),
        **{k: ev.get(k) for k in CLAIM_FIELDS},
    }


def state_at(events: List[dict], clock: float) -> dict:
    """Revision-aware state: newest revision of each event available at `clock`."""
    if isinstance(clock, bool) or not isinstance(clock, (int, float)) or not isfinite(clock) or clock < 0:
        raise ValueError("clock must be a finite, non-negative number")
    latest: Dict[str, dict] = {}
    for e in sorted(events, key=lambda x: (x.get("arrival", x["t"]), x["id"], x.get("revision", 1))):
        if e.get("arrival", e["t"]) > clock:
            continue
        cur = latest.get(e["id"])
        if cur is None or e.get("revision", 1) >= cur.get("revision", 1):
            latest[e["id"]] = deepcopy(e)
    ordered = sorted(latest.values(), key=lambda e: (e.get("arrival", e["t"]), e["id"]))
    score = {t: sum(1 for e in ordered if e["type"] == "goal" and e.get("outcome") == "scored" and e.get("team") == t)
             for t in ("home", "away")}
    return {
        "events": ordered,
        "score": score,
        "version": "|".join(f'{e["id"]}:{e.get("revision", 1)}' for e in ordered),
    }


def verify(claim: dict, state: dict) -> dict:
    if not isinstance(claim, dict) or claim.get("kind") != "event_fact":
        return {"accepted": False, "reason": "Unsupported claim kind. Only typed event facts can air."}
    ev: Optional[dict] = next((e for e in state["events"] if e["id"] == claim.get("event_id")), None)
    if ev is None:
        return {"accepted": False, "reason": "Evidence is not available at this viewer time."}
    if claim.get("revision", 1) != ev.get("revision", 1):
        return {"accepted": False, "reason": "Evidence revision is stale (the event was corrected)."}
    for k in CLAIM_FIELDS:
        if claim.get(k) != ev.get(k):
            return {"accepted": False, "reason": f"Claim {k!r} does not match the source event."}
    return {"accepted": True, "reason": "Actor, team, type, outcome and revision match the evidence."}
