---
name: cimulity-visual-test
description: Drive a Playwright browser session against the Cimulity dev server to visually verify renderer changes (cubes, palette, iso geometry, HUD). Uses the dev injection API at `window.__cimulity` to seed deterministic scenes, position the camera, and force-redraw. Use whenever a render-layer change needs visual confirmation that headless unit tests can't give.
---

# Cimulity Visual Test (Playwright + dev API)

Drive a Playwright session against `npm run dev` to capture before/after screenshots of renderer changes. The `window.__cimulity` dev API (installed by `GameSession` when `NODE_ENV === 'development'`) is the canonical injection surface — seed a scene declaratively, pan the camera by tile coord, force a redraw, screenshot.

## When to use

- A change touches `game/render/**` (visuals, palette, geometry, layer ordering).
- A change touches `game/core/Building.ts` / `World.tick()` / `LandValueMap.ts` and the effect is visual (cube heights, growth visualization, density tint).
- The user shares a screenshot pointing at an awkward visual ("cube looks off", "vertical line missing", "outline weird").

## When NOT to use

- Headless logic change (no render impact) — `npm test` is the right tool.
- Need to verify gameplay flow that requires user input timing (drag-place, hover) — manual test is faster than scripting Playwright pointer events for those.

## Prerequisites

- `npm run dev` is running on `http://localhost:3000` (or any port — probe + reuse).
- `process.env.NODE_ENV === 'development'` (always true for `next dev`) so `installDevApi(...)` actually attaches `window.__cimulity`.
- The Playwright MCP server is available (`mcp__plugin_playwright_playwright__*` tools).

## Procedure

### Step 1 — Ensure dev server is up

Probe with curl first. If down, start in the background with `Bash run_in_background: true` running `npm run dev`. If port 3000 is taken by a stray `next dev` lockfile, the new instance will fall back to 3001 and that's fine — just point Playwright at the responding port.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000 || echo "down"
```

### Step 2 — Navigate + wait for dev API

```js
// mcp__plugin_playwright_playwright__browser_navigate { url: "http://localhost:3000" }
// then:
// mcp__plugin_playwright_playwright__browser_evaluate { function: ... }
async () => {
  for (let i = 0; i < 30; i++) {
    if (window.__cimulity?.world && window.__cimulity?.pixiApp) break;
    await new Promise(r => setTimeout(r, 200));
  }
  return { ready: !!window.__cimulity };
}
```

### Step 3 — Seed a deterministic scene

Use `window.__cimulity.dev.seedScene(spec)`. The spec is declarative:

```ts
{
  tiles?: Array<{ x, y, type: TileType, level?: number }>,
  buildings?: Array<{
    id, type: 'residential' | 'commercial' | 'industrial',
    footprint: Array<{ x, y }>, anchor: { x, y },
    level, density: 0 | 1 | 2, age?: number,
  }>,
  clearExisting?: boolean, // default true
}
```

`seedScene` calls `BuildingMap.clear()` first (unless `clearExisting: false`), then `setTile` per tile + `addExistingBuilding` per building, then sets `nextIdFloor` above the max seeded id, then `markDirty()`. Returns `{ tilesPlaced, buildingsAdded }` for verification.

**Standard "all zone types × multiple levels" scene** (use as template):

```js
await page.evaluate(`async () => {
  const api = window.__cimulity;
  if (!api) return { ok: false };

  const TT = { ROAD: 'road', ZONE_R: 'zone_residential', ZONE_C: 'zone_commercial', ZONE_I: 'zone_industrial' };
  const tiles = [];
  const buildings = [];

  // Road row at y=10
  for (let x = 8; x <= 18; x++) tiles.push({ x, y: 10, type: TT.ROAD });
  // Residential row (levels 0..3)
  for (let i = 0; i < 4; i++) {
    const x = 9 + i;
    tiles.push({ x, y: 9, type: TT.ZONE_R, level: i });
    buildings.push({ id: 100 + i, type: 'residential', footprint: [{x, y: 9}], anchor: {x, y: 9}, level: i, density: 0 });
  }
  // Commercial row (levels 1..4)
  for (let i = 0; i < 4; i++) {
    const x = 9 + i;
    tiles.push({ x, y: 11, type: TT.ZONE_C, level: i + 1 });
    buildings.push({ id: 200 + i, type: 'commercial', footprint: [{x, y: 11}], anchor: {x, y: 11}, level: i + 1, density: 0 });
  }
  // Industrial row (levels 2..5)
  for (let i = 0; i < 4; i++) {
    const x = 9 + i;
    tiles.push({ x, y: 12, type: TT.ZONE_I, level: Math.min(i + 2, 5) });
    buildings.push({ id: 300 + i, type: 'industrial', footprint: [{x, y: 12}], anchor: {x, y: 12}, level: Math.min(i + 2, 5), density: 0 });
  }
  // 2x2 commercial (level 4, density 1)
  const foot22 = [{x:14,y:11},{x:15,y:11},{x:14,y:12},{x:15,y:12}];
  for (const c of foot22) tiles.push({ x: c.x, y: c.y, type: TT.ZONE_C, level: 4 });
  buildings.push({ id: 400, type: 'commercial', footprint: foot22, anchor: {x:14, y:11}, level: 4, density: 1 });

  const r = api.dev.seedScene({ tiles, buildings });
  api.dev.setCameraTile(13, 11);
  return { ok: true, ...r };
}`)
```

### Step 4 — Screenshot

**Always save under `.playwright-mcp/`** — never the repo root. That directory is the Playwright MCP server's scratch dir; keeping screenshots there means a single `rm -rf .playwright-mcp/` at the end leaves the working tree clean (no `.gitignore` entries needed):

```
mcp__plugin_playwright_playwright__browser_take_screenshot {
  type: "png",
  filename: ".playwright-mcp/cube-after-<change>.png",
}
```

Read the screenshot back to inspect visually:

```
Read /Users/zeikar/Developer/Projects/cimulity/.playwright-mcp/cube-after-<change>.png
```

### Step 5 — Cleanup (MANDATORY before finishing the turn)

The Playwright MCP server creates `.playwright-mcp/` and writes session console logs there even when the skill doesn't explicitly save anything. After the visual check is done — successful or not — remove the directory so the working tree is clean and `git status` doesn't show stray files:

```bash
rm -rf .playwright-mcp/
```

If a screenshot is genuinely useful to keep around (e.g. attaching to a PR description), save it to a path outside the repo first (`/tmp/`, `~/Desktop/`, etc.) before deleting `.playwright-mcp/`. Don't gitignore `.playwright-mcp/` as a workaround — the discipline is "skill cleans up after itself".

Also: do NOT shut down the user's dev server. If the skill started one in Step 1, leave it running (the user may want to keep iterating); the Bash `run_in_background` process stays alive across skill invocations.

### Step 6 — Iterating on a change

When code changes during a session (HMR-detected), the renderer may keep stale cached `GraphicsContext` objects (e.g. `CubeBuildingVisual.cache`). For visual changes that affect geometry/colors:

1. Either **hard-reload** the page (`browser_navigate http://localhost:3000`) — fresh `GameSession`, fresh `installDevApi`, fresh renderer caches.
2. Or call `api.dev.clear()` then re-seed — wipes BuildingMap (which forces all building visuals to unmount + remount).

