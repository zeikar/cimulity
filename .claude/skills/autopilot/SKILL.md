---
name: autopilot
description: Schedule a fire-and-forget autonomous workflow that wakes up N hours/minutes from now and runs plan-loop → implement-loop → ff merge → push → next task → repeat, until context exhausts or a stop condition fires. Use when the user says "N시간 뒤 작업 시작", "자고 있는 동안 작업해줘", "몇시간 뒤 트리거", "set up autopilot for later", "오토파일럿", or any "leave it running while I'm away" request. Wraps `CronCreate` with a pre-built autonomous-loop prompt template; the cron fires once at the resolved time and the prompt drives the rest.
---

# Autopilot — scheduled autonomous-loop runner

Lets the user say "2시간 뒤 큐브 옥상 디테일 작업해줘" or "autopilot in 30m: viewport culling" and walk away. At the resolved time, `CronCreate` enqueues a fully-specified autonomous prompt — the same self-driving workflow used in the overnight session that produced the cube-height / silhouette / rooftop-accent / viewport-culling rounds.

The session this skill runs in must still be **alive and idle** when the cron fires. Closing the terminal kills the cron; locking the laptop is fine. No remote agent — everything runs in the local Claude session.

## When to use

- User wants the work to start **later** (e.g. while they sleep / step out).
- User has a known first task + optional follow-up candidates.
- User explicitly says "autopilot", "오토파일럿", "스케줄", "schedule", "N시간 뒤", "자고 있을 때", "fire-and-forget", "이대로 진행 새벽에", or similar.

## When NOT to use

- The user wants to start work **immediately** — just run `/hyperclaude:hyper-plan-loop` (or `hyper-implement-loop`) directly. Autopilot adds scheduling overhead with no benefit.
- One-shot edits / quick fixes — no need for the multi-round loop.
- The user explicitly asks for remote/cloud execution — that needs `/schedule` (RemoteTrigger), not local cron.

## Inputs the user must provide

