"""
tracker.py — savings tracking + the funny savings communicator.

Every turn produces a TurnRecord with REAL numbers where available
(ResultMessage.total_cost_usd, duration_ms, usage tokens) and estimated
counterfactuals ("what would always-Opus have cost/taken"). Records persist
per-user as JSONL; totals aggregate across the lifetime of the profile.

Honesty notes baked in:
  * PRICES are $/MTok constants you should update to current pricing —
    they drive the *baseline* estimate. Actual cost prefers the SDK's
    reported total_cost_usd when present.
  * Time savings are estimates from rough relative speed factors, clearly
    labelled "est." in output.
"""

from __future__ import annotations

import json
import time
import random
import pathlib
from dataclasses import dataclass, asdict, field
from typing import Optional

# ---- Tunable constants (UPDATE to current pricing) --------------------------
PRICES = {  # $ per million tokens: (input, output) — verified Jul 2026
    "haiku":  (1.0, 5.0),    # Haiku 4.5
    "sonnet": (2.0, 10.0),   # Sonnet 5 (intro; $3/$15 after Aug 31 2026)
    "opus":   (5.0, 25.0),   # Opus 4.8
    "fable":  (10.0, 50.0),  # Fable 5 (manual override only)
}
SPEED = {"haiku": 2.5, "sonnet": 1.4, "opus": 1.0, "fable": 1.0}   # rough x-faster-than-Opus
CACHE_WRITE_MULT = 1.25   # cache writes cost ~1.25x input rate
CACHE_READ_MULT = 0.10    # cache reads cost ~0.1x input rate
EFFORT_WEIGHT = {"low": 0.6, "medium": 1.0, "high": 1.6}

BASE_DIR = pathlib.Path.home() / ".claude" / "the-expert"


@dataclass
class TurnRecord:
    ts: float
    user: str
    prompt_len: int
    bucket: str                 # heuristic tier before personalization
    tier: str                   # tier actually used
    effort: str
    source: str                 # heuristic | haiku | learned | override
    overridden: bool
    tokens_in: int
    tokens_out: int
    cost_actual: float          # $ (SDK-reported when available, else estimate)
    cost_opus_baseline: float   # $ same tokens priced at Opus
    saved_usd: float
    wall_s: float               # measured wall time
    api_ms: int                 # SDK-reported duration_ms (0 if absent)
    est_time_saved_s: float
    satisfied: Optional[bool] = None
    cost_is_reported: bool = False
    cache_write: int = 0
    cache_read: int = 0
    rating: Optional[int] = None
    comment: Optional[str] = None


def estimate_cost(tier: str, tokens_in: int, tokens_out: int,
                  cache_write: int = 0, cache_read: int = 0) -> float:
    pi, po = PRICES[tier]
    return (tokens_in * pi + cache_write * pi * CACHE_WRITE_MULT
            + cache_read * pi * CACHE_READ_MULT + tokens_out * po) / 1_000_000


def build_record(*, user: str, prompt: str, bucket: str, tier: str, effort: str,
                 source: str, overridden: bool, tokens_in: int, tokens_out: int,
                 reported_cost: Optional[float], wall_s: float,
                 api_ms: int, cache_write: int = 0,
                 cache_read: int = 0) -> TurnRecord:
    baseline = estimate_cost("opus", tokens_in, tokens_out, cache_write, cache_read)
    actual = reported_cost if reported_cost is not None else \
        estimate_cost(tier, tokens_in, tokens_out, cache_write, cache_read)
    saved = max(0.0, baseline - actual)
    est_time_saved = max(0.0, wall_s * (SPEED.get(tier, 1.0) - 1.0))
    return TurnRecord(
        ts=time.time(), user=user, prompt_len=len(prompt), bucket=bucket,
        tier=tier, effort=effort, source=source, overridden=overridden,
        tokens_in=tokens_in, tokens_out=tokens_out,
        cost_actual=actual, cost_opus_baseline=baseline, saved_usd=saved,
        wall_s=wall_s, api_ms=api_ms, est_time_saved_s=est_time_saved,
        cost_is_reported=reported_cost is not None,
        cache_write=cache_write, cache_read=cache_read,
    )


class SavingsTracker:
    def __init__(self, user: str):
        self.user = user
        self.path = BASE_DIR / f"{user}.jsonl"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, rec: TurnRecord) -> None:
        with self.path.open("a") as f:
            f.write(json.dumps(asdict(rec)) + "\n")

    def totals(self) -> dict:
        t = {"turns": 0, "saved_usd": 0.0, "cost_actual": 0.0,
             "cost_baseline": 0.0, "time_saved_s": 0.0,
             "tokens": 0, "tiers": {}, "efforts": {},
             "rated": 0, "happy": 0, "rating_sum": 0, "rating_n": 0}
        if not self.path.exists():
            return t
        for line in self.path.read_text().splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            t["turns"] += 1
            t["saved_usd"] += r.get("saved_usd", 0.0)
            t["cost_actual"] += r.get("cost_actual", 0.0)
            t["cost_baseline"] += r.get("cost_opus_baseline", 0.0)
            t["time_saved_s"] += r.get("est_time_saved_s", 0.0)
            t["tokens"] += (r.get("tokens_in", 0) + r.get("tokens_out", 0)
                            + r.get("cache_write", 0) + r.get("cache_read", 0))
            t["tiers"][r.get("tier", "?")] = t["tiers"].get(r.get("tier", "?"), 0) + 1
            t["efforts"][r.get("effort", "?")] = t["efforts"].get(r.get("effort", "?"), 0) + 1
            if r.get("satisfied") is not None:
                t["rated"] += 1
                t["happy"] += 1 if r["satisfied"] else 0
            if r.get("rating"):
                t["rating_sum"] += r["rating"]
                t["rating_n"] += 1
        return t


