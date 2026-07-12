#!/usr/bin/env python3
"""Summarise the router log: how often each tier was chosen, and a rough
estimate of cost saved versus always running Opus."""

import json
import pathlib
from collections import Counter

LOG = pathlib.Path.home() / ".claude" / "router-log.jsonl"

# Rough relative cost weights (Opus = 1.0). Adjust to current pricing.
COST = {"haiku": 0.08, "sonnet": 0.30, "opus": 1.0}


def main():
    if not LOG.exists():
        print("No router log yet. Run some prompts first.")
        return
    tiers, sources, errors = Counter(), Counter(), 0
    weighted = 0.0
    total = 0
    for line in LOG.read_text().splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "error" in e:
            errors += 1
            continue
        t = e.get("tier")
        if t not in COST:
            continue
        tiers[t] += 1
        sources[e.get("source", "?")] += 1
        weighted += COST[t]
        total += 1

    if total == 0:
        print("No routed prompts logged yet.")
        return

    print(f"Routed prompts: {total}   (hook errors: {errors})\n")
    print("Tier distribution:")
    for t in ("haiku", "sonnet", "opus"):
        n = tiers.get(t, 0)
        bar = "#" * round(30 * n / total)
        print(f"  {t:7} {n:4}  {100*n/total:5.1f}%  {bar}")
    print("\nDecision source:")
    for s, n in sources.most_common():
        print(f"  {s:10} {n:4}  {100*n/total:5.1f}%")

    always_opus = total * COST["opus"]
    saved = 100 * (1 - weighted / always_opus)
    print(f"\nEstimated inference cost vs always-Opus: {weighted/always_opus:.2f}x "
          f"(~{saved:.0f}% saved)")
    print("Note: rough estimate using relative token-price weights, not a bill.")


if __name__ == "__main__":
    main()
