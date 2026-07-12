#!/usr/bin/env python3
"""
agent.py — v2 personalised auto-router agent.

For every message you type, BEFORE it is sent:
  1. router_core.route() classifies it (hybrid heuristics + optional Haiku).
  2. Your Profile may override the pick based on your past 👍/👎 ratings.
  3. The message runs on the chosen MODEL *and* EFFORT level.
  4. Real cost/tokens/time (from the SDK's ResultMessage) are tracked; savings
     vs an always-Opus baseline are reported with a rotating funny quip.
  5. You're asked "good answer? y/n" — that rating teaches your profile.

TWO ENGINES (introspection-verified against SDK 0.2.113):
  * per-turn (default): each message is a one-shot query() with
    ClaudeAgentOptions(model=..., effort=..., resume=<session_id>).
    `resume` chains the conversation, so BOTH model and effort are freshly
    chosen per message with context preserved. Costs a CLI spawn per turn.
  * --fast: one persistent ClaudeSDKClient; model switches live via
    set_model(); effort is fixed per session (the SDK has no set_effort),
    defaulting to your learned preference.

COMMANDS in the REPL:
  !haiku / !sonnet / !opus <msg>   force a tier (rated overrides teach double)
  stats                            lifetime savings + what I've learned
  exit / quit / Ctrl-D             leave

Per-user: profiles & logs key off $ROUTER_USER (fallback: OS username).
Requires ANTHROPIC_API_KEY for live runs. The full pipeline is offline-tested
with real SDK message objects in test_v2.py.
"""

from __future__ import annotations

import os
import sys
import time
import asyncio
import getpass
import difflib
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from router_core import route, heuristic_decision, fable_worthy, RoutingDecision  # noqa: E402
from tracker import SavingsTracker, build_record, quip, format_stats  # noqa: E402
from learner import Profile, TIER_ORDER  # noqa: E402

CONFIG_PATH = __import__("pathlib").Path.home() / ".claude" / "the-expert" / "config.json"
DEFAULT_CONFIG = {"target_rating": 4, "suggest_mode": True, "max_turns": 30,
                  "allowed_tools": ["WebSearch", "WebFetch"], "prices": None}


def load_config() -> dict:
    import json as _json
    cfg = dict(DEFAULT_CONFIG)
    try:
        if CONFIG_PATH.exists():
            cfg.update(_json.loads(CONFIG_PATH.read_text()))
        else:
            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            CONFIG_PATH.write_text(_json.dumps(DEFAULT_CONFIG, indent=2))
    except (OSError, ValueError):
        pass  # bad config never blocks startup
    return cfg


def apply_config(cfg: dict) -> None:
    import learner as _learner
    import tracker as _tracker
    _learner.TARGET_SAT = (cfg.get("target_rating", 4) - 1) / 4
    if cfg.get("prices"):
        for k, v in cfg["prices"].items():
            if k in _tracker.PRICES and isinstance(v, (list, tuple)) and len(v) == 2:
                _tracker.PRICES[k] = tuple(v)


import claude_agent_sdk as sdk  # noqa: E402
from claude_agent_sdk import (  # noqa: E402
    ClaudeAgentOptions, ClaudeSDKClient,
    AssistantMessage, TextBlock, ResultMessage,
)
try:
    from claude_agent_sdk import ToolUseBlock  # noqa: E402
except ImportError:  # older SDK
    ToolUseBlock = None

# Patchable seams for offline testing.
sdk_query = sdk.query
SDKClient = ClaudeSDKClient

VERSION = "1.0.0"

# Tier aliases the engines accept. The SDK/CLI resolves each alias to the
# current model version automatically. "fable" is manual-only (never auto-routed).
TIER_TO_MODEL = {
    "haiku": "haiku",
    "sonnet": "sonnet",
    "opus": "opus",
    "fable": "fable",
}

# Natural effort per tier when a model is chosen without specifying effort:
# cheap models for easy work (low), flagship for hard work (high).
DEFAULT_EFFORT = {"haiku": "low", "sonnet": "medium",
                  "opus": "high", "fable": "high"}

