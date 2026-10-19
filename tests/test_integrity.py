"""Regression tests for numerical and caption failures found in the audit."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from analytics import ExpectedThreat, analyse, _cell
from generator import generate
from perception import ExplainAgent, compile_perception


class IntegrityTests(unittest.TestCase):
    def test_shot_probability_uses_shot_count(self):
        events = [dict(type="shot", team="home", x=95, y=50, outcome=o)
                  for o in ["goal", "saved"]]
        events += [dict(type="pass", team="home", x=95, y=50,
                        end_x=10, end_y=10, outcome="complete") for _ in range(8)]
        model = ExpectedThreat().fit(events, {"home": True})
        x, y = _cell(95, 50)
        self.assertAlmostEqual(model.goal[x][y], 0.5)
        self.assertAlmostEqual(model.xt[x][y], 0.1)
        before = model.xt
        self.assertEqual(model.fit(events, {"home": True}).xt, before)

    def test_failed_move_has_zero_transition_probability(self):
        events = [dict(type="pass", team="home", x=10, y=50,
                       end_x=95, end_y=50, outcome="incomplete"),
                  dict(type="shot", team="home", x=95, y=50, outcome="goal")]
        model = ExpectedThreat().fit(events, {"home": True})
        self.assertEqual(model.value(10, 50), 0)

    def test_match_invariants_and_evidence(self):
        for seed in [1, 42, 100]:
            raw = generate(seed=seed)
            self.assertEqual(raw, generate(seed=seed))
            result = analyse(raw)
            self.assertTrue(all(0 <= v <= 1 for col in result["xt_grid"] for v in col))
            events = {e["id"]: e for e in result["events"]}
            for e in events.values():
                if e["type"] == "pass" and e["outcome"] == "incomplete":
                    self.assertLessEqual(e["xt_gain"], 0)
                if e["type"] not in ("pass", "carry"):
                    self.assertEqual(e["xt_gain"], 0)
            for cue in compile_perception(result):
                ev = events[cue["evidence"][0]]
                self.assertEqual(cue["t"], ev["t"])
                for key, value in cue["metrics"].items():
                    self.assertEqual(value, ev.get(key))
                self.assertEqual(set(cue["caption"]), {"en", "es", "fr", "sw"})

    def test_shot_captions_do_not_invent_save_or_miss(self):
        explain = ExplainAgent()
        for outcome in ["saved", "blocked", "off_target", "goal"]:
            ev = dict(type="shot", team="home", player="Ari", xg=.2, outcome=outcome)
            captions = explain.captions(ev, "chance", {"xg": .2}, {"home": "H", "away": "A"})
            self.assertNotIn("save", captions["en"]["casual"])
            self.assertNotIn("did not go in", captions["en"]["cognitive"])

    def test_recap_does_not_relabel_xg_as_xt(self):
        result = analyse(generate())
        recap = compile_perception(result)[-1]["caption"]["en"]["analyst"]
        self.assertNotIn("xT", recap)
        self.assertIn("xG", recap)


if __name__ == "__main__":
    unittest.main()
