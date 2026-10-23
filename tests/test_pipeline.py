"""Tests for the verification rail + the assembled app bundle."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from verify import claim_of, state_at, verify          # noqa: E402
from build import build_bundle                          # noqa: E402


class VerifyTests(unittest.TestCase):
    def test_state_at_is_revision_aware_and_prefix_invariant(self):
        events = [
            {"id": "A", "t": 10, "arrival": 10, "revision": 1, "type": "goal",
             "team": "home", "player": "P", "outcome": "scored", "x": 90, "y": 50},
            {"id": "A", "t": 10, "arrival": 40, "revision": 2, "type": "goal",
             "team": "home", "player": "P", "outcome": "disallowed", "x": 90, "y": 50},
        ]
        self.assertEqual(state_at(events, 30)["score"], {"home": 1, "away": 0})
        self.assertEqual(state_at(events, 50)["score"], {"home": 0, "away": 0})

    def test_verify_accepts_and_blocks(self):
        ev = {"id": "A", "t": 10, "arrival": 10, "revision": 1, "type": "shot",
              "team": "home", "player": "P", "outcome": "saved", "x": 80, "y": 50}
        st = state_at([ev], 20)
        self.assertTrue(verify(claim_of(ev), st)["accepted"])
        for key, val in [("player", "X"), ("team", "away"), ("type", "pass"),
                         ("outcome", "goal"), ("revision", 2)]:
            self.assertFalse(verify({**claim_of(ev), key: val}, st)["accepted"], key)
        self.assertFalse(verify({"kind": "certain_goal", "event_id": "A"}, st)["accepted"])

    def test_invalid_clock(self):
        for bad in (-1, float("nan"), float("inf"), True):
            with self.assertRaises(ValueError):
                state_at([], bad)


class BundleTests(unittest.TestCase):
    def test_correction_and_audit(self):
        b = build_bundle(seed=42)
        self.assertIsNotNone(b["correction"])
        cid = b["correction"]["event_id"]
        # every cue claim must carry a typed fact
        self.assertTrue(all(c["claim"].get("event_id") for c in b["cues"]))
        # the corrected goal's original claim is blocked at end-state; its cue is stale
        stale = [c for c in b["cues"] if c["evidence"][0] == cid and c["kind"] == "goal"]
        end = state_at(b["events"], 10 ** 9)
        for c in stale:
            self.assertFalse(verify(c["claim"], end)["accepted"])
        # correction cue itself is verified
        corr = [c for c in b["cues"] if c["kind"] == "correction"]
        self.assertTrue(corr and verify(corr[0]["claim"], end)["accepted"])
        # audit includes deliberately blocked examples
        self.assertTrue(any(not a["accepted"] for a in b["audit"]))

    def test_moment_scores_respect_var_correction(self):
        b = build_bundle(seed=42)
        at = b["correction"]["at"]
        for m in b["moments"]:
            if m["t"] > at:
                st = state_at(b["events"], m["t"])
                want = f"{st['score']['home']}\u2013{st['score']['away']}"
                self.assertEqual(m["score_before"], want, m["title"])

    def test_deterministic(self):
        self.assertEqual(build_bundle(7)["cues"], build_bundle(7)["cues"])


if __name__ == "__main__":
    unittest.main()
