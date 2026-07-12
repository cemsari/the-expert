"""
router_core.py — the routing "brain".

Pure logic, no Claude Code coupling. Given a prompt string, it returns a
RoutingDecision (tier + effort + reason + confidence). This is deliberately
independent of the hook wrapper so you can unit-test it in isolation and,
later, drop the same brain behind the Agent SDK for TRUE auto-switching.

Design: HYBRID.
  1. Cheap heuristics run first and settle the obvious cases for free.
  2. Only genuinely ambiguous prompts fall through to an optional Haiku
     classifier call.
  3. If the Haiku call is unavailable or fails, we degrade gracefully to the
     heuristic's best guess (fail-open, never block the user).
"""

from __future__ import annotations

import os
import re
import json
from dataclasses import dataclass, asdict
from typing import Optional

# ---- Tiers & effort ---------------------------------------------------------
# Model *aliases* (not pinned versions) so this keeps working as models update.
TIER_HAIKU = "haiku"
TIER_SONNET = "sonnet"
TIER_OPUS = "opus"

EFFORT_LOW = "low"
EFFORT_MEDIUM = "medium"
EFFORT_HIGH = "high"

VALID_TIERS = {TIER_HAIKU, TIER_SONNET, TIER_OPUS}
VALID_EFFORT = {EFFORT_LOW, EFFORT_MEDIUM, EFFORT_HIGH}


@dataclass
class RoutingDecision:
    tier: str
    effort: str
    reason: str
    confidence: float          # 0.0–1.0
    source: str                # "heuristic" | "haiku" | "fallback"

    def as_json(self) -> str:
        return json.dumps(asdict(self))


# ---- Heuristic signals ------------------------------------------------------

# Prompts that are almost certainly trivial -> Haiku, low effort.
_SIMPLE_PATTERNS = [
    r"^\s*\d+\s*[\+\-\*/x×]\s*\d+\s*=?\s*\??\s*$",   # "2+2", "10 * 3 ="
    r"^\s*(hi|hey|hello|thanks|thank you|yo|ok|okay)\b",
    r"^\s*(merhaba|selam|te\u015fekk\u00fcr|sa\u011fol|tamam)\b",
    r"^\s*what('?s| is) the (time|date|day)\b",
    # Only trivial if it's a SHORT single-object command, not "summarise this
    # 400-line file". Anchor to a short tail and exclude file/codebase objects.
    r"^\s*(rename|echo|print)\b.{0,40}$",
]

# Strong "this is hard" vocabulary -> Opus, high effort.
_COMPLEX_KEYWORDS = [
    "architect", "architecture", "refactor", "redesign", "design a system",
    "prove", "derive", "optimi", "debug", "race condition", "concurren",
    "distributed", "migrate", "migration", "security review", "threat model",
    "root cause", "trade-off", "tradeoff", "why does", "reason about",
    "end-to-end", "multi-file", "across the codebase", "whole repo",
    # Turkish starter set
    "mimari", "yeniden yap\u0131land\u0131r", "hata ay\u0131kla", "kan\u0131tla",
    "optimize et", "ba\u015ftan tasarla",
]

# Mid-tier working vocabulary -> Sonnet.
_MEDIUM_KEYWORDS = [
    "write", "add", "implement", "fix", "create", "update", "test",
    "explain", "convert", "translate", "summari", "review", "improve",
    # Turkish starter set
    "yaz", "a\u00e7\u0131kla", "\u00f6zetle", "d\u00fczelt", "olu\u015ftur", "ekle",
    "kar\u015f\u0131la\u015ft\u0131r", "\u00e7evir",
]

_CODE_FENCE = re.compile(r"```")
_LONG_PROMPT_CHARS = 1200          # long prompts skew complex
_VERY_SHORT_CHARS = 25             # tiny prompts skew simple


def _matches_any(text: str, patterns: list[str]) -> bool:
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def _keyword_hits(text: str, words: list[str]) -> int:
    low = text.lower()
    return sum(1 for w in words if w in low)