OVERRIDE_PREFIXES = {f"!{t}": t for t in TIER_TO_MODEL}

# State for the 'redo' command: the last real turn and its comment.
LAST_TURN = {"prompt": None, "comment": None}


# --------------------------------------------------------------------------
def decide(prompt: str, prof: Profile,
           use_haiku: bool) -> tuple[RoutingDecision, str, Optional[str], bool]:
    """Route + personalize. Returns (decision, bucket, note, overridden)."""
    for prefix, tier in OVERRIDE_PREFIXES.items():
        if prompt.lower().startswith(prefix + " "):
            body = prompt[len(prefix) + 1:]
            d = RoutingDecision(tier=tier,
                                effort=DEFAULT_EFFORT[tier],
                                reason="manual override",
                                confidence=1.0, source="override")
            bucket = heuristic_decision(body).tier
            return d, bucket, None, True
    bucket = heuristic_decision(prompt).tier
    d = route(prompt, use_haiku=use_haiku)
    d, note = prof.adjust(d, bucket)
    return d, bucket, note, False


def _looks_like_question(text: str) -> bool:
    """Heuristic: did this turn END by asking the user something, rather than
    answering? Conservative — only fires on clear question-ending turns."""
    t = text.strip()
    if not t:
        return False
    tail = t[-200:].lower()
    ends_q = t.rstrip().endswith("?") or "?" in tail
    asks = any(p in tail for p in (
        "could you clarify", "did you mean", "which ", "do you want",
        "can you confirm", "would you like", "should i", "let me know",
        "a few options", "to confirm", "clarify", "approve", "approval",
        "please confirm", "shall i", "want me to",
        "hangi", "ister misin", "edeyim mi", "onayl", "misin", "m\u0131s\u0131n"))
    # If it clearly answered a lot AND asks a small follow-up, treat as answer.
    return ends_q and (asks or len(t) < 400)


def _parse_feedback(text: str):
    """'4 too long' -> (4, 'too long'); '3' -> (3, None);
    'wrong direction' -> (None, 'wrong direction'); '' -> (None, None)."""
    t = text.strip()
    if not t:
        return None, None
    low = t.lower()
    if low == "y":
        return 5, None
    if low == "n":
        return 1, None
    parts = t.split(None, 1)
    if parts[0] in {"1", "2", "3", "4", "5"}:
        return int(parts[0]), (parts[1].strip() if len(parts) > 1 else None)
    return None, t


def _parse_directive(comment: str):
    """Digest 'use opus high next time' -> ('opus', 'high')."""
    if not comment:
        return None, None
    toks = comment.lower().replace(",", " ").split()
    tier = next((t for t in toks if t in TIER_TO_MODEL), None)
    effort = next((t for t in toks if t in ("low", "medium", "high")), None)
    return tier, effort


def build_redo_prompt(prev_prompt: str, comment) -> str:
    if comment:
        return (f"{prev_prompt}\n\n[My feedback on your previous answer: "
                f"{comment}. Please redo it accordingly.]")
    return f"{prev_prompt}\n\n[Please try again with a better answer.]"


def strip_override(prompt: str) -> str:
    for prefix in OVERRIDE_PREFIXES:
        if prompt.lower().startswith(prefix + " "):
            return prompt[len(prefix) + 1:]
    return prompt


def extract_result(messages: list):
    """(text, tokens_in, cache_write, cache_read, tokens_out, cost, api_ms)."""
    text_parts, tin, cw, cr, tout, cost, api_ms = [], 0, 0, 0, 0, None, 0
    for m in messages:
        if isinstance(m, AssistantMessage):
            for b in m.content:
                if isinstance(b, TextBlock):
                    text_parts.append(b.text)
        elif isinstance(m, ResultMessage):
            u = m.usage or {}
            tin = u.get("input_tokens", 0)
            cw = u.get("cache_creation_input_tokens", 0)
            cr = u.get("cache_read_input_tokens", 0)
            tout = u.get("output_tokens", 0)
            cost = m.total_cost_usd
            api_ms = m.duration_ms or 0
    return "".join(text_parts), tin, cw, cr, tout, cost, api_ms


