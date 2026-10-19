"""
ROAR — Interpretation layer.

Event-data-first football analytics, no tracking data required:
  * Expected Threat (xT) learned from the match's own pass network
  * xG (already attached to shots by the generator)
  * action value (xT delta) for passes & carries
  * rolling momentum + in-game win probability
  * a "salience" score = which moments are worth FEELING

Everything here is deterministic and derived from code. This is the evidence
catalog the narrative agents must cite; no number is invented downstream.
"""

from __future__ import annotations

import math
from typing import Dict, List, Tuple

GRID_W = 16   # x cells
GRID_H = 12   # y cells


def _cell(x: float, y: float) -> Tuple[int, int]:
    cx = min(int(x / 100.0 * GRID_W), GRID_W - 1)
    cy = min(int(y / 100.0 * GRID_H), GRID_H - 1)
    return cx, cy


class ExpectedThreat:
    """Grid-based Expected Threat (Karun Singh style), learned from the match.

    xT(cell) = P(shoot)*P(goal|shot) + P(move)*sum(T(cell->cell') * xT(cell'))
    Solved by fixed-point iteration; ~5 iterations is plenty.
    """

    def __init__(self):
        self.shoot = [[0.0] * GRID_H for _ in range(GRID_W)]
        self.goal = [[0.0] * GRID_H for _ in range(GRID_W)]
        self.move = [[0.0] * GRID_H for _ in range(GRID_W)]
        self.trans = [[[[0.0] * GRID_H for _ in range(GRID_W)]
                       for _ in range(GRID_H)] for _ in range(GRID_W)]
        self.xt = [[0.0] * GRID_H for _ in range(GRID_W)]

    def fit(self, events: List[dict], team_of_attacking_dir: Dict[str, bool]):
        self.__init__()  # fit is repeatable; do not accumulate a previous match
        # count visits per cell (attacking-normalised), shots, goals, moves
        counts = [[0.0] * GRID_H for _ in range(GRID_W)]
        for ev in events:
            if ev["type"] not in ("pass", "carry", "shot"):
                continue
            mirrored = not team_of_attacking_dir[ev["team"]]  # away attacks x=100 too
            sx = 100 - ev["x"] if mirrored else ev["x"]
            sy = 100 - ev["y"] if mirrored else ev["y"]
            cx, cy = _cell(sx, sy)
            counts[cx][cy] += 1
            if ev["type"] == "shot":
                self.shoot[cx][cy] += 1
                self.goal[cx][cy] += 1 if ev.get("outcome") == "goal" else 0
            else:
                self.move[cx][cy] += 1
                ex = ev.get("end_x")
                ey = ev.get("end_y")
                if ex is None or ey is None or ev.get("outcome") != "complete":
                    continue
                mx = 100 - ex if mirrored else ex
                my = 100 - ey if mirrored else ey
                dx, dy = _cell(mx, my)
                self.trans[cx][cy][dx][dy] += 1

        for cx in range(GRID_W):
            for cy in range(GRID_H):
                n = counts[cx][cy]
                if n == 0:
                    self.shoot[cx][cy] = 0.0
                    self.move[cx][cy] = 0.0
                    continue
                shots = self.shoot[cx][cy]
                self.goal[cx][cy] = self.goal[cx][cy] / shots if shots else 0.0
                self.shoot[cx][cy] = shots / n
                self.move[cx][cy] /= n
                row_total = 0.0
                for dx in range(GRID_W):
                    for dy in range(GRID_H):
                        row_total += self.trans[cx][cy][dx][dy]
                if row_total > 0:
                    for dx in range(GRID_W):
                        for dy in range(GRID_H):
                            self.trans[cx][cy][dx][dy] /= (self.move[cx][cy] * n)
        # fixed-point iterate
        for _ in range(6):
            new = [[0.0] * GRID_H for _ in range(GRID_W)]
            for cx in range(GRID_W):
                for cy in range(GRID_H):
                    shoot_threat = self.shoot[cx][cy] * self.goal[cx][cy]
                    move_threat = 0.0
                    for dx in range(GRID_W):
                        for dy in range(GRID_H):
                            p = self.trans[cx][cy][dx][dy]
                            if p:
                                move_threat += p * self.xt[dx][dy]
                    new[cx][cy] = shoot_threat + self.move[cx][cy] * move_threat
            self.xt = new
        return self

    def value(self, x: float, y: float, mirrored: bool = False) -> float:
        if x is None or y is None:
            return 0.0
        sx = 100 - x if mirrored else x
        sy = 100 - y if mirrored else y
        cx, cy = _cell(sx, sy)
        return self.xt[cx][cy]


