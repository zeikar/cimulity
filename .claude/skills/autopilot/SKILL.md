---
name: autopilot
description: Run a fire-and-forget autonomous workflow that loops hyper-auto (plan-loop → implement-loop) → ff merge → push → next task, until context exhausts or a stop condition fires. Two delivery modes — (a) **scheduled** wakes up N hours/minutes from now via `CronCreate`; (b) **immediate** starts right now in this session, no cron. Use when the user says "start work in N hours", "work on it while I'm asleep", "trigger in a few hours", "set up autopilot for later", "autopilot now", "kick off autopilot immediately", "autopilot", or any "leave it running" request. Scheduled mode wraps `CronCreate` with a pre-built autonomous-loop prompt; immediate mode kicks off the same workflow inline.
---

# Autopilot — autonomous-loop runner (scheduled or immediate)

Lets the user say "in 2h, work on cube rooftop detail", "autopilot in 30m: viewport culling", or "autopilot now: rooftop accents" and walk away. The same self-driving 3-step workflow (hyper-auto → ff merge → push → next task → repeat) runs in both modes — only the trigger differs. `hyper-auto` itself chains `hyper-plan-loop` → `hyper-implement-loop` with a built-in safety stop between phases, so autopilot delegates the plan→implement chaining and only orchestrates merge/push/next-task selection on top.

## Modes

- **Scheduled** (`CronCreate`): the prompt is queued and fires once at a chosen future time. The session must stay **alive and idle** until then (closing the terminal kills the cron; locking the laptop is fine).
- **Immediate** (no cron): the workflow starts right now in the current session. No scheduling overhead, no "stay alive" caveat — Claude just begins executing the assembled directives as its next step.

Pick scheduled when the user says "in N hours / minutes", "while I'm asleep", "tomorrow 8am", "at 03:00", etc. Pick immediate when the user says "now", "right away", "kick it off", "start autopilot", or supplies no time at all. If the phrasing is ambiguous, ask before proceeding.

Both modes run in the local Claude session — no remote agent.

## When to use

- User wants the **multi-round loop** behavior (auto next-task selection after each round), whether starting later or immediately.
- User has a known first task + optional follow-up candidates.
- User explicitly says "autopilot", "schedule", "in N hours", "while I'm asleep", "autopilot now", "kick this off", "fire-and-forget", or similar.

## When NOT to use

- The user wants **a single round only** with no auto-pickup of the next task — just run `/hyperclaude:hyper-auto` directly (or `/hyperclaude:hyper-plan-loop` / `/hyperclaude:hyper-implement-loop` for finer control). Autopilot's value is the multi-round loop on top of those.
- One-shot edits / quick fixes — no need for the multi-round loop.
- The user explicitly asks for remote/cloud execution — that needs `/schedule` (RemoteTrigger), not local cron / inline.

## Inputs the user must provide