# ---- Engine A: per-turn (model + effort both fresh each message) ----------
class PerTurnEngine:
    def __init__(self, state_path=None):
        import json as _json, pathlib as _pl
        self._state_path = _pl.Path(state_path) if state_path else None
        self.session_id: Optional[str] = None
        self.resumed = False
        if self._state_path and self._state_path.exists():
            try:
                self.session_id = _json.loads(
                    self._state_path.read_text()).get("session_id")
                self.resumed = bool(self.session_id)
            except (OSError, ValueError):
                pass

    def _persist(self) -> None:
        if self._state_path and self.session_id:
            import json as _json
            try:
                self._state_path.parent.mkdir(parents=True, exist_ok=True)
                self._state_path.write_text(
                    _json.dumps({"session_id": self.session_id}))
            except OSError:
                pass

    def new_session(self) -> None:
        self.session_id = None
        self.resumed = False
        if self._state_path and self._state_path.exists():
            try:
                self._state_path.unlink()
            except OSError:
                pass

    async def run(self, prompt: str, tier: str, effort: str) -> list:
        try:
            return await self._run_once(prompt, tier, effort,
                                        resume=self.session_id)
        except Exception as e:  # noqa: BLE001
            # A resumed session can expire between launches. If so, drop it
            # and retry once as a fresh conversation instead of failing.
            stale = ("session" in str(e).lower()
                     or "no conversation found" in str(e).lower())
            if self.session_id and stale:
                print("   ↩️  (previous session expired — starting fresh)")
                self.new_session()
                return await self._run_once(prompt, tier, effort, resume=None)
            raise

    async def _run_once(self, prompt, tier, effort, resume) -> list:
        opts = ClaudeAgentOptions(model=tier, effort=effort,
                                  resume=resume,
                                  allowed_tools=["WebSearch", "WebFetch"],
                                  max_turns=30)
        msgs = []
        async for m in sdk_query(prompt=prompt, options=opts):
            if isinstance(m, AssistantMessage):
                for b in m.content:
                    if isinstance(b, TextBlock):
                        print(b.text, end="", flush=True)
                    elif ToolUseBlock and isinstance(b, ToolUseBlock):
                        print(f"\n   🔎 {b.name}…", flush=True)
            msgs.append(m)
            sid = getattr(m, "session_id", None)
            if sid and sid != self.session_id:
                self.session_id = sid
                self._persist()
        print()
        return msgs


