"""
ROAR — Synthetic football match generator.

Produces a football-realistic, fully synthetic event stream (no real match
data, no real player names). Deterministic given a seed.

Event schema (SPADL / StatsBomb-inspired, kept intentionally small):

    id, t (seconds from kickoff), minute, second, period,
    type        : kickoff | pass | carry | shot | tackle | interception |
                  pressure | duel | recovery | clearance | foul | goal
    team        : "home" | "away"
    player, player_id
    x, y        : start location, pitch units 0..100 (x: own goal -> opp goal)
    end_x, end_y: end location (passes / carries / shots)
    outcome     : complete | incomplete | saved | blocked | off_target | goal | won | lost
    under_pressure : bool
    body_part   : foot | head | other   (shots)
    xg          : float | None          (shots only, filled by analytics)
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field, asdict
from typing import List, Optional

HOME = "Northbridge FC"
AWAY = "Riverside United"

PITCH_LEN_M = 105.0  # x
PITCH_WID_M = 68.0   # y
GOAL_HALF_W_M = 3.66

# ---------------------------------------------------------------- squad model

FIRST = ["Ari", "Beto", "Cato", "Dario", "Elio", "Femi", "Gio", "Hako", "Ivo",
         "Jonas", "Kito", "Lior", "Milo", "Nero", "Odi", "Pavo", "Quino",
         "Rui", "Sami", "Tavo", "Ugo", "Vik", "Wren", "Xavi", "Yori", "Zeno"]
LAST = ["Vale", "Rourke", "Baskar", "Okafor", "Halden", "Mensa", "Prieto",
        "Kova", "Lindqvist", "Aguilar", "Nkemi", "Toro", "Marsh", "Diallo",
        "Ferrer", "Osman", "Pike", "Vance", "Costa", "Ibarra"]
POSITIONS = ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CM", "LW", "ST", "RW"]

# 4-3-3 base positions in pitch units. Home attacks toward x=100.
BASE_433 = [
    (5, 50),    # GK
    (22, 16), (22, 38), (22, 62), (22, 84),   # back four
    (42, 28), (40, 50), (42, 72),             # midfield three
    (68, 18), (74, 50), (68, 82),             # front three
]


@dataclass
class Player:
    pid: int
    name: str
    number: int
    position: str
    team: str
    base: tuple
    goals: int = 0
    shots: int = 0
    passes: int = 0
    passes_complete: int = 0
    tackles: int = 0
    distance_m: float = 0.0


@dataclass
class Event:
    id: int
    t: float
    period: int
    type: str
    team: str
    player: str
    player_id: int
    x: float
    y: float
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    outcome: str = ""
    under_pressure: bool = False
    body_part: Optional[str] = None
    xg: Optional[float] = None

    def to_dict(self):
        return {k: v for k, v in asdict(self).items() if v is not None}


def _mk_squad(team: str, rng: random.Random, offset: int) -> List[Player]:
    players = []
    used = set()
    for i, (pos, base) in enumerate(zip(POSITIONS, BASE_433)):
        while True:
            name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
            if name not in used:
                used.add(name)
                break
        players.append(Player(pid=offset + i, name=name, number=i + 1,
                              position=pos, team=team, base=base))
    return players


def _mirror(p: Player, team_is_home: bool):
    """Return (x, y) of a base position for the given team's attacking direction."""
    bx, by = p.base
    if team_is_home:
        return bx, by
    return 100 - bx, 100 - by


def _dist_m(x1, y1, x2, y2) -> float:
    dx = (x2 - x1) / 100.0 * PITCH_LEN_M
    dy = (y2 - y1) / 100.0 * PITCH_WID_M
    return math.hypot(dx, dy)


def _xg(x, y, body_part="foot", penalty=False) -> float:
    if penalty:
        return 0.76
    gx, gy = 100.0, 50.0
    dist = _dist_m(x, y, gx, gy)
    dist = max(dist, 1.0)
    # angle subtended by the two posts
    y_m = (y - 50) / 100.0 * PITCH_WID_M
    near = PITCH_LEN_M
    d1 = math.hypot(near - (x / 100.0 * PITCH_LEN_M), GOAL_HALF_W_M - y_m)
    d2 = math.hypot(near - (x / 100.0 * PITCH_LEN_M), -GOAL_HALF_W_M - y_m)
    angle = math.degrees(abs(math.atan2(GOAL_HALF_W_M - y_m, near - x / 100.0 * PITCH_LEN_M)
                             - math.atan2(-GOAL_HALF_W_M - y_m, near - x / 100.0 * PITCH_LEN_M)))
    logit = 4.70 - 2.42 * math.log(dist + 1.0) + 0.015 * (angle - 25.0)
    p = 1.0 / (1.0 + math.exp(-logit))
    if body_part == "head":
        p *= 0.75
    elif body_part == "other":
        p *= 0.85
    return round(min(max(p, 0.002), 0.92), 3)


