"""
profile.py — per-user learning from satisfaction feedback.

Deliberately transparent, not a black box. The profile is a JSON file a human
can read. Learning is empirical counting, and every adjustment comes with a
plain-English note explaining WHY it overrode the brain.

Mechanics:
  * Every rated turn records (bucket, tier, effort, satisfied). "bucket" is
    the heuristic tier the brain would have chosen — a stable key for "this
    kind of prompt".
  * Manual overrides (!opus etc.) that get rated count DOUBLE — an explicit
    correction is a strong signal.
  * adjust():
      - If, for this bucket, some tier has >=3 ratings and the best-rated tier
        differs from the brain's pick → use the best-rated tier
        (ties break toward the cheaper tier — savings by default).
      - If the brain's own pick has >=3 ratings with <50% satisfaction →
        escalate one tier ("you keep disliking haiku here").
  * Effort preference: rated-satisfied efforts are counted; the modal one is
    exposed as your session default for --fast mode.

Storage: ~/.claude/router_v2/<user>_profile.json (local, per user).
"""

from __future__ import annotations

import json
import time
import pathlib
from typing import Optional

from router_core import RoutingDecision


def _fmt(x) -> str:
    x = float(x)
    return str(int(x)) if x.is_integer() else f"{x:.1f}"

TIER_ORDER = ["haiku", "sonnet", "opus"]
MIN_SAMPLES = 3
TARGET_SAT = 0.75          # aim for 4/5 average (4-1)/4 = 0.75
EXPLORE_MIN = 2            # need >=2 ratings before judging a bucket mediocre
EXPLORE_TRIAL = 3          # give an upgrade this many turns to prove itself
BASE_DIR = pathlib.Path.home() / ".claude" / "the-expert"