# --------------------------------------------------------------------------
async def process_message(prompt: str, engine, prof: Profile,
                          tracker: SavingsTracker, user: str,
                          use_haiku: bool,
                          feedback: Optional[str] = None,
                          confirm: bool = False,
                          confirm_choice: Optional[str] = None,
                          fable_choice: Optional[str] = None,
                          clarify_reply: Optional[str] = None,
                          inherit=None) -> None:
    """One full turn. `feedback`/`confirm_choice` injectable for tests.
    `inherit=(tier, effort)` keeps a clarify-reply on the conversation's
    model instead of re-routing a short answer like "Camus" to haiku."""
    if inherit and inherit[0]:
        decision = RoutingDecision(tier=inherit[0], effort=inherit[1] or "medium",
                                   reason="continuing the previous answer",
                                   confidence=0.95, source="continuation")
        bucket = heuristic_decision(prompt).tier
        note, overridden = None, False
        confirm = False  # a reply to its own question needs no re-approval
    else:
        decision, bucket, note, overridden = decide(prompt, prof, use_haiku)
    body = strip_override(prompt)

    line = (f"→ {decision.tier} / effort {decision.effort} "
            f"(conf {decision.confidence:.2f}, {decision.source})")
    if note:
        line += f"\n   🧠 {note}"
    print(line)

    if confirm and not overridden:
        if confirm_choice is None:
            try:
                confirm_choice = input(
                    "   send? [Enter=yes · to change: 'opus', 'high' (same "
                    "model), or 'opus high'] "
                ).strip().lower()
            except EOFError:
                confirm_choice = ""
        if confirm_choice and confirm_choice not in ("y", "yes", "ok", "yep"):
            new_tier, new_effort = None, None
            for tok in confirm_choice.split():
                if tok in TIER_TO_MODEL:
                    new_tier = tok
                elif tok in ("low", "medium", "high"):
                    new_effort = tok
            if new_tier and new_tier != decision.tier:
                decision.tier = new_tier
                # If user changed model but not effort, auto-scale effort to
                # the model's natural default (see DEFAULT_EFFORT).
                if new_effort is None:
                    new_effort = DEFAULT_EFFORT[new_tier]
                decision.source = "override"
                overridden = True
            if new_effort and new_effort != decision.effort:
                decision.effort = new_effort
                decision.source = "override"
                overridden = True
            if overridden:
                print(f"   → using {decision.tier} / effort {decision.effort}")

    # Question-2 feature: for stacked-heavy prompts, offer Fable explicitly.
    if (not confirm and not overridden and decision.tier == "opus"
            and fable_worthy(body)):
        if fable_choice is None:
            try:
                fable_choice = input(
                    "   🔮 This looks Fable-grade. Use fable (2x opus cost) "
                    "or stay on opus, the best second option? [f/Enter=opus] "
                ).strip().lower()
            except EOFError:
                fable_choice = ""
        if fable_choice == "f":
            decision.tier = "fable"
            decision.effort = "high"
            decision.source = "override"
            overridden = True
            print("   → escalated to fable")

    print(f"   ⏳ sending to {decision.tier}…", flush=True)
    t0 = time.monotonic()
    msgs = await engine.run(body, decision.tier, decision.effort)
    wall = time.monotonic() - t0

    answer_text, tin, cw, cr, tout, cost, api_ms = extract_result(msgs)
    _ = answer_text
    rec = build_record(user=user, prompt=body, bucket=bucket,
                       tier=decision.tier, effort=decision.effort,
                       source=decision.source, overridden=overridden,
                       tokens_in=tin, tokens_out=tout, reported_cost=cost,
                       wall_s=wall, api_ms=api_ms,
                       cache_write=cw, cache_read=cr)

    # Feedback BEFORE persisting so the record carries the rating.
    followup = None
    if feedback is None:
        answer_text = _.strip() if isinstance(_, str) else ""
        asked_back = _looks_like_question(answer_text)
        try:
            if asked_back:
                print("   ⏭️  The Expert asked you a question above.")
                print("      Type your answer to continue · or 1-5 to rate "
                      "this reply and stop · or Enter to move on.")
                reply = (clarify_reply if clarify_reply is not None
                         else input("   your answer › ").strip())
                if reply in {"1", "2", "3", "4", "5"}:
                    feedback = reply     # score-and-stop
                elif reply:
                    feedback = ""
                    followup = reply     # send straight back as next message
                else:
                    feedback = ""
            else:
                feedback = input(
                    "   ⭐ Rate 1-5, add a note after it (e.g. '4 too long, "
                    "use opus next time'), a note alone, or Enter to pass: "
                ).strip()
        except EOFError:
            feedback = ""
    LABELS = {1: "poor", 2: "fair", 3: "good", 4: "very good", 5: "excellent"}
    score, comment = _parse_feedback(feedback or "")
    if comment:
        rec.comment = comment
        d_tier, d_effort = _parse_directive(comment)
        if d_tier or d_effort:
            prof.set_directive(bucket, d_tier, d_effort, comment)
            want = "/".join(x for x in (d_tier, d_effort) if x)
            print(f"   🧭 Got it — I'll use {want} for prompts like this "
                  f"from now on.")
        else:
            prof.add_note(bucket, comment)
            print("   📝 Noted — type 'redo' to have this answer redone with "
                  "your feedback.")
    if score is not None:
        print(f"   ({LABELS[score]})")
        rec.rating = score
        rec.satisfied = score >= 4
        # A rating carrying an explicit instruction teaches at override weight.
        prof.record(bucket, decision.tier, decision.effort,
                    (score - 1) / 4,
                    overridden or bool(comment and _parse_directive(comment)[0]))
        if getattr(prof, "_last_experiment_note", None):
            print(f"   🧪 {prof._last_experiment_note}")

    tracker.append(rec)
    totals = tracker.totals()
    est = "" if rec.cost_is_reported else " (est.)"
    print(f"   💸 {quip(rec, totals)}")
    tok_bits = f"{rec.tokens_in}+{rec.tokens_out} tok"
    cache_total = rec.cache_write + rec.cache_read
    if cache_total:
        tok_bits += f" ({cache_total:,} cached)"
    print(f"      [this turn: ${rec.cost_actual:.4f}{est}, {tok_bits}, "
          f"{rec.wall_s:.1f}s | lifetime saved: ${totals['saved_usd']:.4f}]")
    LAST_TURN["prompt"] = body
    LAST_TURN["comment"] = comment
    LAST_TURN["tier"] = decision.tier
    LAST_TURN["effort"] = decision.effort
    return followup