def _win_prob(home_goals, away_goals, minute, xg_home, xg_away, xt_home, xt_away):
    """Simple, monotone in-game win probability for 'home'."""
    remaining = max(0, 90 - minute) / 90.0
    gd = home_goals - away_goals
    chance_edge = (xg_home - xg_away) * 1.6 + (xt_home - xt_away) * 6.0
    logit = gd * (1.1 + 2.2 * (1 - remaining)) + chance_edge * 0.9
    p = 1.0 / (1.0 + math.exp(-logit))
    # shrink to a draw-aware floor
    return round(0.06 + 0.88 * p, 3)


def analyse(payload: dict) -> dict:
    events = payload["events"]
    team_dir = {"home": True, "away": False}

    xt = ExpectedThreat().fit(events, team_dir)

    # per-event enrichment + running aggregates
    xg_home = xg_away = 0.0
    goals_home = goals_away = 0
    xt_home = xt_away = 0.0
    momentum = []          # (t, value) value>0 => home on top
    enriched = []

    for ev in events:
        mirrored = not team_dir[ev["team"]]
        start_v = xt.value(ev["x"], ev["y"], mirrored)
        end_v = xt.value(ev.get("end_x"), ev.get("end_y"), mirrored) if ev.get("end_x") is not None else start_v
        gain = 0.0
        if ev["type"] in ("pass", "carry"):
            gain = (end_v if ev.get("outcome") == "complete" else 0.0) - start_v

        ev_xg = ev.get("xg")
        if ev["type"] == "shot" and ev_xg is not None:
            if ev["team"] == "home":
                xg_home += ev_xg
            else:
                xg_away += ev_xg

        if ev["type"] == "goal":
            if ev["team"] == "home":
                goals_home += 1
            else:
                goals_away += 1

        sign = 1.0 if ev["team"] == "home" else -1.0
        if ev["type"] in ("pass", "carry"):
            if ev["team"] == "home":
                xt_home += max(gain, 0.0)
            else:
                xt_away += max(gain, 0.0)

        wp = _win_prob(goals_home, goals_away, ev["t"] / 60.0,
                       xg_home, xg_away, xt_home, xt_away)

        # salience: how much does this moment deserve to be felt?
        sal = 6.0
        if ev["type"] == "shot":
            sal = 45 + 130 * (ev_xg or 0.0)
        elif ev["type"] == "goal":
            sal = 100.0
        elif ev["type"] in ("pass", "carry"):
            sal = 8 + 90 * max(gain, 0.0)
            if gain > 0.02:
                sal += 12
        elif ev["type"] in ("tackle", "interception"):
            sal = 22 + 60 * max(start_v, 0.0)
        elif ev["type"] == "pressure":
            sal = 16 + 40 * start_v
        if ev.get("under_pressure"):
            sal += 8
        sal = round(min(sal, 100.0), 1)

        row = dict(ev)
        row.update({
            "xt": round(start_v, 4),
            "xt_gain": round(gain, 4),
            "win_prob_home": wp,
            "salience": sal,
            "xg_home": round(xg_home, 3),
            "xg_away": round(xg_away, 3),
            "score": f"{goals_home}-{goals_away}",
            "direction": sign,
        })
        enriched.append(row)
        momentum.append((ev["t"], sign * (max(gain, 0.0) * 40 + (ev_xg or 0.0) * 3)))

    # smooth momentum into 30s buckets
    mom_series = _bucket_momentum(momentum)
    return {
        "meta": payload["meta"],
        "players": payload["players"],
        "events": enriched,
        "xt_grid": xt.xt,
        "momentum": mom_series,
        "summary": {
            "xg_home": round(xg_home, 2),
            "xg_away": round(xg_away, 2),
            "xt_home": round(xt_home, 2),
            "xt_away": round(xt_away, 2),
            "final_win_prob_home": enriched[-1]["win_prob_home"],
        },
    }


def _bucket_momentum(series, bucket=30.0):
    if not series:
        return []
    out = []
    t0 = 0.0
    acc = 0.0
    cur = 0.0
    last_t = series[-1][0]
    idx = 0
    t = 0.0
    while t <= last_t:
        acc = 0.0
        n = 0
        while idx < len(series) and series[idx][0] < t + bucket:
            acc += series[idx][1]
            n += 1
            idx += 1
        out.append({"t": round(t, 1), "v": round(acc, 2)})
        t += bucket
    return out