class Profile:
    def __init__(self, user: str):
        self.user = user
        self._last_experiment_note = None
        self.path = BASE_DIR / f"{user}_profile.json"
        self.data = {"created": time.time(), "buckets": {}, "effort_sat": {},
                     "experiments": {}, "directives": {}, "notes": {}}
        if self.path.exists():
            try:
                self.data = json.loads(self.path.read_text())
                self.data.setdefault("experiments", {})
                self.data.setdefault("directives", {})
                self.data.setdefault("notes", {})
            except json.JSONDecodeError:
                pass  # corrupt profile -> start fresh rather than crash

    # -- recording -------------------------------------------------------
    def record(self, bucket: str, tier: str, effort: str,
               satisfied, overridden: bool) -> None:
        """satisfied: None (skip), bool, or a 0..1 float (graded rating)."""
        if satisfied is None:
            return  # unrated turns teach nothing
        signal = (1.0 if satisfied is True else 0.0
                  if satisfied is False else float(satisfied))
        w = 2 if overridden else 1
        b = self.data["buckets"].setdefault(bucket, {})
        t = b.setdefault(tier, {"n": 0, "sat": 0})
        t["n"] += w
        t["sat"] += w * signal
        if signal >= 0.75:
            e = self.data["effort_sat"]
            e[effort] = e.get(effort, 0) + w

        # --- conclude a running experiment for this bucket ---------------
        exp = self.data["experiments"].get(bucket)
        self._last_experiment_note = None
        if exp and exp.get("status") == "running" and tier == exp["trial_tier"]:
            exp["seen"] += 1
            exp["sat"] += signal
            if exp["seen"] >= EXPLORE_TRIAL:
                trial_avg = (exp["sat"] / exp["seen"]) * 4 + 1  # to 1-5
                if trial_avg >= exp["baseline"] + 0.5:  # meaningfully better
                    exp["status"] = "adopted"
                    # bake the win into the bucket so normal rules keep it
                    self._last_experiment_note = (
                        f"✅ experiment worked: {exp['trial_tier']} lifted "
                        f"'{bucket}'-type prompts from ~{exp['baseline']:.1f} to "
                        f"~{trial_avg:.1f}/5 — keeping it")
                else:
                    exp["status"] = "reverted"
                    self._last_experiment_note = (
                        f"↩️ experiment reverted: {exp['trial_tier']} only got "
                        f"~{trial_avg:.1f}/5 vs ~{exp['baseline']:.1f} on "
                        f"'{bucket}'-type prompts — not worth the extra cost")
        self._save()

    def set_directive(self, bucket: str, tier, effort, comment: str) -> None:
        """User explicitly told us what to use for this kind of prompt."""
        self.data["directives"][bucket] = {
            "tier": tier, "effort": effort,
            "comment": comment[:200], "ts": time.time()}
        self._save()

    def add_note(self, bucket: str, comment: str) -> None:
        notes = self.data["notes"].setdefault(bucket, [])
        notes.append(comment[:200])
        del notes[:-5]  # keep last 5
        self._save()

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2))

    # -- applying --------------------------------------------------------
    def adjust(self, decision: RoutingDecision,
               bucket: str) -> tuple[RoutingDecision, Optional[str]]:
        """Return (possibly modified decision, human-readable note or None)."""
        # --- User directives outrank all learning: an explicit instruction
        # ("use opus high for these") is the strongest possible signal.
        dr = self.data.get("directives", {}).get(bucket)
        if dr and (dr.get("tier") or dr.get("effort")):
            changed = False
            if dr.get("tier") and dr["tier"] != decision.tier:
                decision.tier = dr["tier"]; changed = True
            if dr.get("effort") and dr["effort"] != decision.effort:
                decision.effort = dr["effort"]; changed = True
            if changed:
                note = (f"following your instruction: \"{dr['comment'][:60]}\"")
                decision.source = "directed"
                decision.reason = note
                return decision, note

        stats = self.data["buckets"].get(bucket, {})

        # Candidate tiers with enough evidence.
        rated = {t: s for t, s in stats.items()
                 if t in TIER_ORDER and s["n"] >= MIN_SAMPLES}

        if rated:
            def score(t: str) -> tuple[float, float]:
                s = rated[t]
                # primary: satisfaction rate; tie-break: cheaper (lower index)
                return (s["sat"] / s["n"], -TIER_ORDER.index(t))
            best = max(rated, key=score)
            best_rate = rated[best]["sat"] / rated[best]["n"]
            if best != decision.tier and best_rate >= 0.5:
                note = (f"personalized: you rated {best} "
                        f"{_fmt(rated[best]['sat'])}/{rated[best]['n']} 👍 on "
                        f"'{bucket}'-type prompts, so using it instead of "
                        f"{decision.tier}")
                decision.tier = best
                decision.source = "learned"
                decision.reason = note
                return decision, note

        # Dissatisfaction escalation for the brain's own pick.
        own = stats.get(decision.tier)
        if own and own["n"] >= MIN_SAMPLES and own["sat"] / own["n"] < 0.5:
            idx = TIER_ORDER.index(decision.tier)
            if idx < len(TIER_ORDER) - 1:
                new = TIER_ORDER[idx + 1]
                note = (f"personalized: {decision.tier} only pleased you "
                        f"{_fmt(own['sat'])}/{own['n']} times on '{bucket}'-type "
                        f"prompts — escalating to {new}")
                decision.tier = new
                decision.source = "learned"
                decision.reason = note
                return decision, note

        # --- Satisfaction-target explore step ---------------------------
        # If this bucket is "mediocre" (rated, but averaging below target) and
        # a stronger tier exists, propose trying it — UNLESS we're already
        # mid-experiment here (in which case honour the ongoing trial).
        exp = self.data["experiments"].get(bucket)
        if exp and exp.get("status") == "running":
            if exp["trial_tier"] != decision.tier:
                note = (f"experiment: trying {exp['trial_tier']} to see if it "
                        f"beats your ~{exp['baseline']:.1f}/5 on '{bucket}'-type "
                        f"prompts ({exp['seen']}/{EXPLORE_TRIAL} tries so far)")
                decision.tier = exp["trial_tier"]
                decision.source = "experiment"
                decision.reason = note
                return decision, note
            return decision, None

        own = stats.get(decision.tier)
        if own and own["n"] >= EXPLORE_MIN:
            rate = own["sat"] / own["n"]
            idx = TIER_ORDER.index(decision.tier)
            if rate < TARGET_SAT and idx < len(TIER_ORDER) - 1:
                trial = TIER_ORDER[idx + 1]
                prior = self.data["experiments"].get(bucket, {})
                if not (prior.get("status") == "reverted"
                        and prior.get("trial_tier") == trial):
                    self.data["experiments"][bucket] = {
                        "status": "running", "trial_tier": trial,
                        "from_tier": decision.tier,
                        "baseline": round((rate * 4) + 1, 2),
                        "seen": 0, "sat": 0.0,
                    }
                    self._save()
                    note = (f"experiment: your '{bucket}'-type prompts average "
                            f"~{(rate*4)+1:.1f}/5 on {decision.tier} — trying "
                            f"{trial} to chase a 4+; I'll revert if it doesn't help")
                    decision.tier = trial
                    decision.source = "experiment"
                    decision.reason = note
                    return decision, note

        return decision, None

    def preferred_effort(self, default: str = "medium") -> str:
        e = self.data.get("effort_sat", {})
        return max(e, key=e.get) if e else default

    def experiment_summary(self) -> list[str]:
        out = []
        for bucket, e in self.data.get("experiments", {}).items():
            st = e.get("status")
            if st == "running":
                out.append(f"🧪 trying {e['trial_tier']} on '{bucket}'-type "
                           f"prompts ({e['seen']}/{EXPLORE_TRIAL}) to beat "
                           f"~{e['baseline']:.1f}/5")
            elif st == "adopted":
                out.append(f"✅ adopted {e['trial_tier']} for '{bucket}'-type "
                           f"prompts")
            elif st == "reverted":
                out.append(f"↩️ reverted {e['trial_tier']} on '{bucket}'-type "
                           f"prompts (didn't help)")
        return out

    def lessons(self) -> list[str]:
        out = []
        for bucket, tiers in self.data["buckets"].items():
            rated = {t: s for t, s in tiers.items() if s["n"] >= MIN_SAMPLES}
            if not rated:
                continue
            best = max(rated, key=lambda t: (rated[t]["sat"] / rated[t]["n"],
                                             -TIER_ORDER.index(t)))
            r = rated[best]
            out.append(f"'{bucket}' prompts → {best} "
                       f"({_fmt(r['sat'])}/{r['n']} 👍)")
        for bucket, dr in self.data.get("directives", {}).items():
            want = "/".join(x for x in (dr.get("tier"), dr.get("effort")) if x)
            out.append(f"🧭 '{bucket}' prompts → {want} (your instruction)")
        return out

    def recent_notes(self) -> list[str]:
        out = []
        for bucket, notes in self.data.get("notes", {}).items():
            if notes:
                out.append(f"'{bucket}': \"{notes[-1]}\"")
        return out
