# ccaudit v0.1.1 — Daily Findings Design

**Date:** 2026-04-20
**Status:** approved for implementation
**Target:** ccaudit v0.1.1
**Goal:** change default `ccaudit` output from a static 7-day dashboard to a daily actionable diagnosis, so running the tool every morning surfaces the specific leaks worth fixing today

## Why

ccaudit v0.1.0 shipped with a static 7-day summary: total spend, three-bucket breakdown, top items. It answers "how much did I spend?" That question has a shelf life of about one run per user.

The retention target for v0.1.1 is morning-coffee daily use. That requires the default output to produce *different* content each day and to be *useful* — not vanity metrics, but specific fixes with dollar impact, generated from actual session data.

Anthropic's `/insights` command is a workflow analyzer (stats, narrative, tool counts) and has no dollar figures. ccusage shows totals without attribution. The unclaimed gap: daily, data-grounded, fix-oriented diagnosis.

## Default output

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

Emits zero to three findings depending on what the data supports. Zero-findings case: show yesterday totals + "You're tight. Run `ccaudit --weekly` for the health check."

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
| CLAUDE.md bloat | `CLAUDE.md` → tokenize by `##` section headers → token count per section | Show total size + per-section breakdown. Do NOT claim sections are unused. Honest framing: "at your usage, each section costs $X/session" |
| Disabled plugins still loaded | `~/.claude/plugins/*` + plugin registry | If plugin is disabled but still in registered_plugins cache (pre v2.1.91 bug), flag with version upgrade recommendation |

### Tier 3 — Diagnostic patterns (session-level aggregation)

Heuristics applied per-session, flagging outliers.

| Insight | Pattern |
|---|---|
| Outlier-expensive session | Individual session cost > 2σ above 7-day median |
| Compaction-heavy session | ≥4 compactions in one session |
| Cache thrash | cache_read_input_tokens > 0.9 × total tokens in one session |

Each points to a specific session ID; `ccaudit --why <session-id>` shows the full per-session breakdown.

### Tier 4 — External signal (version check, plan guidance)

Pure diagnostic facts requiring no correlation.

| Insight | Check |
|---|---|
| Known-bad Claude Code version | Parse `claude --version` via `execSync`, compare against a known-bad-versions list baked into the ccaudit release (no runtime fetch, offline promise) |
| Plan break-even | Sum last 7d tokens × API rates to project monthly API cost. Compare against Pro ($20), Max5x ($100), Max20x ($200) subscriptions. Only surface a finding if the *cheapest* subscription plan would save the user more than $30/mo compared to their implied API spend (i.e., this is pro-subscription, not pro-API — devs paying API rates are who we're trying to help) |

## Ranking function

Every run:

1. Compute all eligible insights from yesterday (Tier 1-3) and last 7 days (Tier 4)
2. Score each: `weekly_savings_usd × confidence_weight × fix_specificity_weight`
   - Tier 1 confidence: 1.0
   - Tier 2: 0.8
   - Tier 3: 0.7
   - Tier 4: 0.9
   - Fix specificity: 1.0 if the line points to a specific file/config/session; 0.6 for generic fixes
3. Take top 3 by score
4. If fewer than 3 score above $0.50/week, show however many there are
5. If zero, emit the "you're tight" message

As the user applies fixes, those heuristics stop triggering on subsequent days, insights drop off, next-smaller leaks bubble up. The tool iteratively helps the user trim waste. The retention mechanic is this iteration, not a streak counter.

## State persistence

Minimal. Stored at `~/.cache/ccaudit/state.json`:

```json
{
  "version": 1,
  "history": [
    { "date": "2026-04-19", "totalUsd": 47.30, "trailingAvgUsd": 60.00 }
  ]
}
```

Used only for the 7-day trailing average (needed by Tier 3 outlier detection and the plan break-even in Tier 4). Recomputed fresh on every run — idempotent. History retained for up to 30 days. Falls back to disabling trend-based insights if state file cannot be written.

## Backward compatibility

| Flag | Behavior |
|---|---|
| `ccaudit` (no flags) | Daily findings (new default) |
| `ccaudit --weekly` | 7-day three-bucket report (current v0.1.0 default) |
| `ccaudit --since 7d` | Same as `--weekly`, kept for existing users |
| `ccaudit --since 24h` | Matches new default format |
| `ccaudit --why <id>` | Drill-down into a specific insight. `<id>` is either `1`, `2`, `3` (the numbered findings from the most recent run, cached in state.json) or a session UUID — new in v0.1.1 |
| `ccaudit --json` | Unchanged — full structured report |
| `ccaudit --share` | Renders daily card (was weekly) — daily is more screenshot-worthy |

Release notes must call out the default change prominently.

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
- `scoreInsight` — confidence × specificity × savings product with concrete fixtures
- `parseClaudeMdSections` — correct tokenization by `##` headers, handles no headers
- `parseReminderConfig` — `.agentfence.yml` with frequency set vs default, missing file
- `claudeCodeVersionIsKnownBad` — version matching against baked-in list
- `planBreakEven` — API vs Pro vs Max5x vs Max20x with sample usage

State-file tests:
- Round-trip write → read
- Missing file fallback
- Corrupt JSON recovery (no crash, empty history)

Integration tests:
- End-to-end daily findings output on a fixture session directory
- Zero-session day produces the empty-day notice
- All fixes scoring below threshold produces the "you're tight" message

Target: +18-22 tests on top of v0.1.0's 54, aiming for ~75 tests total.

## Out of scope

Not in v0.1.1. Listed so future work has a visible backlog:
- `ccaudit watch` — live session tail (v0.2)
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
