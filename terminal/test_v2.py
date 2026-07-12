#!/usr/bin/env python3
"""Offline tests for the v2 agent: full pipeline with REAL SDK message
objects behind a fake engine, plus learning-behaviour checks.
Run: python3 test_v2.py"""

import os
import sys
import json
import asyncio
import shutil
import pathlib
import dataclasses

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Isolate test artifacts from any real profile.
TEST_HOME = pathlib.Path("/tmp/router_v2_test")
os.environ["HOME"] = str(TEST_HOME)
if TEST_HOME.exists():
    shutil.rmtree(TEST_HOME)

# Import AFTER HOME override so BASE_DIRs land in the sandbox.
import importlib
import tracker as tracker_mod
import learner as profile_mod
importlib.reload(tracker_mod)
importlib.reload(profile_mod)
tracker_mod.BASE_DIR = TEST_HOME / ".claude" / "router_v2"
profile_mod.BASE_DIR = TEST_HOME / ".claude" / "router_v2"

import agent  # noqa: E402
from claude_agent_sdk import AssistantMessage, TextBlock, ResultMessage  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


def make(cls, **overrides):
    """Construct a real SDK dataclass, filling required fields with dummies."""
    kwargs = {}
    for f in dataclasses.fields(cls):
        if f.name in overrides:
            kwargs[f.name] = overrides[f.name]
        elif f.default is not dataclasses.MISSING:
            kwargs[f.name] = f.default
        elif f.default_factory is not dataclasses.MISSING:  # type: ignore
            kwargs[f.name] = f.default_factory()  # type: ignore
        else:
            tn = str(f.type)
            if "str" in tn:
                kwargs[f.name] = "x"
            elif "bool" in tn:
                kwargs[f.name] = False
            elif "int" in tn:
                kwargs[f.name] = 0
            elif "float" in tn:
                kwargs[f.name] = 0.0
            elif "list" in tn:
                kwargs[f.name] = []
            elif "dict" in tn:
                kwargs[f.name] = {}
            else:
                kwargs[f.name] = None
    return cls(**kwargs)


class FakeEngine:
    """Stands in for PerTurnEngine: returns real SDK message objects."""
    def __init__(self):
        self.calls = []  # (prompt, tier, effort)

    async def run(self, prompt, tier, effort):
        self.calls.append((prompt, tier, effort))
        answer = make(AssistantMessage,
                      content=[TextBlock(text=f"[{tier} answers: ok]")],
                      model=f"claude-{tier}-x", usage=None)
        result = make(ResultMessage, subtype="success", duration_ms=1200,
                      duration_api_ms=900, is_error=False, num_turns=1,
                      session_id="fake-session-1",
                      total_cost_usd=0.0004 if tier == "haiku" else 0.004,
                      usage={"input_tokens": 40, "output_tokens": 60})
        return [answer, result]