class MatchSimulator:
    def __init__(self, seed: int = 42, minutes: int = 90):
        self.rng = random.Random(seed)
        self.minutes = minutes
        self.players = {
            "home": _mk_squad(HOME, self.rng, 100),
            "away": _mk_squad(AWAY, self.rng, 200),
        }
        self.events: List[Event] = []
        self.score = {"home": 0, "away": 0}
        self._eid = 0

    # -- helpers -----------------------------------------------------------
    def emit(self, **kw) -> Event:
        self._eid += 1
        t = kw.pop("t")
        period = 1 if t <= 45 * 60 else 2
        mm = int(t // 60)
        ss = int(t % 60)
        ev = Event(id=self._eid, t=round(t, 1), period=period, **kw)
        setattr(ev, "minute", mm)
        setattr(ev, "second", ss)
        self.events.append(ev)
        return ev

    def _team_players(self, team):
        return self.players[team]

    def _pick(self, team, exclude=None) -> Player:
        pool = [p for p in self.players[team] if p.position != "GK" and p is not exclude]
        return self.rng.choice(pool)

    def _zone_progress(self, team, x):
        return x if team == "home" else 100 - x

    # -- main loop ---------------------------------------------------------
    def run(self):
        rng = self.rng
        # kickoff at centre by home
        ko = self._pick("home")
        self.emit(t=0.0, type="kickoff", team="home", player=ko.name,
                  player_id=ko.pid, x=50, y=50, outcome="complete")
        possession = "home"
        x, y = 50.0, 50.0
        carrier = ko
        t = 0.0
        end = self.minutes * 60

        while t < end:
            t += rng.uniform(1.2, 7.5)
            if t >= end:
                break
            prog = self._zone_progress(possession, x)  # 0..100 in attacking dir

            # possible shot?
            shoot_p = 0.0
            if prog > 74:
                shoot_p = 0.05 + (prog - 74) / 26.0 * 0.42
            if rng.random() < shoot_p:
                self._shot(possession, x, y, carrier, t)
                possession = self._other(possession)
                x, y = self._restart_pos(possession)
                carrier = self._pick(possession)
                continue

            # pressure?
            if rng.random() < 0.22:
                d = self._pick(self._other(possession))
                self.emit(t=t, type="pressure", team=self._other(possession), player=d.name,
                          player_id=d.pid, x=x, y=y, outcome="applied")

            # pass or carry
            if rng.random() < 0.72:
                x, y, carrier, turnover = self._pass(possession, x, y, carrier, t)
                if turnover:
                    possession = self._other(possession)
                    x, y = self._restart_pos(possession)
                    carrier = self._pick(possession)
            else:
                x, y = self._carry(possession, x, y, carrier, t)
                # occasional tackle on carry
                if rng.random() < 0.06:
                    d = self._pick(self._other(possession))
                    self.emit(t=t, type="tackle", team=self._other(possession), player=d.name,
                              player_id=d.pid, x=x, y=y, outcome="won")
                    d.tackles += 1
                    possession = self._other(possession)
                    x, y = self._restart_pos(possession)
                    carrier = self._pick(possession)

        # full time
        self.emit(t=float(end), type="fulltime", team="home", player="", player_id=0,
                  x=50, y=50, outcome=f"{self.score['home']}-{self.score['away']}")
        return self.events

    def _other(self, team):
        return "away" if team == "home" else "home"

    def _restart_pos(self, team):
        if team == "home":
            return 30.0, 50.0
        return 70.0, 50.0

    def _pass(self, team, x, y, carrier, t):
        rng = self.rng
        teammates = [p for p in self.players[team] if p.position != "GK"]
        # choose a target biased forward
        def scorep(p):
            px, py = _mirror(p, team == "home")
            forward = self._zone_progress(team, px) - self._zone_progress(team, x)
            return forward + rng.uniform(-6, 6)
        target = max(teammates, key=scorep)
        tx, ty = _mirror(target, team == "home")
        dist = _dist_m(x, y, tx, ty)
        carrier.passes += 1
        # completion probability: long passes & pressure reduce it
        p_complete = 0.955 - dist / 62.0 * 0.55
        pressure = rng.random() < 0.25
        if pressure:
            p_complete -= 0.13
        p_complete = min(max(p_complete, 0.25), 0.98)
        complete = rng.random() < p_complete
        if complete:
            carrier.passes_complete += 1
            self.emit(t=t, type="pass", team=team, player=carrier.name,
                      player_id=carrier.pid, x=round(x, 1), y=round(y, 1),
                      end_x=round(tx, 1), end_y=round(ty, 1), outcome="complete",
                      under_pressure=pressure)
            return tx, ty, target, False
        else:
            self.emit(t=t, type="pass", team=team, player=carrier.name,
                      player_id=carrier.pid, x=round(x, 1), y=round(y, 1),
                      end_x=round((x + tx) / 2, 1), end_y=round((y + ty) / 2, 1),
                      outcome="incomplete", under_pressure=pressure)
            # interception by nearest opponent
            opp = self._pick(self._other(team))
            self.emit(t=t + 0.4, type="interception", team=self._other(team), player=opp.name,
                      player_id=opp.pid, x=round((x + tx) / 2, 1), y=round((y + ty) / 2, 1),
                      outcome="won")
            return tx, ty, target, True

    def _carry(self, team, x, y, carrier, t):
        rng = self.rng
        dirn = 1 if team == "home" else -1
        nx = min(max(x + dirn * rng.uniform(2, 12), 2), 98)
        ny = min(max(y + rng.uniform(-9, 9), 3), 97)
        carrier.distance_m += _dist_m(x, y, nx, ny)
        self.emit(t=t, type="carry", team=team, player=carrier.name,
                  player_id=carrier.pid, x=round(x, 1), y=round(y, 1),
                  end_x=round(nx, 1), end_y=round(ny, 1), outcome="complete")
        return nx, ny

    def _shot(self, team, x, y, carrier, t):
        rng = self.rng
        body = rng.choices(["foot", "head", "other"], weights=[0.78, 0.18, 0.04])[0]
        penalty = rng.random() < 0.05
        if penalty:
            sx, sy = (84, 50) if team == "home" else (16, 50)
        else:
            sx, sy = x, y
        # xG is computed in the team's attacking frame (goal always at x=100)
        eff_x = sx if team == "home" else 100.0 - sx
        g = _xg(eff_x, sy, body, penalty)
        goal_x = 100 if team == "home" else 0
        carrier.shots += 1
        if rng.random() < g:
            outcome = "goal"
            self.score[team] += 1
            carrier.goals += 1
            self.emit(t=t, type="shot", team=team, player=carrier.name,
                      player_id=carrier.pid, x=round(sx, 1), y=round(sy, 1),
                      end_x=goal_x, end_y=50, outcome=outcome,
                      body_part=body, xg=g)
            self.emit(t=t + 0.6, type="goal", team=team, player=carrier.name,
                      player_id=carrier.pid, x=round(sx, 1), y=round(sy, 1),
                      outcome="scored", xg=g)
        else:
            outcome = rng.choices(["saved", "blocked", "off_target"], weights=[0.45, 0.3, 0.25])[0]
            self.emit(t=t, type="shot", team=team, player=carrier.name,
                      player_id=carrier.pid, x=round(sx, 1), y=round(sy, 1),
                      end_x=goal_x, end_y=50 + rng.uniform(-6, 6), outcome=outcome,
                      body_part=body, xg=g)


def generate(seed: int = 42, minutes: int = 90):
    sim = MatchSimulator(seed=seed, minutes=minutes)
    events = sim.run()
    payload = {
        "meta": {
            "home": HOME,
            "away": AWAY,
            "score": sim.score,
            "seed": seed,
            "minutes": minutes,
        },
        "players": [
            {
                "id": p.pid, "name": p.name, "number": p.number,
                "position": p.position, "team": p.team,
                "base_x": p.base[0], "base_y": p.base[1],
            }
            for team in ("home", "away") for p in sim.players[team]
        ],
        "events": [e.to_dict() for e in events],
    }
    return payload


if __name__ == "__main__":
    data = generate()
    print(json.dumps({
        "events": len(data["events"]),
        "score": data["meta"]["score"],
        "shots": sum(1 for e in data["events"] if e["type"] == "shot"),
    }, indent=2))