1. **When**: how long until autopilot kicks off. Natural language is fine — "2시간", "30분", "오전 9시", "in 4h", "tomorrow 8am". Resolve against the freshly-fetched current time, not the prompt-anchor time.
2. **Round-1 task**: what to work on first. A short description (one paragraph is enough — autopilot's `hyper-plan-loop` will expand it).
3. (optional) **Follow-up candidates**: ordered list of next tasks autopilot picks from after Round 1. Defaults to "pick from README MVP-1 roadmap and recent `.hyperclaude/plans/` if not supplied".
4. (optional) **Stop conditions / extra constraints**: pushed into the prompt body alongside the standard ones.

## Procedure

### Step 1 — Resolve current time + target time

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
date +%Y-%m-%d
```

Read both. Parse the user's "when" against the live UTC value, NOT a remembered timestamp from earlier in the conversation. For relative phrases ("2시간 뒤"), add the delta. For absolute phrases ("내일 아침 8시"), convert from Asia/Seoul to a concrete local time. Always echo the resolved target back ("발화: 2026-05-21 04:00 KST") so the user catches a misparse.

### Step 2 — Pick an off-minute and build the cron expression

`CronCreate` uses **local timezone** 5-field cron: `M H DoM Mon DoW`. Avoid :00 and :30 — pick an off-minute like :07, :13, :22 (the skill's anti-mass-fleet guidance) unless the user specified an exact time. One-shot fire so use `recurring: false`.

Example: 2026-05-21 03:13 KST → `13 3 21 5 *`, recurring false.

### Step 3 — Confirm GitHub auth + remote (skill must not silently misfire)

Push is part of every round. If the project can't push, autopilot fails on round 1 step 4.

```bash
git remote -v
gh auth status 2>&1 | head -3 || echo "no gh"
```

If the remote is unset or auth is broken, surface it BEFORE creating the cron — autopilot must not be set up to fail.

### Step 4 — Assemble the prompt

Use the template at the bottom of this file. Substitute:
- `{{round1}}`: the user's first task description, verbatim.
- `{{candidates}}`: optional list — if user didn't supply, fall back to "After Round 1 the model picks the next task autonomously from README's MVP-1 roadmap and the most recent `.hyperclaude/plans/` artifacts. If nothing is obviously next, end and report."
- `{{extra}}`: optional extra constraints — if none, omit the section entirely.

### Step 5 — Confirm with the user, then `CronCreate`

Show the resolved firing time + cron expression + the full assembled prompt back. Get explicit "go" before calling `CronCreate`. Don't proactively fire — scheduling autonomous git pushes counts as a risky action (CLAUDE.md "Executing actions with care").

`CronCreate` args:
- `cron`: the expression from Step 2.
- `recurring`: `false`.
- `durable`: default `false` (in-memory) unless the user wants it to survive a Claude restart.
- `prompt`: the assembled string from Step 4.

### Step 6 — Tell the user what to expect

After the `CronCreate` call returns the job id, echo:
- Job id (for `CronDelete` if they want to cancel).
- Local firing time.
- One reminder: "this Claude Code session must stay alive and idle for the cron to fire — close the terminal and it's gone".
- Optionally: "잘 자요" / "good luck" / project-appropriate signoff.

## Failure modes to surface (don't silently swallow)

- **Cron already exists with the same job**: rare for one-shots; if `CronList` shows a near-duplicate, show it to the user and ask whether to replace.
- **Resolved time is in the past**: ask the user to clarify ("내일 0시" vs "오늘 24시" etc.).
- **Cron skill rejects the expression** (e.g. minimum interval): surface the raw error verbatim.
- **GitHub auth broken**: refuse to create the cron until fixed. Autopilot rounds depend on push.

## Anti-patterns

- Firing the cron without showing the resolved time + prompt to the user first. Autopilot makes commits and pushes — confirm scope before scheduling.
- Substituting `now` from a stale conversation anchor instead of re-fetching with `date -u`.
- Stuffing the prompt with multiple Round-1 tasks. Use the candidates list for follow-ups; Round 1 is one task.
- Hardcoding the 4-step workflow to skip `hyper-plan-loop` for "simple" tasks. The skill is fire-and-forget — let plan-loop decide if it's simple.
- Forgetting to mention the "session must stay alive" caveat. The user will be surprised otherwise.

---

## Prompt template (literal — substitute in Step 4)

```
[자동 트리거 — 자율 워크플로우 시작]

## 라운드 1 작업
{{round1}}

## 각 라운드 4단계
1. **/hyperclaude:hyper-plan-loop** — plan ↔ Codex review 반복하여 clean 도달까지
2. **/hyperclaude:hyper-implement-loop** — implement ↔ code-review ↔ fix 반복하여 clean 도달까지
3. **main으로 fast-forward merge** — 작업 브랜치였다면 main 체크아웃 후 `git merge --ff-only`
4. **git push origin main** — force push 금지, `--no-verify` 금지, hook 실패 시 원인 수정 후 새 커밋

4단계 완료 시 → 다음 작업 자율 선택해서 라운드 다시 시작.

## 다음 작업 후보 (우선순위)
{{candidates}}

## 종료 조건
- 컨텍스트 한계 근접 시 현재 라운드 완료 후 종료
- 어느 단계든 destructive git op (force push / hard reset / branch -D 등)이 필요한 상황 만나면 즉시 멈추고 보고
- push 실패 (원격 거부, 인증 실패 등) 시 멈추고 보고
- hyper-plan-loop 또는 hyper-implement-loop가 cap에 도달해도 stop, 다음 라운드 진행 안 함

## 규약
- CLAUDE.md 레이어 인변성 + 코멘트 정책 + 코드 스타일 준수
- 커버리지 게이트 (≥80% lines/branches/functions/statements) 유지
- 매 라운드 끝에 한 줄 요약을 `.hyperclaude/autonomous-log.md`에 append (없으면 생성)
- 라운드 시작 전 `.hyperclaude/` 최근 artifact (plans/, code-reviews/, plan-reviews/) 확인하여 컨텍스트 흡수
- 시각 검증 (Playwright/manual) 은 자율 모드에서 스킵 — plan에 명시되어 있으면 unverified risk로 노트하고 진행

{{extra}}
```

(If `{{extra}}` is empty, drop the trailing newline so the prompt doesn't end with a blank section header.)
