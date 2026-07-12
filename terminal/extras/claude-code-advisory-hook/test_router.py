import sys
sys.path.insert(0, ".claude/hooks")
from router_core import route  # noqa: E402

CASES = [
    "2+2",
    "hi Claude",
    "what's the date?",
    "rename this variable to userCount",
    "write a function to validate an email address",
    "fix the off-by-one error in this loop",
    "explain how JWT auth works",
    "refactor the entire payments module to use the new async client",
    "debug this race condition in the websocket handler",
    "architect a multi-region failover system with zero downtime",
    "why does my React state update lag one render behind?",
    "add a dark mode toggle to the settings page",
    "summarise this file",
    "prove that this sorting function is stable and derive its complexity",
]

print(f"{'TIER':6} {'EFFORT':7} {'CONF':5} {'SRC':10} PROMPT")
print("-" * 90)
for c in CASES:
    d = route(c, use_haiku=False)  # heuristic-only for a deterministic test
    print(f"{d.tier:6} {d.effort:7} {d.confidence:<5.2f} {d.source:10} {c[:52]}")
