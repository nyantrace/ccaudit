# ccaudit v0.1.1 — Daily Findings Design

**Date:** 2026-04-20
**Status:** approved for implementation (post-codex-review revision)
**Target:** ccaudit v0.1.1
**Goal:** ship daily actionable diagnosis as the default `ccaudit` output. `ccaudit` with no flags becomes a one-glance digest of yesterday's top leaks with specific fixes and dollar impact. The v0.1.0 7-day summary remains available via `ccaudit --weekly`.

**Default change rationale:** codex flagged the flip as a minor-release break. Product rationale overrides: the retention thesis depends on users seeing the daily findings format by default, not as an opt-in nobody types. In a 0.x release semver permits this; v0.1.1 release notes and a one-time post-upgrade notice mitigate surprise.

## Why

ccaudit v0.1.0 shipped with a static 7-day summary: total spend, three-bucket breakdown, top items. It answers "how much did I spend?" That question has a shelf life of about one run per user.

The retention target for v0.1.1 is morning-coffee daily use. That requires the default output to produce *different* content each day and to be *useful* — not vanity metrics, but specific fixes with dollar impact, generated from actual session data.

Anthropic's `/insights` command is a workflow analyzer (stats, narrative, tool counts) and has no dollar figures. ccusage shows totals without attribution. The unclaimed gap: daily, data-grounded, fix-oriented diagnosis.

## Command surface

```
ccaudit                # new default — daily findings (this spec)
ccaudit --weekly       # new — v0.1.0 7-day summary
ccaudit --share        # new default — daily PNG card
ccaudit --weekly --share  # new — 7-day PNG card (v0.1.0 format)
ccaudit --ephemeral    # new — disable state persistence (no file writes)
ccaudit --why <id>     # new — drill-down (see below)
ccaudit --json         # unchanged — full structured output
ccaudit --since <dur>  # unchanged
ccaudit --project <n>  # unchanged
```

**Post-upgrade notice:** on the first run after upgrading from v0.1.0 to v0.1.1, print a one-line banner above the daily output: *"ccaudit v0.1.1: default output is now daily findings. `ccaudit --weekly` for the 7-day summary you had before."* Detect "first run after upgrade" by checking if state.json is missing a `seenVersion: "0.1.1"` field; set it after displaying. Never shown again.

## Default output (new for v0.1.1)

```
ccaudit — yesterday's findings (2026-04-19)

$47.30 · 12 sessions · 3 projects

3 ways to save money today:

1. [$4.10/wk] Your `on_task` reminder fired 47 times in 12 sessions
   Move to `frequency: session_start` in .agentfence.yml:3
   → Saved $0.60 yesterday alone if this had been set

2. [$2.80/wk] CLAUDE.md is 5.2K tokens loaded on every turn
   Largest section "Debugging Guide" (lines 45-120, 1.2K tokens)
   costs $0.34/session at your usage

3. [$1.20/wk] File `src/session/reader.ts` re-read 9x in session 0a91951a
   Session total: $12.40 · re-reads: $3.47 (28%)
   Cache content in a variable or use `Grep -n 'pattern'`

Run `ccaudit --weekly` for 7-day view · `ccaudit --why <fix-id>` for detail
```

Emits zero to three **findings** (Tier 1-3 leaks) ranked by the scoring function below, plus an optional one-line **advisory** (Tier 4) in the footer if it applies.

Zero-findings case: show yesterday totals + "No leaks ranked above $0.50/week today. Run `ccaudit --weekly` for the health check."

## Insight taxonomy

Every insight ships tagged with one of four tiers, labeling confidence and mechanic.

### Tier 1 — Direct count from JSONL (highest confidence)

These use only data already in session JSONL. No external files parsed. Already implemented as aggregated heuristics; v0.1.1 surfaces them per-session with the specific identifiers the user needs to act.

