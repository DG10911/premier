"""
ROAR — The Perception Engine.

A deterministic specialist pipeline (the same shape you'd deploy on Microsoft
Agent Framework: a supervisor + specialist agents + a veto guardrail) that
compiles an enriched event stream into the **Perception IR**: a timed list of
synchronised cues, each carrying

    * a glyph (for the visual overlay)
    * a haptic pattern (for wearables / phone vibration)
    * captions in THREE registers x FOUR languages (casual | analyst | cognitive
      x en | es | fr | sw)
    * an evidence bundle (event ids + the exact numbers behind it)

Captions use templates and event-linked metrics. This does not guarantee semantic
correctness; the regression suite covers known errors. No LLM adapter is implemented.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, List, Optional

LANGS = ["en", "es", "fr", "sw"]


@dataclass
class Cue:
    t: float
    minute: str
    kind: str
    team: Optional[str]
    player: Optional[str]
    salience: float
    glyph: Dict
    haptic: Dict
    caption: Dict          # lang -> register -> text
    spatial: Dict
    evidence: List[int]
    metrics: Dict
    vetoed: bool = False
    veto_reason: Optional[str] = None


# --------------------------------------------------------------------- agents

class SalienceAgent:
    """Decides which moments deserve to be emitted at all (the hard problem)."""
    THRESHOLD = 34.0
    COOLDOWN = 9.0

    def __init__(self):
        self.last_emit_t = -999.0

    def should_emit(self, ev) -> bool:
        if ev["type"] in ("goal", "kickoff", "fulltime"):
            return True
        if ev["salience"] < self.THRESHOLD:
            return False
        if ev["t"] - self.last_emit_t < self.COOLDOWN:
            return False
        self.last_emit_t = ev["t"]
        return True


# --- grounded caption templates (no free text, only slots) -------------------
# Slots: player, team, type, score, xg, xt, gain, wp, outcome, xgh, xga, home, away
T = {
 "goal": {
  "en": {"casual": "GOAL! {player} scores for {team}. {score}.",
         "analyst": "Goal — {player} ({team}), xG {xg}. Score {score}; home win prob {wp}%.",
         "cognitive": "Goal. {player} scored. The score is {score}."},
  "es": {"casual": "¡GOL! {player} marca para {team}. {score}.",
         "analyst": "Gol — {player} ({team}), xG {xg}. Marcador {score}; prob. victoria local {wp}%.",
         "cognitive": "Gol. {player} marcó. El marcador es {score}."},
  "fr": {"casual": "BUT ! {player} marque pour {team}. {score}.",
         "analyst": "But — {player} ({team}), xG {xg}. Score {score} ; prob. victoire domicile {wp}%.",
         "cognitive": "But. {player} a marqué. Le score est {score}."},
  "sw": {"casual": "GOLI! {player} afunga kwa {team}. {score}.",
         "analyst": "Goli — {player} ({team}), xG {xg}. Matokeo {score}; nafasi ya ushindi wa nyumbani {wp}%.",
         "cognitive": "Goli. {player} alifunga. Matokeo ni {score}."},
 },
 "chance": {
  "en": {"casual": "Shot by {player}. xG {xg}.",
         "analyst": "Shot — {player} ({team}), xG {xg}, {outcome}. ΔxT {gain}.",
         "cognitive": "{player} took a shot."},
  "es": {"casual": "Remate de {player}. xG {xg}.",
         "analyst": "Remate — {player} ({team}), xG {xg}, {outcome}. ΔxT {gain}.",
         "cognitive": "{player} remató."},
  "fr": {"casual": "Tir de {player}. xG {xg}.",
         "analyst": "Tir — {player} ({team}), xG {xg}, {outcome}. ΔxT {gain}.",
         "cognitive": "{player} a tiré."},
  "sw": {"casual": "Shuti la {player}. xG {xg}.",
         "analyst": "Shuti — {player} ({team}), xG {xg}, {outcome}. ΔxT {gain}.",
         "cognitive": "{player} alipiga shuti."},
 },
 "danger": {
  "en": {"casual": "Danger! {player} ({team}) shoots, xG {xg}.",
         "analyst": "Low-quality shot — {player}, xG {xg}, {outcome}.",
         "cognitive": "{player} had a try at goal."},
  "es": {"casual": "¡Peligro! {player} ({team}) remata, xG {xg}.",
         "analyst": "Remate de baja calidad — {player}, xG {xg}, {outcome}.",
         "cognitive": "{player} intentó marcar."},
  "fr": {"casual": "Danger ! {player} ({team}) tire, xG {xg}.",
         "analyst": "Tir de faible qualité — {player}, xG {xg}, {outcome}.",
         "cognitive": "{player} a tenté de marquer."},
  "sw": {"casual": "Hatari! {player} ({team}) anapiga, xG {xg}.",
         "analyst": "Shuti dhaifu — {player}, xG {xg}, {outcome}.",
         "cognitive": "{player} alijaribu kufunga."},
 },
 "press": {
  "en": {"casual": "{player} wins it back for {team}!",
         "analyst": "{type} won by {player} ({team}) at xT {xt} — possession value denied.",
         "cognitive": "{player} won the ball back."},
  "es": {"casual": "¡{player} recupera para {team}!",
         "analyst": "{type} ganada por {player} ({team}) con xT {xt}.",
         "cognitive": "{player} recuperó el balón."},
  "fr": {"casual": "{player} récupère pour {team} !",
         "analyst": "{type} récupérée par {player} ({team}) à xT {xt}.",
         "cognitive": "{player} a récupéré le ballon."},
  "sw": {"casual": "{player} anarejesha mpira kwa {team}!",
         "analyst": "{type} inashindwa na {player} ({team}) kwa xT {xt}.",
         "cognitive": "{player} alirudisha mpira."},
 },
 "build": {
  "en": {"casual": "{player} drives {team} forward.",
         "analyst": "Progressive {type} by {player} ({team}): {gain} xT, ball into a high-threat zone.",
         "cognitive": "{player} moved the ball forward."},
  "es": {"casual": "{player} impulsa a {team}.",
         "analyst": "{type} progresivo de {player} ({team}): {gain} xT.",
         "cognitive": "{player} movió el balón hacia delante."},
  "fr": {"casual": "{player} fait avancer {team}.",
         "analyst": "{type} progressif de {player} ({team}) : {gain} xT.",
         "cognitive": "{player} a fait avancer le ballon."},
  "sw": {"casual": "{player} anasogeza {team} mbele.",
         "analyst": "{type} ya maendeleo na {player} ({team}): {gain} xT.",
         "cognitive": "{player} alisogeza mpira mbele."},
 },
 "tension": {
  "en": {"casual": "Pressure building on {team}.",
         "analyst": "Pressing event — {team} under pressure at xT {xt}; turnover risk rising.",
         "cognitive": "There is pressure on {team}."},
  "es": {"casual": "Presión sobre {team}.",
         "analyst": "Presión — {team} bajo presión con xT {xt}.",
         "cognitive": "Hay presión sobre {team}."},
  "fr": {"casual": "La pression monte sur {team}.",
         "analyst": "Pressing — {team} sous pression à xT {xt}.",
         "cognitive": "Il y a de la pression sur {team}."},
  "sw": {"casual": "Shinikizo linaongezeka kwa {team}.",
         "analyst": "Shinikizo — {team} chini ya shinikizo kwa xT {xt}.",
         "cognitive": "Kuna shinikizo kwa {team}."},
 },
 "kickoff": {
  "en": {"casual": "Kick-off: {home} vs {away}.", "analyst": "Kick-off: {home} vs {away}.", "cognitive": "Kick-off: {home} vs {away}."},
  "es": {"casual": "Comienza el partido: {home} vs {away}.", "analyst": "Comienza el partido: {home} vs {away}.", "cognitive": "Comienza el partido: {home} vs {away}."},
  "fr": {"casual": "Coup d'envoi : {home} vs {away}.", "analyst": "Coup d'envoi : {home} vs {away}.", "cognitive": "Coup d'envoi : {home} vs {away}."},
  "sw": {"casual": "Kuanza kwa mchezo: {home} vs {away}.", "analyst": "Kuanza kwa mchezo: {home} vs {away}.", "cognitive": "Kuanza kwa mchezo: {home} vs {away}."},
 },
 "fulltime": {
  "en": {"casual": "Full-time: {score}.", "analyst": "Full-time {score}. xG {xgh}–{xga}.", "cognitive": "The match is over. Final score {score}."},
  "es": {"casual": "Final: {score}.", "analyst": "Final {score}. xG {xgh}–{xga}.", "cognitive": "El partido terminó. Marcador final {score}."},
  "fr": {"casual": "Fin du match : {score}.", "analyst": "Fin du match {score}. xG {xgh}–{xga}.", "cognitive": "Le match est terminé. Score final {score}."},
  "sw": {"casual": "Mchezo umeisha: {score}.", "analyst": "Mchezo umeisha {score}. xG {xgh}–{xga}.", "cognitive": "Mchezo umeisha. Matokeo ya mwisho {score}."},
 },
 "calm": {
  "en": {"casual": "{player} keeps it simple for {team}.", "analyst": "{type} by {player} ({team}), xT {xt}.", "cognitive": "{player} has the ball."},
  "es": {"casual": "{player} juega sencillo para {team}.", "analyst": "{type} de {player} ({team}), xT {xt}.", "cognitive": "{player} tiene el balón."},
  "fr": {"casual": "{player} joue simple pour {team}.", "analyst": "{type} de {player} ({team}), xT {xt}.", "cognitive": "{player} a le ballon."},
  "sw": {"casual": "{player} anacheza kwa urahisi kwa {team}.", "analyst": "{type} na {player} ({team}), xT {xt}.", "cognitive": "{player} ana mpira."},
 },
}


class ExplainAgent:
    """Phrases grounded captions in 3 registers x 4 languages. Numbers from evidence."""

    @staticmethod
    def kind_of(ev) -> str:
        if ev["type"] == "goal":
            return "goal"
        if ev["type"] == "shot":
            return "chance" if (ev.get("xg") or 0) >= 0.12 else "danger"
        if ev["type"] in ("tackle", "interception"):
            return "press"
        if ev["type"] in ("pass", "carry"):
            return "build" if ev.get("xt_gain", 0) > 0.03 else "calm"
        if ev["type"] == "pressure":
            return "tension"
        if ev["type"] == "kickoff":
            return "kickoff"
        if ev["type"] == "fulltime":
            return "fulltime"
        return "calm"

    @staticmethod
    def team_name(team, meta):
        return meta["home"] if team == "home" else (meta["away"] if team == "away" else "")

    def captions(self, ev, kind, metrics, meta) -> Dict:
        tname = self.team_name(ev["team"], meta)
        slots = {
            "player": ev.get("player") or tname,
            "team": tname,
            "type": (ev["type"] or "").capitalize(),
            "outcome": ev.get("outcome", ""),
            "score": metrics.get("score", ""),
            "xg": (f"{metrics['xg']:.2f}" if metrics.get("xg") is not None else "—"),
            "xt": (f"{metrics['xt']:.3f}" if metrics.get("xt") is not None else "—"),
            "gain": (f"{metrics.get('xt_gain', 0):+.3f}"),
            "wp": f"{int((metrics.get('win_prob_home') or 0)*100)}",
            "xgh": (f"{metrics.get('xg_home', 0):.2f}"),
            "xga": (f"{metrics.get('xg_away', 0):.2f}"),
            "home": meta["home"],
            "away": meta["away"],
        }
        out = {}
        for lang in LANGS:
            reg = T[kind][lang]
            out[lang] = {r: reg[r].format(**slots) for r in ("casual", "analyst", "cognitive")}
        return out


class HapticAgent:
    PATTERNS = {"goal": "surge", "chance": "pulse", "danger": "tap",
                "press": "rumble", "build": "wave", "calm": "flat",
                "tension": "tighten", "kickoff": "double", "fulltime": "double"}

    def encode(self, kind, salience) -> Dict:
        intensity = round(min(max(salience / 100.0, 0.15), 1.0), 2)
        dur = {"goal": 900, "chance": 420, "danger": 220, "press": 300,
               "build": 360, "calm": 120, "tension": 520,
               "kickoff": 700, "fulltime": 700}.get(kind, 300)
        return {"pattern": self.PATTERNS.get(kind, "tap"), "intensity": intensity,
                "duration_ms": dur}


class GlyphAgent:
    GLYPHS = {"goal": "burst", "chance": "target", "danger": "shard",
              "press": "grip", "build": "arrow", "calm": "dot",
              "tension": "coil", "kickoff": "ring", "fulltime": "ring"}

    def glyph(self, kind, team):
        return {"shape": self.GLYPHS.get(kind, "dot"), "team": team}


class SpatialAgent:
    def encode(self, ev) -> Dict:
        y = ev.get("y", 50)
        pan = round((y - 50) / 50.0, 2)
        return {"pan": pan, "depth": round(1 - ev.get("x", 50) / 100.0, 2),
                "label": "left" if pan < -0.2 else ("right" if pan > 0.2 else "centre")}


class GuardrailAgent:
    """Accessibility + safety veto: caps intensity; has VETO power."""
    MAX_INTENSITY = 1.0
    CALM_CAP = 0.35

    def review(self, cue: Cue) -> Cue:
        if cue.kind == "calm" and cue.haptic["intensity"] > self.CALM_CAP:
            cue.haptic["intensity"] = self.CALM_CAP
        if cue.haptic["intensity"] > self.MAX_INTENSITY:
            cue.haptic["intensity"] = self.MAX_INTENSITY
        return cue


class DirectorAgent:
    """Supervisor. Runs the pipeline and assembles the Perception IR."""

    def __init__(self, meta):
        self.meta = meta
        self.salience = SalienceAgent()
        self.explain = ExplainAgent()
        self.haptic = HapticAgent()
        self.glyph = GlyphAgent()
        self.spatial = SpatialAgent()
        self.guardrail = GuardrailAgent()

    def compile(self, events: List[dict]) -> List[Cue]:
        cues: List[Cue] = []
        for ev in events:
            if not self.salience.should_emit(ev):
                continue
            kind = self.explain.kind_of(ev)
            metrics = {
                "xg": ev.get("xg"), "xt": ev.get("xt"), "xt_gain": ev.get("xt_gain"),
                "win_prob_home": ev.get("win_prob_home"), "score": ev.get("score"),
                "xg_home": ev.get("xg_home"), "xg_away": ev.get("xg_away"),
                "xt_home": ev.get("xt_home"), "xt_away": ev.get("xt_away"),
            }
            cue = Cue(
                t=ev["t"], minute=f"{int(ev['t'] // 60)}'", kind=kind,
                team=ev.get("team"), player=ev.get("player"), salience=ev["salience"],
                glyph=self.glyph.glyph(kind, ev.get("team")),
                haptic=self.haptic.encode(kind, ev["salience"]),
                caption=self.explain.captions(ev, kind, metrics, self.meta),
                spatial=self.spatial.encode(ev), evidence=[ev["id"]], metrics=metrics,
            )
            cues.append(self.guardrail.review(cue))
        return cues


def compile_perception(analysed: dict) -> List[dict]:
    director = DirectorAgent(analysed["meta"])
    return [asdict(c) for c in director.compile(analysed["events"])]
