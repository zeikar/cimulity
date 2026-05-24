# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Cimulity is a browser city-sim (Next.js 16 App Router + React 19 + PixiJS 8, TS strict). See [docs/architecture.md](docs/architecture.md) for the full layer diagram, directory structure, and coordinate math; [README.md](README.md) for project status and roadmap. This file covers only what isn't obvious from reading those.

## Commands

```bash
npm run dev          # Next dev server (localhost:3000)
npm run build        # production build
npm run lint         # eslint
npm test             # vitest run (one-shot)
npm run test:watch   # vitest watch
npx vitest run game/tools/RoadTool.test.ts        # single test file
npx vitest run -t "snaps to 45"                   # single test by name
```

`@` is a path alias to the repo root (configured in both `tsconfig.json` and `vitest.config.ts`).

## Layer boundary — the core invariant

Data flows in one direction only, and each layer's job is fixed:

`input` (events → tile coords + active tool) → `engine` (`CommandDispatcher` orchestrates: calls `tools` helpers for path + commands, then writes via `applyCommands` — the only path for tool-driven core mutation) → `core` (also mutated by `World.tick` simulation, save hydration, `GameSession.resetWorld`, and dev-only `devApi` seeding) → `render` (draws from core). React is just the shell.

Concretely:
- **Tools are mutation-free.** A tool's path rule + command builder may *read* `World`/`Map` (e.g. `buildToolCommands(tool, tiles, world)` reads `world.getMap()` to decide intent), but never writes to them. The *only* place tool output reaches core is `applyCommands` in [game/engine/CommandDispatcher.ts](game/engine/CommandDispatcher.ts). Adding a new tool means adding a path branch in `pathForTool` and a command builder — not reaching into core mutation from the tool.
- **Clicks and drags share one path.** Single-tile clicks go through `executeClick`, drags through `executeDrag`/`previewDrag` — both end in `applyCommands`. Don't add a separate click mutation route.
- **`GameSession`** ([game/engine/GameSession.ts](game/engine/GameSession.ts)) is the composition root that wires Pixi + input handlers + dispatch. React holds only mount/unmount + display state and passes stable forwarder callbacks (avoid stale prop closures here).
- The `World` is a **process-wide singleton** via [game/core/worldStore.ts](game/core/worldStore.ts) so placed tiles survive HMR/Fast Refresh. Don't `new World()` in components.

When adding code, keep the dependency direction strictly downward — no layer imports from a layer below it in a way that reverses this flow, and no circular deps between layers.

## Language

All content in this repository — code, comments, identifiers, JSDoc, commit messages, Markdown docs, and skills under `.claude/` — is written in English. No exceptions.

## Backwards compatibility — none yet

The game has no production users. No save-format migrations, no legacy storage-key paths, no transitional code arms unless **explicitly requested**.

When a schema/format changes:
- Bump the storage key (e.g. `cimulity:save:vN`) so stale saves are never read.
- Reject any non-current save version in `deserializeWorldInto` — `worldStore` falls back to a fresh procedural world.
- Remove the previous code path in the same change. No deprecation period, no dual-read arms.

If a plan-review (Codex or otherwise) flags "missing migration from vN-1 → vN" as a blocker, treat it as out of scope unless the user asks for it.

## Testing

Tests are `*.test.ts` colocated next to source under `game/`. The coverage gate (80% lines/statements/functions/branches) is **deliberately scoped** to the pure-logic files listed in [vitest.config.ts](vitest.config.ts) (core state, RoadTool, ToolActions, CommandDispatcher, IsoTransform). Pixi render glue, DOM input handlers, and `GameSession` are intentionally excluded — verify those by gameplay/manual testing, not headless mocks. New pure logic should land in (or alongside) the gated files and stay above threshold.
