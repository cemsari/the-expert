#!/usr/bin/env python3
"""
route_prompt.py — Claude Code UserPromptSubmit hook.

Reads the hook event JSON on stdin, routes the prompt through router_core,
and emits an advisory recommendation as additionalContext (which Claude sees),
while logging every decision to ~/.claude/router-log.jsonl for measurement.

WHY ADVISORY, NOT AUTO-SWITCH:
  UserPromptSubmit's documented outputs are: inject context, block (exit 2),
  or log. It cannot set the model for the turn it fires on. So this hook
  recommends a tier/effort rather than silently switching. The routing brain
  (router_core.route) is identical to what a true auto-router would use, so
  moving this behind the Claude Agent SDK — which CAN set the model
  programmatically — turns it into a real auto-router by swapping the emit step.

CONFIG (env vars, all optional):
  ROUTER_USE_HAIKU=0     -> disable the Haiku fallback (heuristic-only)
  ROUTER_SILENT=1        -> log only, don't inject advice into the conversation
  ANTHROPIC_API_KEY=...  -> needed only if the Haiku fallback is enabled

Never blocks the user: any internal error exits 0 silently. A router that
breaks your prompt flow is worse than no router.
"""

import os
import sys
import json
import time
import pathlib

# Make router_core importable regardless of Claude Code's working directory.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

LOG_PATH = pathlib.Path.home() / ".claude" / "router-log.jsonl"


def _log(entry: dict) -> None:
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        pass  # logging must never break the hook


def main() -> int:
    try:
        raw = sys.stdin.read()
        event = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0  # can't parse -> do nothing, let the prompt through

    prompt = event.get("prompt") or event.get("user_prompt") or ""
    if not prompt.strip():
        return 0

    try:
        from router_core import route
        use_haiku = os.environ.get("ROUTER_USE_HAIKU", "1") != "0"
        decision = route(prompt, use_haiku=use_haiku)
    except Exception as e:  # noqa: BLE001 - fail open on ANY brain error
        _log({"ts": time.time(), "error": str(e), "prompt_len": len(prompt)})
        return 0

    _log({
        "ts": time.time(),
        "session": event.get("session_id"),
        "tier": decision.tier,
        "effort": decision.effort,
        "confidence": decision.confidence,
        "source": decision.source,
        "reason": decision.reason,
        "prompt_len": len(prompt),
    })

    if os.environ.get("ROUTER_SILENT") == "1":
        return 0

    # Advisory line. stdout on UserPromptSubmit is added as context Claude sees.
    switch_cmd = f"/model {decision.tier}"
    advice = (
        f"[router] Suggested tier: {decision.tier} "
        f"(effort: {decision.effort}, confidence: {decision.confidence:.2f}, "
        f"via {decision.source}). Reason: {decision.reason} "
        f"If this turn is under a heavier model than needed, consider "
        f"`{switch_cmd}` to save cost; if it needs more, switch up."
    )
    print(advice)
    return 0


if __name__ == "__main__":
    sys.exit(main())