A pure HMR update without a reload often won't show the change because the existing display objects still hold the old `GraphicsContext`.

## Dev API surface (reference)

`window.__cimulity` (dev only):

| Path | Description |
|---|---|
| `.world` | `World` instance — same object exposed at `__cimulityWorld` for HMR. |
| `.pixiApp` | `PixiApp` — access to `getTileRenderer()`, `getCamera()`, etc. |
| `.dev.seedScene(spec)` | Declarative scene seeding. Returns `{ tilesPlaced, buildingsAdded }`. |
| `.dev.setCameraTile(x, y)` | Center camera on world tile `(x, y)`. |
| `.dev.markDirty()` | Force full renderer redraw on next frame. |
| `.dev.clear()` | `world.reset()` + redraw. |

Defined in [game/engine/devApi.ts](../../../game/engine/devApi.ts). Installed by [GameSession.start](../../../game/engine/GameSession.ts). Uninstalled on `GameSession.dispose()` and stripped in production.

## Anti-patterns

- **Direct mutation of `window.__cimulityWorld`** in tests when `__cimulity.dev.seedScene` would do — the dev API takes care of `markDirty()` + id-floor automatically.
- **Forgetting to reset the camera** before screenshotting. The default camera is at `(600, -590)` looking outside the seeded test area. Always call `dev.setCameraTile(...)` before the screenshot.
- **Trusting HMR for renderer cache changes**. If your change is in `CubeBuildingVisual` / `cubeGeometry.ts` / `palette.ts` / `DiamondTileVisual.ts`, hard-reload the page after the edit — the renderer's display-object map + the visual's `GraphicsContext` cache survive HMR.
- **Screenshotting without `clearExisting: false`** when iterating on a single scene. Each `seedScene` call wipes prior buildings; if you want to add to an existing scene, pass `clearExisting: false`.
- **Asserting pixel-exact equality** between before/after screenshots. Iso draw order can shift by 1px across HMR; compare visually or use a tolerance-based diff if regression testing.
- **Adding `.playwright-mcp/` to `.gitignore` as a workaround** for the artifacts the MCP server creates. The skill's Step 5 cleanup is the contract — keep the gitignore clean.
- **Saving screenshots to the repo root** (`cube-after.png`, etc.). Always under `.playwright-mcp/` so a single `rm -rf` at cleanup wipes them.
