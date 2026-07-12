# Optional: Claude Code advisory hook

This is the v1 advisory router — kept for reference, NOT active by default.
The Expert (`expert.py` in the project root) supersedes it.

**What it does:** if installed into a project, every prompt you type in a
Claude Code session started from that project gets classified, and a one-line
suggestion ("[router] Suggested tier: haiku ...") is injected as context.
It logs decisions to `~/.claude/router-log.jsonl` (summarise with
`python3 router_stats.py`). It never switches the model — Claude Code hooks
cannot do that; it advises only.

**Why it's in extras/:** shipping an active `.claude/settings.json` at the
package root meant anyone running `claude` inside the folder got surprise
hook-approval prompts. Hooks should be installed deliberately, not by unzip.

**To install (deliberately):** copy the `.claude/` folder from here into the
root of the project where you want it, start `claude` there, and review the
hook when Claude Code asks (it snapshots and asks about new hooks — that
consent prompt is a feature).