# ---- The funny savings communicator -----------------------------------------

_QUIPS_SAVED = [
    "Saved ${saved:.4f} — the sloth stays hydrated. 🦥",
    "That's {pct:.0f}% off the Opus price. Your wallet just did a tiny fist pump.",
    "{tier} handled it. Opus never even had to put trousers on.",
    "{tok} tokens for ${cost:.4f}. Somewhere, a GPU sighs in relief.",
    "Routed to {tier} and pocketed ${saved:.4f}. Compound interest, but for laziness. 🦥",
    "Opus was warming up backstage. Didn't need it. ${saved:.4f} saved.",
    "Efficiency level: {tier}. Savings: ${saved:.4f}. Smugness: priceless.",
    "That answer cost less than the electricity to read it. (${cost:.4f})",
]
_QUIPS_ZERO = [
    "No net savings — session overhead ate this one. Big questions amortize better.",
    "Cost more in handshake than in thinking. The sloth shrugs. \U0001F9A5",
    "Tiny question, fixed setup tax — like taking a taxi to buy one grape.",
]
_QUIPS_OPUS = [
    "No savings this time — this one needed the big brain. Money well burned. 🔥",
    "Full Opus deployed. Some questions deserve the heavy artillery.",
    "Opus took this one. Your problem was flattered, honestly.",
]
_MILESTONE = "🏆 MILESTONE: ${total:.2f} saved lifetime — that's {coffee} of a flat white. The sloth salutes you. 🦥"

_COFFEE_PRICE = 4.0  # adjust to local latte economics


def quip(rec: TurnRecord, totals: dict, rng: Optional[random.Random] = None) -> str:
    rng = rng or random
    prev_total = totals["saved_usd"] - rec.saved_usd
    # Milestone every $0.25 crossed.
    if int(totals["saved_usd"] / 0.25) > int(prev_total / 0.25) and totals["saved_usd"] > 0:
        frac = totals["saved_usd"] / _COFFEE_PRICE
        coffee = f"{frac:.0%}" if frac < 1 else f"{frac:.1f} cups"
        return _MILESTONE.format(total=totals["saved_usd"], coffee=coffee)
    if rec.tier == "opus":
        return rng.choice(_QUIPS_OPUS)
    if rec.saved_usd < 0.0005:
        return rng.choice(_QUIPS_ZERO)
    pct = 100 * rec.saved_usd / rec.cost_opus_baseline if rec.cost_opus_baseline else 0
    return rng.choice(_QUIPS_SAVED).format(
        saved=rec.saved_usd, pct=pct, tier=rec.tier,
        tok=rec.tokens_in + rec.tokens_out, cost=rec.cost_actual)


def format_stats(totals: dict, lessons: list[str]) -> str:
    if totals["turns"] == 0:
        return "No turns tracked yet."
    pct = 100 * totals["saved_usd"] / totals["cost_baseline"] if totals["cost_baseline"] else 0
    tiers = ", ".join(f"{k}:{v}" for k, v in sorted(totals["tiers"].items()))
    efforts = ", ".join(f"{k}:{v}" for k, v in sorted(totals["efforts"].items()))
    if totals.get("rating_n"):
        happy = (f"avg rating {totals['rating_sum']/totals['rating_n']:.1f}/5 "
                 f"over {totals['rating_n']} rated")
    elif totals["rated"]:
        happy = f"{totals['happy']}/{totals['rated']} rated 👍"
    else:
        happy = "no ratings yet"
    lines = [
        f"Turns: {totals['turns']}   Tokens: {totals['tokens']:,}",
        f"Spent: ${totals['cost_actual']:.4f}   Always-Opus would be: ${totals['cost_baseline']:.4f}",
        f"Saved: ${totals['saved_usd']:.4f} ({pct:.0f}%)   Est. time saved: {totals['time_saved_s']:.0f}s",
        f"Tiers: {tiers}   Effort: {efforts}",
        f"Satisfaction: {happy}",
    ]
    if lessons:
        lines.append("Learned for you: " + "; ".join(lessons))
    lines.append("Baseline: always-Opus 4.8 at standard rates — savings are "
                 "estimates, not a bill.")
    return "\n".join(lines)