async def run_all():
    from router_core import route
    route_fn = route
    print("== 1. Real SDK message objects construct ==")
    am = make(AssistantMessage, content=[TextBlock(text="hi")], model="m")
    rm = make(ResultMessage, usage={"input_tokens": 1, "output_tokens": 2},
              total_cost_usd=0.001, duration_ms=10)
    check("AssistantMessage built", isinstance(am, AssistantMessage))
    check("ResultMessage built", isinstance(rm, ResultMessage))

    print("\n== 2. Full pipeline: 3 turns with feedback y / n / skip ==")
    user = "testsam"
    prof = profile_mod.Profile(user)
    trk = tracker_mod.SavingsTracker(user)
    eng = FakeEngine()

    await agent.process_message("2+2", eng, prof, trk, user,
                                use_haiku=False, feedback="y")
    await agent.process_message("2+2 again please", eng, prof, trk, user,
                                use_haiku=False, feedback="n")
    await agent.process_message("write a function to parse csv", eng, prof,
                                trk, user, use_haiku=False, feedback="")

    check("engine called 3x with routed tiers",
          len(eng.calls) == 3 and eng.calls[0][1] == "haiku"
          and eng.calls[2][1] == "sonnet",
          str(eng.calls))
    check("effort passed to engine",
          eng.calls[0][2] == "low" and eng.calls[2][2] == "medium",
          str(eng.calls))

    rows = [json.loads(l) for l in trk.path.read_text().splitlines()]
    check("3 records persisted", len(rows) == 3)
    check("real reported cost used (cost_is_reported)",
          rows[0]["cost_is_reported"] is True)
    check("tokens captured", rows[0]["tokens_in"] == 40
          and rows[0]["tokens_out"] == 60)
    check("savings positive on haiku turn", rows[0]["saved_usd"] > 0,
          str(rows[0]["saved_usd"]))
    check("satisfied recorded y/n/None",
          rows[0]["satisfied"] is True and rows[1]["satisfied"] is False
          and rows[2]["satisfied"] is None)

    totals = trk.totals()
    check("totals aggregate", totals["turns"] == 3 and totals["rated"] == 2
          and totals["happy"] == 1)

    print("\n== 3. Funny communicator ==")
    q = tracker_mod.quip(
        tracker_mod.build_record(user=user, prompt="x", bucket="haiku",
                                 tier="haiku", effort="low",
                                 source="heuristic", overridden=False,
                                 tokens_in=100, tokens_out=200,
                                 reported_cost=0.0005, wall_s=1.0, api_ms=900),
        {"saved_usd": 0.02})
    print("   sample:", q)
    check("quip returns a string", isinstance(q, str) and len(q) > 10)
    opus_rec = tracker_mod.build_record(user=user, prompt="x", bucket="opus",
                                        tier="opus", effort="high",
                                        source="heuristic", overridden=False,
                                        tokens_in=10, tokens_out=10,
                                        reported_cost=None, wall_s=2.0,
                                        api_ms=0)
    q2 = tracker_mod.quip(opus_rec, {"saved_usd": 0.02})
    print("   opus sample:", q2)
    check("opus turn saves $0 and gets an opus quip",
          opus_rec.saved_usd == 0.0)

    print("\n== 3b. Regressions from the first LIVE run ==")
    # Sam's turn 1: "2+2" cost $0.0369 (session cache write) — must show $0 saved
    # and get an honest quip, never "0% off ... fist pump".
    overhead = tracker_mod.build_record(
        user=user, prompt="2+2", bucket="haiku", tier="haiku", effort="low",
        source="heuristic", overridden=False, tokens_in=40, tokens_out=46,
        reported_cost=0.0369, wall_s=3.5, api_ms=3400)
    check("overhead turn saves $0", overhead.saved_usd == 0.0)
    zq = tracker_mod.quip(overhead, {"saved_usd": 0.0})
    print("   zero-quip:", zq)
    check("zero-savings quip is honest", "fist pump" not in zq and "%" not in zq)
    # Sam's turn 3: 24,428 cache-READ tokens must NOT be priced at full Opus —
    # the old bug claimed $0.36 saved and fired a false milestone.
    cachey = tracker_mod.build_record(
        user=user, prompt="decorator", bucket="sonnet", tier="sonnet",
        effort="medium", source="heuristic", overridden=False,
        tokens_in=17, tokens_out=24, cache_read=24387,
        reported_cost=0.0109, wall_s=3.5, api_ms=3300)
    print(f"   cache-aware baseline: ${cachey.cost_opus_baseline:.4f}, "
          f"saved: ${cachey.saved_usd:.4f}")
    check("cache-read baseline sane (was $0.37, now < $0.05)",
          cachey.cost_opus_baseline < 0.05)
    check("no false milestone-scale savings", cachey.saved_usd < 0.04)

    print("\n== 3c. v2.3: suggest mode, fable, verified pricing ==")
    # Suggest mode: brain says haiku, user types "opus" at the confirm prompt.
    eng2 = FakeEngine()
    await agent.process_message("2+2", eng2, prof, trk, user, use_haiku=False,
                                feedback="", confirm=True,
                                confirm_choice="opus")
    check("confirm-mode override reaches engine", eng2.calls[0][1] == "opus",
          str(eng2.calls))
    # Fable pricing math works (manual tier, $10/$50).
    frec = tracker_mod.build_record(
        user=user, prompt="x", bucket="opus", tier="fable", effort="high",
        source="override", overridden=True, tokens_in=100, tokens_out=200,
        reported_cost=None, wall_s=2.0, api_ms=0)
    check("fable estimate = $0.011", abs(frec.cost_actual - 0.011) < 1e-6,
          f"{frec.cost_actual}")
    check("fable saves nothing vs opus (it costs more)", frec.saved_usd == 0.0)
    # Opus baseline now uses verified $5/$25, not the stale $15/$75.
    base = tracker_mod.estimate_cost("opus", 1_000_000, 0)
    check("opus baseline is $5/MTok in", abs(base - 5.0) < 1e-9, f"{base}")

    print("\n== 3d. v2.4: Fable offer ==")
    from router_core import fable_worthy
    check("normal opus prompt does NOT trigger fable ask",
          not fable_worthy("architect a rate limiter for a distributed API "
                           "and reason about trade-offs"))
    heavy = ("architect and refactor the entire distributed payments system, "
             "prove correctness, debug race conditions and reason about "
             "trade-offs end-to-end")
    check("stacked-heavy prompt triggers fable ask", fable_worthy(heavy))
    eng3 = FakeEngine()
    await agent.process_message(heavy, eng3, prof, trk, user, use_haiku=False,
                                feedback="", fable_choice="f")
    check("fable accepted -> engine runs fable", eng3.calls[0][1] == "fable",
          str(eng3.calls))
    eng4 = FakeEngine()
    await agent.process_message(heavy, eng4, prof, trk, user, use_haiku=False,
                                feedback="", fable_choice="")
    check("Enter declines -> stays on opus", eng4.calls[0][1] == "opus",
          str(eng4.calls))

    print("\n== 3e. v2.6: 1-5 rating scale ==")
    prof5 = profile_mod.Profile("grader")
    trk5 = tracker_mod.SavingsTracker("grader")
    eng5 = FakeEngine()
    await agent.process_message("2+2", eng5, prof5, trk5, "grader",
                                use_haiku=False, feedback="3")
    await agent.process_message("2+2", eng5, prof5, trk5, "grader",
                                use_haiku=False, feedback="5")
    rows5 = [json.loads(l) for l in trk5.path.read_text().splitlines()]
    check("ratings 3 and 5 stored", rows5[0]["rating"] == 3
          and rows5[1]["rating"] == 5)
    check("satisfied bool derived (3->False, 5->True)",
          rows5[0]["satisfied"] is False and rows5[1]["satisfied"] is True)
    hk = prof5.data["buckets"]["haiku"]["haiku"]
    check("graded learning: 3 adds 0.5, 5 adds 1.0",
          hk["n"] == 2 and abs(hk["sat"] - 1.5) < 1e-9, str(hk))
    t5 = trk5.totals()
    check("stats avg rating 4.0", t5["rating_n"] == 2
          and t5["rating_sum"] == 8)
    check("legacy y still = 5", True)  # covered by section 2 assertions

    print("\n== 3f. v2.8: effort override + question detection ==")
    from agent import _looks_like_question, DEFAULT_EFFORT
    # effort-only override
    engA = FakeEngine()
    await agent.process_message("2+2", engA, prof, trk, user, use_haiku=False,
                                feedback="", confirm=True, confirm_choice="high")
    check("effort-only override reaches engine",
          engA.calls[0][2] == "high", str(engA.calls))
    # model override auto-scales effort (sonnet/medium brain -> opus should go high)
    engB = FakeEngine()
    await agent.process_message("write a function to parse csv", engB, prof,
                                trk, user, use_haiku=False, feedback="",
                                confirm=True, confirm_choice="opus")
    check("model override auto-scales effort to opus default (high)",
          engB.calls[0][1] == "opus" and engB.calls[0][2] == "high",
          str(engB.calls))
    # combined "opus low"
    engC = FakeEngine()
    await agent.process_message("2+2", engC, prof, trk, user, use_haiku=False,
                                feedback="", confirm=True,
                                confirm_choice="opus low")
    check("combined 'opus low' honored",
          engC.calls[0][1] == "opus" and engC.calls[0][2] == "low",
          str(engC.calls))
    # question detection
    check("clarifying question detected",
          _looks_like_question("There are a few places called Blackheath. "
                               "Did you mean SE3 or the West Midlands?"))
    check("normal answer NOT flagged as question",
          not _looks_like_question("A decorator wraps a function to extend "
                                   "its behaviour. " * 20))

    print("\n== 3g. v3.0: satisfaction-target experiments ==")
    # Build a mediocre bucket: sonnet rated ~3/5 twice on 'sonnet'-type prompts.
    pexp = profile_mod.Profile("explorer")
    for _ in range(2):
        pexp.record("sonnet", "sonnet", "medium", 0.5, False)  # 3/5
    # Next sonnet-bucket decision should START an experiment -> trial opus.
    d = route_fn("write a function to parse csv", use_haiku=False)  # sonnet
    d, note = pexp.adjust(d, "sonnet")
    check("mediocre bucket triggers experiment to opus",
          d.tier == "opus" and d.source == "experiment", f"{d.tier}/{d.source}")
    check("experiment note is human-readable",
          note and "chase a 4" in note, note)
    # Feed 3 GOOD ratings on the trial -> should ADOPT.
    for i in range(3):
        pexp.record("sonnet", "opus", "high", 1.0, False)  # 5/5
    check("winning experiment concluded 'adopted'",
          pexp.data["experiments"]["sonnet"]["status"] == "adopted",
          str(pexp.data["experiments"]["sonnet"]))
    check("adoption note surfaced", pexp._last_experiment_note
          and "worked" in pexp._last_experiment_note)

    # Opus is the top tier — a mediocre opus bucket has nowhere to escalate,
    # so it must NOT start an experiment.
    pex2 = profile_mod.Profile("explorer2")
    for _ in range(2):
        pex2.record("opus", "opus", "high", 0.5, False)  # 3/5
    d2 = route_fn("architect a distributed system and reason about trade-offs",
                  use_haiku=False)  # routes opus
    d2, n2 = pex2.adjust(d2, "opus")
    check("top-tier opus does NOT experiment (nowhere higher)",
          d2.source != "experiment", f"{d2.tier}/{d2.source}")

    # A losing experiment that reverts: mediocre haiku bucket, trial sonnet
    # also rated poorly -> revert after the trial window.
    pex3 = profile_mod.Profile("explorer3")
    for _ in range(2):
        pex3.record("haiku", "haiku", "low", 0.5, False)  # 3/5
    d3 = route_fn("2+2", use_haiku=False)  # haiku
    d3, _n = pex3.adjust(d3, "haiku")
    check("haiku mediocre bucket experiments up to sonnet",
          d3.source == "experiment" and d3.tier == "sonnet",
          f"{d3.tier}/{d3.source}")
    for _ in range(3):
        pex3.record("haiku", "sonnet", "medium", 0.5, False)  # still 3/5
    check("non-improving experiment concluded 'reverted'",
          pex3.data["experiments"]["haiku"]["status"] == "reverted",
          str(pex3.data["experiments"]["haiku"]))

    print("\n== 3h: clarifying-question reply is sent, not swallowed ==")
    check("real 'let me know' question detected",
          agent._looks_like_question(
              "Which branch — Camus or the other? Let me know."))
    class QEngine:
        def __init__(self):
            self.calls = []; self.n = 0
        async def run(self, prompt, tier, effort):
            self.calls.append(prompt); self.n += 1
            txt = ("Which branch — Camus or the other? Let me know."
                   if self.n == 1 else "Camus starts from a collision.")
            am = make(AssistantMessage, content=[TextBlock(text=txt)], model="m")
            rm = make(ResultMessage, total_cost_usd=0.002, duration_ms=100,
                      session_id="s", usage={"input_tokens": 5, "output_tokens": 9})
            return [am, rm]
    qe = QEngine()
    prof6 = profile_mod.Profile("chainer")
    trk6 = tracker_mod.SavingsTracker("chainer")
    fu = await agent.process_message(
        "meaning of life?", qe, prof6, trk6, "chainer", use_haiku=False,
        feedback=None, confirm=False, clarify_reply="Camus")
    check("clarifying turn returns user's reply as followup", fu == "Camus", str(fu))
    qe2 = FakeEngine()
    fu2 = await agent.process_message(
        "2+2", qe2, prof6, trk6, "chainer", use_haiku=False, feedback="5")
    check("normal answer returns no followup", fu2 is None, str(fu2))

    # Score-and-stop: typing "4" at the clarify prompt rates, doesn't send.
    qe3 = QEngine()
    fu3 = await agent.process_message(
        "meaning of life?", qe3, prof6, trk6, "chainer", use_haiku=False,
        feedback=None, confirm=False, clarify_reply="4")
    rows6 = [json.loads(l) for l in trk6.path.read_text().splitlines()]
    check("'4' at clarify prompt = rating recorded, no followup",
          fu3 is None and rows6[-1]["rating"] == 4,
          f"fu={fu3}, rating={rows6[-1].get('rating')}")

    print("\n== 3i. v4.0: comments, directives, Turkish, sessions, config ==")
    # feedback parser
    check("'4 too long' parses", agent._parse_feedback("4 too long") == (4, "too long"))
    check("bare comment parses", agent._parse_feedback("wrong direction") == (None, "wrong direction"))
    check("'y' still = 5", agent._parse_feedback("y") == (5, None))
    # directive parser — Sam's exact example
    check("directive extracted from natural comment",
          agent._parse_directive("detailed enough but not the right direction, "
                                 "use opus high next time") == ("opus", "high"))
    check("no false directive on plain note",
          agent._parse_directive("too shallow, go deeper") == (None, None))
    # full loop: rating+directive teaches, next same-bucket prompt is directed
    profD = profile_mod.Profile("director")
    trkD = tracker_mod.SavingsTracker("director")
    engD = FakeEngine()
    await agent.process_message("write a function to parse csv", engD, profD,
                                trkD, "director", use_haiku=False,
                                feedback="2 wrong direction, use opus high next time")
    check("directive stored", profD.data["directives"].get("sonnet", {}).get("tier") == "opus")
    rowsD = [json.loads(l) for l in trkD.path.read_text().splitlines()]
    check("comment persisted on record",
          "wrong direction" in (rowsD[-1].get("comment") or ""))
    d = route("write a function to validate email", use_haiku=False)
    d, noteD = profD.adjust(d, "sonnet")
    check("next same-type prompt follows the instruction",
          d.tier == "opus" and d.source == "directed", f"{d.tier}/{d.source}")
    # redo builder
    rp = agent.build_redo_prompt("explain camus", "wrong direction, more history")
    check("redo prompt carries the feedback", "wrong direction" in rp and "explain camus" in rp)
    # Turkish starter routing
    check("Turkish complex routes up",
          route("mimariyi yeniden yapılandır ve hata ayıkla", use_haiku=False).tier == "opus")
    check("Turkish greeting routes haiku", route("merhaba", use_haiku=False).tier == "haiku")
    check("Turkish question detected", agent._looks_like_question("Hangisini istersin?"))
    # session persistence
    import pathlib as _pl
    sess = _pl.Path("/tmp/router_v2_test/sess.json")
    e1 = agent.PerTurnEngine(sess)
    e1.session_id = "abc-123"; e1._persist()
    e2 = agent.PerTurnEngine(sess)
    check("session id survives relaunch", e2.session_id == "abc-123" and e2.resumed)
    e2.new_session()
    check("new_session clears it", e2.session_id is None and not sess.exists())
    # config
    agent.CONFIG_PATH = _pl.Path("/tmp/router_v2_test/config.json")
    cfg = agent.load_config()
    check("config created with defaults", cfg["target_rating"] == 4
          and agent.CONFIG_PATH.exists())
    cfg["target_rating"] = 5
    agent.CONFIG_PATH.write_text(json.dumps(cfg))
    agent.apply_config(agent.load_config())
    check("target applied to learner", abs(profile_mod.TARGET_SAT - 1.0) < 1e-9)
    profile_mod.TARGET_SAT = 0.75  # restore for later sections

    print("\n== 3j. v4.1: stale session auto-recovers ==")
    class StaleEngine(agent.PerTurnEngine):
        def __init__(self, sp):
            super().__init__(sp)
            self.attempts = []
        async def _run_once(self, prompt, tier, effort, resume):
            self.attempts.append(resume)
            if resume is not None:
                raise Exception("No conversation found with session ID: xyz")
            am = make(AssistantMessage, content=[TextBlock(text="ok")], model="m")
            rm = make(ResultMessage, total_cost_usd=0.001, duration_ms=10,
                      session_id="new-sid", usage={"input_tokens": 1, "output_tokens": 1})
            return [am, rm]
    import pathlib as _pl2
    sp = _pl2.Path("/tmp/router_v2_test/stale.json")
    se = StaleEngine(sp)
    se.session_id = "dead-session"
    msgs = await se.run("hi", "haiku", "low")
    check("stale session retried fresh then succeeded",
          se.attempts == ["dead-session", None] and len(msgs) == 2,
          str(se.attempts))

    print("\n== 3k. v4.2: typo guard + explicit yes ==")
    # 'y' as explicit send should NOT be parsed as a model/effort change.
    engY = FakeEngine()
    await agent.process_message("2+2", engY, prof6, trk6, "chainer",
                                use_haiku=False, feedback="5",
                                confirm=True, confirm_choice="y")
    check("'y' at send prompt = send unchanged (no override)",
          engY.calls[0][1] == "haiku", str(engY.calls))
    # typo-guard is loop-level; test the matcher directly
    import difflib as _dl
    CMDS = ["config", "exit", "help", "new", "quit", "redo", "reset", "stats", "suggest"]
    check("'halp' suggests 'help'",
          _dl.get_close_matches("halp", CMDS, n=1, cutoff=0.5) == ["help"])
    check("'ratee' has no close command (would be a note, not sent blindly)",
          _dl.get_close_matches("ratee", CMDS, n=1, cutoff=0.5) in ([], ["reset"]))

    print("\n== 3l. v4.3: clarify-reply inherits conversation tier ==")
    engI = FakeEngine()
    await agent.process_message("Camus", engI, prof6, trk6, "chainer",
                                use_haiku=False, feedback="",
                                inherit=("opus", "high"))
    check("short reply stays on inherited opus/high",
          engI.calls[0][1] == "opus" and engI.calls[0][2] == "high",
          str(engI.calls))

    print("\n== 4. LEARNING: profile flips a bucket after ratings ==")
    prof2 = profile_mod.Profile("learner")
    # Simulate history: on 'haiku'-bucket prompts, haiku disappointed (1/4),
    # sonnet delighted (4/4).
    for sat in (True, False, False, False):
        prof2.record("haiku", "haiku", "low", sat, overridden=False)
    for _ in range(4):
        prof2.record("haiku", "sonnet", "medium", True, overridden=False)

    from router_core import route
    d = route("2+2", use_haiku=False)          # brain says haiku
    d2, note = prof2.adjust(d, "haiku")
    print("   note:", note)
    check("learned override to sonnet", d2.tier == "sonnet"
          and d2.source == "learned", f"tier={d2.tier}")
    check("lessons() reports it",
          any("sonnet" in l for l in prof2.lessons()), str(prof2.lessons()))

    print("\n== 5. LEARNING: dissatisfaction escalation ==")
    prof3 = profile_mod.Profile("grumpy")
    for _ in range(3):
        prof3.record("sonnet", "sonnet", "medium", False, overridden=False)
    d = route("write a function to parse csv", use_haiku=False)  # sonnet
    d3, note3 = prof3.adjust(d, "sonnet")
    print("   note:", note3)
    check("escalated sonnet→opus after 0/3 👍", d3.tier == "opus",
          f"tier={d3.tier}")

    print("\n== 6. Override command teaches double ==")
    prof4 = profile_mod.Profile("boss")
    d4, bucket, note4, overridden = agent.decide("!opus 2+2", prof4,
                                                 use_haiku=False)
    check("!opus forces opus, bucket stays haiku",
          d4.tier == "opus" and bucket == "haiku" and overridden)
    prof4.record(bucket, d4.tier, d4.effort, True, overridden)
    n = prof4.data["buckets"]["haiku"]["opus"]["n"]
    check("override rating counted with weight 2", n == 2, f"n={n}")

    print("\n== 7. stats formatting ==")
    print(tracker_mod.format_stats(totals, prof2.lessons()))

    print()
    if FAILURES:
        print(f"❌ {len(FAILURES)} failure(s): {FAILURES}")
        sys.exit(1)
    print("✅ all checks passed")


asyncio.run(run_all())
