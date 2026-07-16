# Changelog

All notable changes to The Expert are documented in this file.
This project follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased] — v2.0.0 candidate

### Parity achieved
A feature-by-feature audit against the canonical `web/index.html` found five
real gaps, now closed: the **API budget meter**, **opt-in legacy models**, the
**Haiku classifier** for ambiguous prompts (fail-open), **note jump-links** with
flash highlight, and **drag-to-resize** panel. All 24 canonical features are
present. 61 tests passing; production build clean.

**The React edition is now ready to become v2.0.0.**

### Added — React edition, Phase 2 (`react/`)

The features that make the React edition worth cutting over to. **61 tests passing** (up from 27).

- **Streaming responses** — answers now appear token-by-token via Server-Sent
  Events, with a live cursor and a **stop** control (or press `Esc`). The SSE
  parser is a pure, tested function; the client falls back to a non-streaming
  request if streaming is unavailable.
- **Profile export / import** — download everything The Expert has learned about
  you as a JSON file and load it in another browser. Import is deliberately
  strict: it validates format and version and refuses foreign or corrupt files
  rather than silently overwriting your learning, and it reports what it found
  ("3 question types learned · 1 standing rule · 5 notes").
- **"Why this model?" panel** — expand any answer to see the full reasoning:
  which trigger words fired, message length, scope signals, the classifier's
  verdict and confidence, what your learning changed and why, and the cost
  consequence. Experiments explain themselves honestly, including the promise
  to revert if ratings don't improve.
- **Keyboard shortcuts** — `⌘K` new chat, `⌘/` focus the composer, `Esc` stop
  a streaming response.
- **Prompt history & templates** — press `↑` in an empty composer to recall past
  prompts (de-duplicated, newest first, capped at 50). Save any prompt as a
  reusable template; templates support `{placeholders}` that prompt for values
  when used, and unfilled ones stay visible rather than being silently blanked.
  Ships with four useful starters so the feature isn't an empty box.

### Added — React edition, Phase 1 (`react/`)


The parity foundation for the eventual v2.0.0. **No user-facing changes** —
this is the maintainable, tested architecture that Phase 2 builds on.

**Brain (pure, testable modules)**
- `src/brain/router.ts` — heuristic routing, Fable-grade hint, topic extraction
- `src/brain/learner.ts` — directives, best-tier learning, experiment lifecycle
- `src/brain/savings.ts` — cost/baseline math and quips
- `src/brain/models.ts` — single source of truth for model IDs, versions, prices

**Tests — 27 passing**, ported from the terminal edition's assertions so that
parity is *proven* rather than assumed:
- routing across tiers, including Turkish keywords
- experiment lifecycle (trigger → adopt / revert), top-tier guard
- directive parsing from natural comments
- graded ratings (a 3 counts as neutral 0.5)
- cost and baseline maths

**UI and state**
- React components recreate the live gauge, two-dial model+effort override,
  ratings with directive parsing, question-aware rating rows, CSV export,
  savings/notes/learnings panel, and the BYOK key modal with disconnect
- Zustand store; typed localStorage wrapper with the quota guard designed in
  from the start (the fix that was retrofitted in the single-file edition)

**Stack:** React 18 + Vite + TypeScript + Zustand. Production build verified
(56 modules). TypeScript caught two real defects during the port that the
JavaScript version would have shipped silently: an import typo and a
tier-type mismatch.

### Notes
- The single-file `web/index.html` remains the canonical app until the React
  edition reaches full parity — see `REACT_SCOPE.md`.
- Phase 2 is complete. Remaining before **v2.0.0**: a final parity review
  against `web/index.html`, then cutover.

---

## [1.0.0] — 2026-07-14

First public release. Two editions sharing one routing brain.

### Added
- **Web edition** (`web/index.html`) — a single self-contained browser app.
  Bring your own Anthropic key; it is stored only in the browser and sent only
  to Anthropic. Live model + effort suggestion as you type, 1–5 ratings with
  free-text notes that become standing rules, self-justifying experiments,
  honest savings tracking against an always-Opus baseline, CSV export for
  tables, a local API budget meter, and opt-in access to older models.
- **Terminal edition** (`terminal/`) — runs on a Claude subscription via
  Claude Code sign-in, so no API key is required. 71 automated tests.
  Suggest-before-send by default, comment-driven directives, `redo`,
  experiments, cross-launch session memory with stale-session recovery.
- MIT licence, `SECURITY.md`, `PUBLISH_GUIDE.md`, and `REACT_SCOPE.md`.

### How it works
The Expert classifies each message, routes it to the right-sized model and
effort level, and only ever spends more when the user's own ratings prove the
upgrade was worth it — otherwise it reverts to the cheaper model.