1. **Mode + when** (if scheduled): how long until autopilot kicks off. Natural language is fine — "2 hours", "30 minutes", "9 AM", "in 4h", "tomorrow 8am". Resolve against the freshly-fetched current time, not the prompt-anchor time. If the user says "now" / "immediately" / supplies no time, treat as immediate mode and skip cron entirely.
2. **Round-1 task**: what to work on first. A short description (one paragraph is enough — autopilot's `hyper-auto` will hand it to `hyper-plan-loop`, which expands it).
3. (optional) **Follow-up candidates**: ordered list of next tasks autopilot picks from after Round 1. Defaults to "pick from README MVP-1 roadmap and recent `.hyperclaude/plans/` if not supplied".
4. (optional) **Stop conditions / extra constraints**: pushed into the prompt body alongside the standard ones.

## Procedure

### Step 0 — Pick a mode

Read the user's phrasing once and decide: **scheduled** or **immediate**. See the Modes section above. If ambiguous, ask a one-line clarifying question — do NOT silently default. Scheduled mode runs Steps 1–2; immediate mode skips them. Both modes run Steps 3, 4, 5, 6.

### Step 1 — Resolve current time + target time *(scheduled only)*

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
date +%Y-%m-%d
```

Read both. Parse the user's "when" against the live UTC value, NOT a remembered timestamp from earlier in the conversation. For relative phrases ("in 2 hours"), add the delta. For absolute phrases ("tomorrow 8am"), convert from Asia/Seoul to a concrete local time. Always echo the resolved target back ("fires: 2026-05-21 04:00 KST") so the user catches a misparse.

### Step 2 — Pick an off-minute and build the cron expression *(scheduled only)*

`CronCreate` uses **local timezone** 5-field cron: `M H DoM Mon DoW`. Avoid :00 and :30 — pick an off-minute like :07, :13, :22 (the skill's anti-mass-fleet guidance) unless the user specified an exact time. One-shot fire so use `recurring: false`.

Example: 2026-05-21 03:13 KST → `13 3 21 5 *`, recurring false.

### Step 3 — Confirm GitHub auth + remote (skill must not silently misfire)

Push is part of every round. If the project can't push, autopilot fails on round 1 step 4.

```bash
git remote -v
gh auth status 2>&1 | head -3 || echo "no gh"
```

If the remote is unset or auth is broken, surface it BEFORE dispatching (cron or inline) — autopilot must not be set up to fail.

### Step 4 — Assemble the prompt

Use the template at the bottom of this file. Substitute:
- `{{round1}}`: the user's first task description, verbatim.
- `{{candidates}}`: optional list — if user didn't supply, fall back to "After Round 1 the model picks the next task autonomously from README's MVP-1 roadmap and the most recent `.hyperclaude/plans/` artifacts. If nothing is obviously next, end and report."
- `{{extra}}`: optional extra constraints — if none, omit the section entirely.

The same assembled string is used in both modes — it is either fired as a future prompt (scheduled) or executed inline as the current directive (immediate).

### Step 5 — Confirm with the user, then dispatch

Show the full assembled prompt back regardless of mode. Get explicit "go" before dispatching — autopilot makes commits and pushes, so this counts as a risky action under CLAUDE.md ("Executing actions with care"). Never auto-fire.

**Step 5A — Scheduled:** also show the resolved firing time + cron expression. On "go", call `CronCreate` with:
- `cron`: the expression from Step 2.
- `recurring`: `false`.
- `durable`: default `false` (in-memory) unless the user wants it to survive a Claude restart.
- `prompt`: the assembled string from Step 4.

**Step 5B — Immediate:** on "go", do NOT call `CronCreate`. Instead, treat the assembled prompt as the active directive for this session and begin executing Round 1 directly — start by invoking `/hyperclaude:hyper-auto` on the Round-1 task. The rest of the per-round 3 steps, candidate-picking, stop conditions, and rules from the template apply exactly as if a cron had just fired the same prompt. Do not paraphrase the rules away — keep the assembled body in scope as you proceed.

### Step 6 — Tell the user what to expect

**Scheduled:** after `CronCreate` returns the job id, echo:
- Job id (for `CronDelete` if they want to cancel).
- Local firing time.
- One reminder: "this Claude Code session must stay alive and idle for the cron to fire — close the terminal and it's gone".
- Optionally: "good night" / "good luck" / project-appropriate signoff.

**Immediate:** echo one line acknowledging the kickoff ("starting Round 1 now — task: <one-line summary>"), then begin Step 5B execution. No "stay alive" caveat needed since work starts in-session. If the user wants to interrupt, they can do so the same way as any other long-running task.

## Failure modes to surface (don't silently swallow)

- **Cron already exists with the same job** *(scheduled)*: rare for one-shots; if `CronList` shows a near-duplicate, show it to the user and ask whether to replace.
- **Resolved time is in the past** *(scheduled)*: ask the user to clarify ("tomorrow 00:00" vs "today 24:00", etc.). If the user actually wanted "now", switch to immediate mode rather than back-dating a cron.
- **Cron skill rejects the expression** (e.g. minimum interval) *(scheduled)*: surface the raw error verbatim. Offer immediate mode as a fallback if appropriate.
- **GitHub auth broken** *(both modes)*: refuse to start until fixed. Autopilot rounds depend on push in either mode.

## Anti-patterns

- Dispatching (cron or inline) without showing the assembled prompt to the user first. Autopilot makes commits and pushes — confirm scope before starting.
- Substituting `now` from a stale conversation anchor instead of re-fetching with `date -u` *(scheduled)*.
- Defaulting silently to one mode when the phrasing is ambiguous. Ask, don't guess.
- Stuffing the prompt with multiple Round-1 tasks. Use the candidates list for follow-ups; Round 1 is one task.
- Hardcoding the 3-step workflow to skip `hyper-auto` for "simple" tasks. The skill is fire-and-forget — let hyper-auto decide if the inner plan/implement loops are short.
- Splitting `hyper-auto` back into `hyper-plan-loop` + `hyper-implement-loop` calls inside the per-round body. The whole point of the change is to delegate plan→implement chaining (and its between-phase safety stop) to `hyper-auto`.
- Forgetting to mention the "session must stay alive" caveat in scheduled mode. The user will be surprised otherwise.
- In immediate mode, paraphrasing the assembled rules ("I'll just start hyper-auto and follow the general idea"). Keep the assembled body in scope — that's the contract.
- In immediate mode, calling `CronCreate` with a 1-minute fire as a workaround. The whole point is no cron — just start.

---

## Prompt template (literal — substitute in Step 4)

```
[Auto trigger — start autonomous workflow]

## Round 1 task
{{round1}}

## Per-round 3 steps
1. **/hyperclaude:hyper-auto** — chain `hyper-plan-loop` → `hyper-implement-loop` for this round's task. `hyper-auto` itself stops between phases if plan-loop hits cap-reached or terminal revise-regression; treat that as a round failure (see Stop conditions).
2. **Fast-forward merge to main** — if on a work branch, checkout main then `git merge --ff-only`
3. **git push origin main** — no force push, no `--no-verify`; on hook failure, fix the root cause and create a new commit

After step 3 completes → autonomously pick the next task and start the next round.

## Next-task candidates (priority order)
{{candidates}}

## Stop conditions
- If the context limit is near, finish the current round and stop
- If any step requires a destructive git op (force push / hard reset / branch -D, etc.), stop immediately and report
- If push fails (remote rejection, auth failure, etc.), stop and report
- If `hyper-auto` reports a non-clean terminal state for either inner loop — plan-loop cap-reached / terminal revise-regression, or implement-loop ending with open Blocker/Major — stop. Do not start the next round, and do not retry the same task.

## Rules
- Respect CLAUDE.md layer invariants, comment policy, and code style
- Maintain the coverage gate (≥80% lines/branches/functions/statements)
- At the end of each round, append a one-line summary to `.hyperclaude/autonomous-log.md` (create if missing)
- Before starting a round, read the most recent `.hyperclaude/` artifacts (plans/, code-reviews/, plan-reviews/) for context
- Skip visual verification (Playwright/manual) in autonomous mode — if the plan calls for it, note as unverified risk and proceed

{{extra}}
```

(If `{{extra}}` is empty, drop the trailing newline so the prompt doesn't end with a blank section header.)