| Insight | Signal | Cost formula | Fix |
|---|---|---|---|
| File re-read | `toolUses.filter(Read/Grep).groupBy(file_path)` — count > 2 in one session | `(count − 2) × mean(cache_read_per_turn) × cacheRead_rate` | "Cache content or use Grep -n" |
| Retry cluster | 3 consecutive failing tool_results on same signature (from `signals.ts`) | `sum(output_tokens of retries 2+) × output_rate` | "Fix root cause — repetition does not recover a failing tool" |
| Compaction count | System events with `compactPreTokens` | `preTokens × cacheWrite5m` | "Split sessions or trim CLAUDE.md before hitting the threshold" |
| Oversized output | `user/tool_result.outputText.length` > 10K chars | `excess_chars / 4 × cacheWrite_rate` | "Use Grep -c or head, limit with --max-lines" |

For each Tier 1 finding the output line references the exact session ID and file or command, so the fix is unambiguous.

### Tier 2 — Config parse + session correlation

Reads local config files and correlates patterns with JSONL events.

| Insight | Parse target | Correlation |
|---|---|---|
| Reminder fires every turn | `.agentfence.yml` → `reminders.*.frequency`; `~/.claude/settings.json` → hook config | Count `progress` events with matching hookName per session; if frequency is default (always) and >20 fires per session, flag with recommendation to move to `frequency: session_start` |
| CLAUDE.md bloat | `CLAUDE.md` → parsed via `mdast-util-from-markdown` into an AST, sections split at H2 boundaries (H1 treated as the title, H3+ nested under their parent H2), **fenced code blocks excluded from section-size calculation**, then tokenized with a conservative 4-char-per-token approximation | Show total size + per-section breakdown. We do NOT claim sections are unused. Honest framing: "at your usage, each section costs $X/session" |

**Deferred to v0.1.2:** "Disabled plugins still loaded." Requires parsing Claude Code's plugin registry format, which is undocumented and version-dependent. Ship tighter now.

### Tier 3 — Diagnostic patterns (session-level aggregation)

Heuristics applied per-session, flagging outliers.

| Insight | Pattern |
|---|---|
| Outlier-expensive session | Individual session cost > 2σ above 7-day median |
| Compaction-heavy session | ≥4 compactions in one session |
| Cache thrash | cache_read_input_tokens > 0.9 × total tokens in one session |

Each points to a specific session ID; `ccaudit --why <session-id>` shows the full per-session breakdown.

### Tier 4 — Advisories (not ranked with findings)

Tier 4 items are shown as footer one-liners, **not in the top-3 findings list**. They do not receive a score or compete with Tier 1-3 leaks.

| Advisory | Check | Type |
|---|---|---|
| Known-bad Claude Code version | Parse `claude --version` via `execSync`, compare against a known-bad-versions list baked into the ccaudit release (no runtime fetch, offline promise) | Diagnostic fact (high confidence) |

**Deferred to v0.1.2:** "Plan break-even" — projecting API cost vs subscription plans is an estimation exercise that belongs in its own subcommand (`ccaudit plan`) rather than mixed into daily findings. The projection is compounded on top of trailing-7-day data and reads easily as marketing, not diagnosis. Separating it lets `ccaudit daily` stay a pure leak-diagnosis tool.

## Ranking function

Every default run of `ccaudit`:

1. Compute all eligible **findings** from yesterday (Tier 1-3 only)
2. Score each: `weekly_savings_usd × confidence_weight × fix_specificity_weight`
   - Tier 1 confidence: 1.0
   - Tier 2: 0.8
   - Tier 3: 0.7
   - Fix specificity: 1.0 if the line points to a specific file/config/session; 0.6 for generic fixes
3. Filter to findings scoring above $0.50/week (after confidence × specificity weighting)
4. Take top 3 by score
5. If zero findings clear the threshold, emit the "no leaks ranked above $0.50/week today" message
6. Compute Tier 4 advisories separately; append as a footer line regardless of finding count

Tier 4 is deliberately excluded from the top-3 ranking. Version checks and plan advisories are facts about your setup, not leaks in your usage; mixing them into the ranked list would let a single advisory crowd out a concrete, evidence-backed leak.

## Retention honesty

