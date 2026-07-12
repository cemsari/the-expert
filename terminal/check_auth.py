#!/usr/bin/env python3
"""
check_auth.py — which credential will the router actually use?

The Agent SDK's precedence means an env var silently beats your Claude
subscription sign-in:

    ANTHROPIC_AUTH_TOKEN  >  ANTHROPIC_API_KEY  >  CLAUDE_CODE_OAUTH_TOKEN
    >  Claude Code sign-in (subscription — the recommended, £0 path)

The classic trap: you revoke a key but it's still exported in ~/.zshrc, so
every request authenticates with the DEAD key -> "invalid / not valid".

This script only reports; it changes nothing and calls no APIs.
"""

import os
import pathlib

MASK_LEN = 14


def masked(v: str) -> str:
    return v[:MASK_LEN] + "…" if len(v) > MASK_LEN else v + "…"


def main() -> None:
    print("Router auth check\n" + "-" * 40)

    env_order = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY",
                 "CLAUDE_CODE_OAUTH_TOKEN"]
    winner = None
    for name in env_order:
        v = os.environ.get(name)
        if v:
            print(f"  {name}: SET ({masked(v)})")
            winner = winner or name
        else:
            print(f"  {name}: not set")

    # The stale-key trap: exported in shell rc files.
    home = pathlib.Path.home()
    for rc in (".zshrc", ".bashrc", ".bash_profile", ".zprofile"):
        p = home / rc
        if p.exists():
            hits = [ln.strip() for ln in p.read_text(errors="ignore").splitlines()
                    if "ANTHROPIC" in ln and not ln.strip().startswith("#")]
            for h in hits:
                print(f"  ⚠️  ~/{rc} exports: {h[:60]}…"
                      if len(h) > 60 else f"  ⚠️  ~/{rc} exports: {h}")
                print(f"      If that key was revoked, DELETE this line, then "
                      f"open a new Terminal.")

    print("-" * 40)
    if winner:
        print(f"WINNER: {winner} — all requests bill this credential "
              f"(pay-as-you-go). Your subscription is being BYPASSED.")
        print("To use your Claude plan instead: remove it from your shell rc, "
              "`unset` it in this Terminal, and sign in via `claude`.")
    else:
        print("WINNER: Claude Code sign-in (subscription) — the recommended "
              "path. Bills your plan's monthly Agent SDK credit.")
        print("Verify you're actually signed in: run `claude`, then type "
              "/status — it shows your account. Not signed in? It will "
              "prompt a claude.ai login.")
        print("Note: with no ANTHROPIC_API_KEY, the router's Haiku fallback "
              "classifier is auto-disabled (heuristics only) — by design.")


if __name__ == "__main__":
    main()