async def repl(use_haiku: bool) -> None:
    user = os.environ.get("ROUTER_USER") or getpass.getuser()
    prof = Profile(user)
    tracker = SavingsTracker(user)
    lessons = prof.lessons()
    print(f"🦥 THE EXPERT v{VERSION} — your model & effort router")
    print("Savings baseline: always-Opus 4.8 at standard rates (estimates).")
    print(f"Profile: {user}"
          f" ({len(lessons)} lesson{'s' if len(lessons) != 1 else ''} learned)")
    cfg = load_config()
    apply_config(cfg)
    print("Mode: SUGGEST — I propose, you approve before anything is sent."
          if cfg.get("suggest_mode", True)
          else "Mode: AUTO — routing without asking (type 'suggest' to change).")
    print("Commands: help · stats · suggest · redo · new · config · reset · exit\n")

    confirm_mode = {"on": bool(cfg.get('suggest_mode', True))}

    async def loop(engine):
        while True:
            try:
                prompt = input("you › ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return
            if not prompt:
                continue
            low = prompt.lower()
            if (len(low) <= 7 and " " not in low
                    and low not in {"exit", "quit", "stats", "suggest", "help", "redo", "new", "config", "reset"}):
                near = difflib.get_close_matches(low, ["stats", "exit", "quit", "suggest",
                                                       "help", "redo", "new"],
                                                 n=1, cutoff=0.7)
                if near:
                    print(f"(assuming you meant '{near[0]}')")
                    low = near[0]
            if low in {"exit", "quit"}:
                return
            if low == "stats":
                exp = prof.experiment_summary()
                stats_txt = format_stats(tracker.totals(), prof.lessons())
                if exp:
                    stats_txt += "\nExperiments: " + "; ".join(exp)
                print(stats_txt, "\n")
                continue
            if low == "help":
                print("""
  Ask anything — The Expert suggests a model+effort; Enter approves, or type
  e.g. 'opus', 'high' (same model), 'opus high' to change it.
  After answers: rate 1-5. Add a note after the number to teach it, e.g.
    '4 too long'  or  '2 wrong direction, use opus high next time'
  (model/effort mentioned in a note becomes a standing instruction).
  Commands:
    redo    – redo the last answer using your note as guidance
    stats   – savings, ratings, lessons, experiments
    suggest – toggle propose-first vs auto mode
    new     – start a fresh conversation (forgets chat context, keeps learning)
    config  – show settings file (target rating, tools, mode)
    reset   – wipe ledger + learning and start clean
    !haiku/!sonnet/!opus/!fable <msg> – force a tier for one message
""")
                continue
            if low == "config":
                print(f"  config file: {CONFIG_PATH}")
                import json as _json
                print("  " + _json.dumps(load_config()))
                continue
            if low == "new":
                engine.new_session()
                print("🆕 Fresh conversation started (learning kept).\n")
                continue
            if low == "redo":
                if LAST_TURN["prompt"]:
                    prompt = build_redo_prompt(LAST_TURN["prompt"],
                                               LAST_TURN["comment"])
                    print(f"🔁 Redoing with your feedback…")
                else:
                    print("Nothing to redo yet.\n")
                    continue
            if low == "reset":
                sure = input("  Wipe all savings history and learning? [y/N] "
                             ).strip().lower()
                if sure == "y":
                    for p in (tracker.path, prof.path):
                        try:
                            p.unlink()
                        except OSError:
                            pass
                    prof.data = {"created": __import__("time").time(),
                                 "buckets": {}, "effort_sat": {},
                                 "experiments": {}, "directives": {},
                                 "notes": {}}
                    print("🧹 Clean slate.\n")
                else:
                    print("  Kept everything.\n")
                continue
            if low == "suggest":
                confirm_mode["on"] = not confirm_mode["on"]
                print(f"suggest mode {'ON — I will propose, you approve'
                      if confirm_mode['on'] else 'OFF — auto-routing'}\n")
                continue
            # Guard: a short single "word" that matched no command is almost
            # certainly a typo, not a question. Handle it locally & instantly
            # instead of paying for a full model turn.
            COMMANDS = {"help", "stats", "suggest", "redo", "new", "config",
                        "reset", "exit", "quit"}
            if (len(prompt) <= 12 and " " not in prompt
                    and not prompt.startswith("!")
                    and prompt.isalpha() and low not in COMMANDS):
                sugg = difflib.get_close_matches(low, sorted(COMMANDS),
                                                 n=1, cutoff=0.5)
                hint = f" Did you mean '{sugg[0]}'?" if sugg else ""
                print(f"   ‘{prompt}’ isn’t a command.{hint} "
                      f"Type 'help', or add a space to ask it as a question.\n")
                continue
            try:
                nxt = await process_message(prompt, engine, prof, tracker,
                                            user, use_haiku,
                                            confirm=confirm_mode["on"])
                # If the user answered a clarifying question, send that answer
                # straight back — chaining until the model stops asking.
                while nxt:
                    print(f"\nyou › {nxt}")
                    nxt = await process_message(
                        nxt, engine, prof, tracker, user, use_haiku,
                        confirm=confirm_mode["on"],
                        inherit=(LAST_TURN.get("tier"), LAST_TURN.get("effort")))
            except KeyboardInterrupt:
                print("\n(turn cancelled)")
            except Exception as e:  # noqa: BLE001 — a failed turn must never kill the REPL
                msg = str(e)
                print(f"\n⚠️  Turn failed: {msg}")
                if "login" in msg.lower():
                    print("   Sign in first: run `claude` in another Terminal, "
                          "complete the login, then retry here.")
                elif "maximum number of turns" in msg.lower():
                    print("   The question needed more steps than allowed — "
                          "tell Sam's engineer to raise max_turns.")
                else:
                    print("   Retry, or paste this message to Claude for a "
                          "diagnosis.")
            print()

    session_file = (CONFIG_PATH.parent / f"{user}_session.json")
    engine = PerTurnEngine(session_file)
    if engine.resumed:
        print("↩️  Resuming your previous conversation "
              "(type 'new' for a fresh one).\n")
    await loop(engine)


def main() -> None:
    if not (os.environ.get("ANTHROPIC_API_KEY")
            or os.environ.get("ANTHROPIC_AUTH_TOKEN")
            or os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")):
        print("No API key in env — assuming Claude subscription auth via "
              "Claude Code sign-in (recommended).\nIf you haven't signed in: "
              "run `claude`, log in with your claude.ai account, then retry.\n"
              "Diagnose auth anytime with: python3 check_auth.py\n")
    use_haiku = os.environ.get("ROUTER_USE_HAIKU", "1") != "0"
    asyncio.run(repl(use_haiku))


if __name__ == "__main__":
    main()