def heuristic_decision(prompt: str) -> RoutingDecision:
    """Fast, free, deterministic. Returns a decision plus a confidence.

    Low confidence (< 0.6) is the signal that we *should* consult Haiku,
    if the caller has it enabled.
    """
    text = prompt.strip()
    n = len(text)
    has_code = bool(_CODE_FENCE.search(text))

    # 1. Obvious trivial cases.
    if _matches_any(text, _SIMPLE_PATTERNS) or (n <= _VERY_SHORT_CHARS and not has_code):
        return RoutingDecision(
            tier=TIER_HAIKU, effort=EFFORT_LOW,
            reason="Trivial/short prompt matched a simple pattern.",
            confidence=0.92, source="heuristic",
        )

    complex_hits = _keyword_hits(text, _COMPLEX_KEYWORDS)
    medium_hits = _keyword_hits(text, _MEDIUM_KEYWORDS)
    # Scope words turn a routine verb into a big job ("refactor the ENTIRE module").
    scope_hit = bool(re.search(
        r"\b(entire|whole|all|across|every|complete)\b", text, re.IGNORECASE))

    # 2. Strong complexity signal. A single complexity keyword is enough on its
    #    own — these words (architect, refactor, race condition...) rarely
    #    describe trivial work. Scope words or code/length reinforce it.
    if complex_hits >= 1:
        return RoutingDecision(
            tier=TIER_OPUS, effort=EFFORT_HIGH,
            reason=f"Complexity keyword present (kw={complex_hits}, scope={scope_hit}).",
            confidence=0.85 if (complex_hits >= 2 or scope_hit or has_code) else 0.72,
            source="heuristic",
        )

    # 2b. Scope word + a mid-tier verb ("rewrite all the tests") also skews big.
    if scope_hit and medium_hits >= 1:
        return RoutingDecision(
            tier=TIER_OPUS, effort=EFFORT_HIGH,
            reason="Broad-scope task across many files.",
            confidence=0.75, source="heuristic",
        )

    # 3. Clear mid-tier work.
    if medium_hits >= 1 or has_code:
        # A single complexity keyword nudges effort up but stays on Sonnet.
        effort = EFFORT_HIGH if complex_hits >= 1 else EFFORT_MEDIUM
        return RoutingDecision(
            tier=TIER_SONNET, effort=effort,
            reason=f"Standard task signals (med={medium_hits}, complex={complex_hits}).",
            confidence=0.7, source="heuristic",
        )

    # 4. Ambiguous — nothing fired strongly. Low confidence on purpose.
    return RoutingDecision(
        tier=TIER_SONNET, effort=EFFORT_MEDIUM,
        reason="No strong signal; defaulting to Sonnet pending classifier.",
        confidence=0.4, source="heuristic",
    )


def fable_worthy(prompt: str) -> bool:
    """Should we ASK the user about Fable? Deliberately conservative —
    Fable costs 2x Opus, so this fires only when heavy signals stack:
    many complexity keywords, plus scope words or substantial length."""
    text = prompt.strip()
    n = len(text)
    hits = _keyword_hits(text, _COMPLEX_KEYWORDS)
    scope = bool(re.search(r"\b(entire|whole|all|across|every|complete)\b",
                           text, re.IGNORECASE))
    return (hits >= 5
            or (hits >= 4 and (scope or n > 300))
            or (hits >= 3 and n > 1500))


# ---- Optional Haiku classifier ---------------------------------------------

_CLASSIFIER_SYSTEM = (
    "You are a routing classifier. Read the user's coding-assistant prompt and "
    "decide how much model capability it needs. Reply with ONLY a compact JSON "
    "object, no prose, no markdown fences, of the exact form: "
    '{"tier":"haiku|sonnet|opus","effort":"low|medium|high","reason":"<=12 words"}. '
    "haiku = trivial lookups, tiny edits, greetings. "
    "sonnet = normal feature work, bug fixes, explanations. "
    "opus = architecture, multi-file refactors, tricky debugging, deep reasoning."
)


def haiku_decision(prompt: str, api_key: Optional[str] = None,
                   timeout: float = 6.0) -> Optional[RoutingDecision]:
    """Ask Haiku to classify. Returns None on any failure (caller falls back).

    Kept dependency-light: uses urllib so the hook has zero pip installs.
    """
    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    import urllib.request
    import urllib.error

    body = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 100,
        "system": _CLASSIFIER_SYSTEM,
        "messages": [{"role": "user", "content": prompt[:4000]}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        # Pull the text blocks out of the content array.
        text = "".join(
            b.get("text", "") for b in data.get("content", [])
            if b.get("type") == "text"
        ).strip()
        text = text.replace("```json", "").replace("```", "").strip()
        parsed = json.loads(text)
        tier = parsed.get("tier", "").lower()
        effort = parsed.get("effort", "").lower()
        if tier not in VALID_TIERS or effort not in VALID_EFFORT:
            return None
        return RoutingDecision(
            tier=tier, effort=effort,
            reason=parsed.get("reason", "Haiku classification.")[:120],
            confidence=0.8, source="haiku",
        )
    except (urllib.error.URLError, urllib.error.HTTPError,
            json.JSONDecodeError, KeyError, ValueError, TimeoutError):
        return None


# ---- Public entry point -----------------------------------------------------

def route(prompt: str, use_haiku: bool = True,
          confidence_gate: float = 0.6) -> RoutingDecision:
    """The hybrid decision. Heuristics first; Haiku only for the ambiguous middle."""
    h = heuristic_decision(prompt)
    if h.confidence >= confidence_gate or not use_haiku:
        return h
    # Ambiguous: consult Haiku, fall back to heuristic if it can't answer.
    hk = haiku_decision(prompt)
    if hk is None:
        h.source = "fallback"
        h.reason = "Haiku unavailable; used heuristic default. " + h.reason
        return h
    return hk


if __name__ == "__main__":
    # Quick manual check.
    import sys
    p = " ".join(sys.argv[1:]) or "2+2"
    print(route(p, use_haiku=False).as_json())
