# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Cimulity is a browser city-sim (Next.js 16 App Router + React 19 + PixiJS 8, TS strict). See README.md for the full architecture diagram, coordinate math, and roadmap — this file covers only what isn't obvious from reading it.

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

`input` (raw drag endpoints) → `tools` (build commands + resolve paths, **pure, never mutate core**) → `engine` (dispatch) → `core` (the only place state mutates) → `render` (draws from core). React is just the shell.

Concretely:
- **Tools are pure.** A tool returns `ToolCommand[]`; it never touches `World`/`Map`. The *only* place tool output reaches core is `applyCommands` in [game/engine/CommandDispatcher.ts](game/engine/CommandDispatcher.ts). Adding a new tool means adding a path branch in `pathForTool` and a command builder — not reaching into core from the tool.
- **Clicks and drags share one path.** Single-tile clicks go through `executeClick`, drags through `executeDrag`/`previewDrag` — both end in `applyCommands`. Don't add a separate click mutation route.
- **`GameSession`** ([game/engine/GameSession.ts](game/engine/GameSession.ts)) is the composition root that wires Pixi + input handlers + dispatch. React holds only mount/unmount + display state and passes stable forwarder callbacks (avoid stale prop closures here).
- The `World` is a **process-wide singleton** via [game/core/worldStore.ts](game/core/worldStore.ts) so placed tiles survive HMR/Fast Refresh. Don't `new World()` in components.

When adding code, keep the dependency direction strictly downward — no layer imports from a layer below it in a way that reverses this flow, and no circular deps between layers.

## Testing

Tests are `*.test.ts` colocated next to source under `game/`. The coverage gate (80% lines/statements/functions/branches) is **deliberately scoped** to the pure-logic files listed in [vitest.config.ts](vitest.config.ts) (core state, RoadTool, ToolActions, CommandDispatcher, IsoTransform). Pixi render glue, DOM input handlers, and `GameSession` are intentionally excluded — verify those by gameplay/manual testing, not headless mocks. New pure logic should land in (or alongside) the gated files and stay above threshold.