As the user applies fixes, the specific heuristics that triggered yesterday stop triggering in subsequent sessions, so those findings drop off. New sessions can still generate new findings — that is expected. The claim is not "the tool goes silent"; it is that **the dollar floor of the top-3 trends down over time as configs tighten**. Early on a user sees $10/wk leaks at the top; after iterating, top findings become $1-2/wk; eventually below threshold, and the tool reports "no leaks above $0.50/week."

This is probabilistic, not guaranteed. A particularly chaotic day of sessions can still produce a $5/wk finding from a one-off retry cluster. That is a feature of the signal, not a failure of the retention mechanic.

## State persistence

Stored at `~/.cache/ccaudit/state.json`:

```json
{
  "version": 1,
  "seenVersion": "0.1.1",
  "history": [
    { "date": "2026-04-19", "totalUsd": 47.30, "trailingAvgUsd": 60.00 }
  ],
  "lastFindings": [
    { "id": 1, "title": "Reminder fired 47 times", "sessionId": null, "fixHint": "…" },
    { "id": 2, "title": "CLAUDE.md 5.2K tokens", "sessionId": null, "fixHint": "…" }
  ]
}
```

**What it's for:** Tier 3 outlier detection (needs trailing 7-day spend) and `--why <id>` resolution (needs the previous run's numbered findings).

**Atomic writes:** write to `state.json.tmp`, `fsync`, then `rename` to `state.json`. Rename is atomic on POSIX; on Windows the `fs.renameSync` on same volume is close enough. Never partial writes.

**Concurrency:** use a sidecar lockfile `state.json.lock` created with `{flag: 'wx'}` (fails if exists) and a 30-second TTL. If lock is stale (older than 30s), overwrite. If lock is fresh, skip state update for this run but still print findings (reads still work).

**Privacy:** history contains daily spend totals. `lastFindings` may reference session UUIDs (opaque — not conversation content). Combined, this is 30 days of spend history + session IDs on disk. Not sensitive enough to refuse to write, but worth documenting:
- **`--ephemeral` flag** disables state persistence entirely (no reads, no writes). Findings still work; Tier 3 outlier detection is suppressed; `--why <id>` only resolves session UUIDs within the same run, not numeric finding IDs from a previous run. Useful for shared machines, synced home dirs, corporate policy, and CI contexts.
- Flag is documented in the default `--help` footer, one line, because aligning with the "local, offline" positioning is worth surface area.
- README calls out what gets stored and why.

**30-day cap** — entries older than 30 days pruned on every write. Honest ceiling; streak and trailing-avg never query past this.

**Corrupt file recovery** — if `state.json` is malformed, rename to `state.json.corrupt-YYYY-MM-DD` and proceed with empty history. Log one line, do not crash.

## Backward compatibility

v0.1.1 **changes the default output**. This is intentional; the retention thesis requires it. Mitigations:

| Flag / command | Behavior |
|---|---|
| `ccaudit` (no args) | **New: daily findings** (changed from v0.1.0's 7-day summary) |
| `ccaudit --weekly` | New: v0.1.0's 7-day summary (escape hatch for existing users) |
| `ccaudit --since <dur>` | Unchanged — explicit time window renders 7-day-summary format |
| `ccaudit --share` | **New: daily PNG card** (changed from v0.1.0's 7-day card) |
| `ccaudit --weekly --share` | New: v0.1.0's 7-day PNG card |
| `ccaudit --why <id>` | New — drill-down into finding `1`, `2`, `3` (from most recent default run) or a session UUID |
| `ccaudit --ephemeral` | New — no state reads or writes; Tier 3 disabled; numeric `--why` disabled |
| `ccaudit --json` | Unchanged — full structured output |

**Surprise mitigation:**
1. One-time post-upgrade banner (see Command surface section)
2. Release notes lead with the default change
3. `--weekly` is a short, memorable escape hatch
4. Existing `--since` / `--project` / `--share` / `--json` flags continue to work identically on their explicit paths

**Not done:** a deprecation-warning release (e.g., v0.1.0.5 that warns before v0.1.1 flips). Judgment call: for a 5-day-old package with ~0 dependents, the cost of the warning phase is not worth the retention payoff of flipping immediately.

## What ccaudit will not claim

- A CLAUDE.md section was "unused" — we cannot track assistant references to arbitrary text with confidence, so we describe size and cost and let the user decide
- The specific cause of a cache-break bug — we see symptoms, Anthropic sees causes; we surface the version check and link to the known-bad-versions list
- Real-time `/clear` timing — that is `ccaudit watch` v0.2 territory, not this release
- Plan projections beyond trailing 7-day average — no API calls, no forecasting

## Edge cases

- **First run** — no state file. Tier 3 outlier detection skipped. Message: "Run again tomorrow to see trend-based insights."
- **No sessions yesterday** — show "$0 spent yesterday" + skip to the top weekly insights instead; do not show "you're tight" because absence of spend is not evidence of tightness
- **Corrupt state file** — reset to empty history; continue without trend insights; log one-line warning
- **Claude Code not installed on `$PATH`** — Tier 4 version check returns "unknown"; that insight is suppressed for the run
- **`.agentfence.yml` missing** — Tier 2 reminder analyzer returns no results; other insights unaffected
- **CLAUDE.md missing** — Tier 2 CLAUDE.md bloat insight suppressed; other insights unaffected
- **Timezone** — calendar-day boundary derived from host local TZ via `Intl.DateTimeFormat('en-CA').format(date)`; documented in `--help`

## Output modes

| Mode | When |
|---|---|
| Full daily findings | Default — sessions in yesterday's window |
| Empty-day notice | Zero sessions yesterday |
| "You're tight" | All scored insights below $0.50/week threshold |
| JSON | `--json` flag — full structured payload |
| Share card (PNG) | `--share` flag — daily variant (new layout: one hero panel for finding #1 with $ impact and fix, two compact lines for #2 and #3, no three-bucket bar). Weekly card (the v0.1.0 layout) is available via `--share --weekly` |

## Testing plan

Pure-function tests required:
- `computeTrailingAverage` — 3+ days, missing days, edge of 7-day window
- `scoreFinding` — confidence × specificity × savings product with concrete fixtures
- `parseClaudeMdSections` — correct splitting using `mdast-util-from-markdown`, fenced code blocks excluded, nested headers handled, no-headers fallback
- `parseReminderConfig` — `.agentfence.yml` with frequency set vs default, missing file
- `claudeCodeVersionIsKnownBad` — version matching against baked-in list

State-file tests:
- Round-trip write → read
- Atomic rename: temp file left behind on crash is ignored on next read
- Missing file fallback
- Corrupt JSON recovery (renames to `.corrupt-<date>`, continues with empty history)
- Lockfile held by active run (simulated) — fresh run skips write, still reads + prints
- Lockfile stale (>30s old) — fresh run overwrites

Integration tests:
- End-to-end `ccaudit daily` output on a fixture session directory
- Zero-session day produces the empty-day notice
- All findings below $0.50/week threshold produces the "no leaks" message
- Tier 4 advisory appears in footer regardless of finding count
- `--ephemeral` flag: state file untouched, Tier 3 suppressed, numeric `--why` rejected with guidance, other tiers work

Target: +18-22 tests on top of v0.1.0's 54, aiming for ~75 tests total.

## Out of scope

Not in v0.1.1. Listed so future work has a visible backlog:
- `ccaudit watch` — live session tail (v0.2)
- `ccaudit plan` — API vs subscription break-even analysis (v0.1.2)
- Disabled plugins cost attribution (v0.1.2, needs Claude Code plugin registry parsing)
- `ccaudit digest` — cron-friendly file output (v0.3)
- Cross-tool support for Codex / Cursor session formats (v0.2+)
- SessionEnd hook recipe to write cost to log (docs, not code)
- Plugin cost attribution at skill-description granularity (requires Claude Code plugin schema parser)

## Rollout

1. Implement per the writing-plans spec (follows)
2. Dogfood on Poe's own sessions for 3-5 days; iterate on insight wording and thresholds
3. Ship as 0.1.1 via `npm publish`
4. Update README example output + screenshot
5. No separate launch post — v0.1.1 rides on v0.1.0's existing launch narrative if and when that lands
