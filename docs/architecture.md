# Architecture

The codebase follows a strict layered architecture to maintain clean separation of concerns.

> **Boundary principle:** input translates browser events into tile coords + active tool → engine (`CommandDispatcher`) orchestrates: it calls tools (pure helpers) to resolve paths and build commands, then applies those commands to core. **Tool-driven** core mutation only happens through engine dispatch. Other sanctioned core writes — simulation (`World.tick`), save hydration (`mapSerialization`), New City reset (`GameSession.resetWorld`), dev-only seeding (`devApi`) — are separate documented paths. Render reads core. React is the shell.

```
┌─────────────────────────────────────────────────────────────┐
│                    React Shell                               │
│  - HUD mirrors (fps, camera, sim) + toolbar control state    │
│    (tool, speed tier, pause) + buffered toolbar commands     │
│  - GameCanvas, GameHUD, Toolbar                              │
└────────────────────┬────────────────────────────────────────┘
                     │ Callbacks & Events
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Input Layer                               │
│  - PointerHandler (hover / click / drag / drag-preview;      │
│    runs camera + iso picking against the map)                │
│  - CameraController (edge-pan / wheel zoom — mutates Camera) │
│  - KeyboardHandler (tool, speed tier, pause)                 │
│  - ToolManager (active tool state)                           │
│  - Reads core for picking; never mutates core                │
└────────────────────┬────────────────────────────────────────┘
                     │ Tile coords + active tool
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Engine Layer                              │       ┌────────────────────────────────┐
│  - CommandDispatcher                                         │──────▶│        Tools Layer             │
│      • pathForTool (snapRoad / rectDrag)                     │ calls │  (pure helpers, not a serial   │
│      • executeClick / executeDrag / previewDrag              │       │   node — invoked BY Engine)    │
│      • applyCommands — only path for tool-driven core writes │       │  - Tool enum                   │
│  - GameSession (composition root: Pixi + input + dispatch)   │◀──────│  - RoadTool/BulldozeTool path  │
│  - devApi (window.__cimulity dev hooks; dev-only core seed)  │ cmds  │    rules                       │
└────────────────────┬────────────────────────────────────────┘       │  - ToolActions                 │
                     │ State mutations                                 │    .buildToolCommands          │
                     │ (also: World.tick, mapSerialization hydration)  │    (reads World → commands)    │
                     ↓                                                 │  - ToolCommand contract        │
┌─────────────────────────────────────────────────────────────┐       │  - Pure-read of core, never    │
│                    Core Layer (state primitives)             │◀──────│    mutates                     │
│  - World (state container; tick simulation, economy, date)   │ reads └────────────────────────────────┘
│  - GameMap (2D grid; owns BuildingMap)                       │
│  - Tile, Building (data models)                              │
│  - BuildingMap (id-keyed registry: footprints, anchors,      │
│    level/density/age — read by sim, render, persistence)     │
│  - LandValueMap (derived land-value field)                   │
│  - GameLoop (fixed-timestep tick driver; pause + speed)      │
│  - worldStore (process-wide singleton + localStorage save)   │
│  - mapSerialization (versioned save envelope + hydration)    │
│    (debounced save scheduling lives in GameSession)          │
└────────────────────┬────────────────────────────────────────┘
                     │ Reads state
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Render Layer                              │
│  - PixiApp (lifecycle + viewport culling orchestration)      │
│  - Camera (pan/zoom transforms with bounds + zoom limits)    │
│  - IsoTransform (coordinate conversion)                      │
│  - TileRenderer, GridRenderer, SelectionRenderer             │
│  - visuals/ registry: DiamondTileVisual, CubeBuildingVisual  │
│  - viewportCulling (visible-tile bounds)                     │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
cimulity/
├── app/                          # Next.js App Router
│   ├── components/               # React components
│   │   ├── GameCanvas.tsx        # PixiJS mount point
│   │   ├── GameHUD.tsx           # HUD overlay
│   │   └── Toolbar.tsx           # Tool selection UI
│   ├── page.tsx                  # Main game page
│   ├── layout.tsx                # Root layout
│   ├── manifest.ts               # PWA manifest
│   └── globals.css               # Global styles
│
├── game/                         # Game engine code
│   ├── input/                    # Input layer (events → coords + active tool)
│   │   ├── PointerHandler.ts     # Mouse/touch input
│   │   ├── CameraController.ts   # Edge-pan / wheel zoom
│   │   ├── KeyboardHandler.ts    # Tool / speed / pause keys
│   │   └── ToolManager.ts        # Active tool state
│   │
│   ├── tools/                    # Tools layer (pure: commands + paths)
│   │   ├── Tool.ts               # Tool enum
│   │   ├── RoadTool.ts           # Road path rule
│   │   ├── BulldozeTool.ts       # Bulldoze rect rule
│   │   ├── ToolActions.ts        # buildToolCommands (reads World → commands)
│   │   ├── ToolCommand.ts        # Command contract
│   │   └── ToolResult.ts         # Result types
│   │
│   ├── engine/                   # Engine layer (dispatch + session)
│   │   ├── CommandDispatcher.ts  # Routes commands to core
│   │   ├── GameSession.ts        # Composition root
│   │   └── devApi.ts             # window.__cimulity dev hooks
│   │
│   ├── core/                     # Core layer (state + simulation)
│   │   ├── Tile.ts               # Tile data model
│   │   ├── Building.ts           # Building model + BuildingMap registry
│   │   ├── Map.ts                # 2D grid structure
│   │   ├── World.ts              # World state + tick logic
│   │   ├── LandValueMap.ts       # Derived land-value field
│   │   ├── GameLoop.ts           # Fixed-timestep loop
│   │   ├── worldStore.ts         # Process-wide singleton + localStorage
│   │   └── mapSerialization.ts   # Versioned save format
│   │
│   ├── render/                   # Rendering layer (draws from core)
│   │   ├── PixiApp.ts            # PixiJS lifecycle + culling
│   │   ├── Camera.ts             # Camera system
│   │   ├── cameraConstraints.ts  # Bounds + centering math
│   │   ├── IsoTransform.ts       # Coordinate transforms
│   │   ├── viewportCulling.ts    # Visible-tile bounds
│   │   ├── TileRenderer.ts       # Tile + building mounting
│   │   ├── GridRenderer.ts       # Debug grid lines
│   │   ├── SelectionRenderer.ts  # Hover/selection highlights
│   │   └── visuals/              # Per-tile visual implementations
│   │       ├── TileVisual.ts        # Visual contract
│   │       ├── visualRegistry.ts    # Type → registered visual instance
│   │       ├── palette.ts           # Color palette
│   │       └── polygon/             # Polygon-based visuals
│   │           ├── DiamondTileVisual.ts
│   │           ├── CubeBuildingVisual.ts
│   │           ├── cubeGeometry.ts
│   │           ├── cubeLift.ts
│   │           ├── cubeRoofAccent.ts
│   │           ├── cubeTypeRatios.ts
│   │           └── cubeDropShadow.ts
│   │
│   └── types/                    # Shared TypeScript types
│       ├── coordinates.ts        # Coordinate types
│       └── events.ts             # Event types
│
└── package.json
```

## Key Technical Details

### Isometric Coordinate System

The game uses **diamond isometric projection** (classic 45° rotation):

```typescript
// Tile → Screen (64x32 tile size)
screenX = (tileX - tileY) * 32
screenY = (tileX + tileY) * 16

// Screen → Tile (fractional inverse — screenToTile() floors both axes
// to return discrete tile indices for picking)
tileX = (screenX/32 + screenY/16) / 2
tileY = (screenY/16 - screenX/32) / 2
```

### Camera System

- **Pan**: Move cursor within 32px of any canvas edge; speed scales with proximity (up to 600px/s)
- **Zoom**: Mouse wheel zooms around cursor position (not center)
- **Constraints**: Pan limited to map boundaries, zoom 0.25x - 2x
- **Algorithm**: scalar position + zoom arithmetic for screen↔world conversion; Pixi container `position` + `scale` applied for rendering

```typescript
// Zoom around cursor
worldBefore = (cursorPos - cameraPos) / oldZoom
// Update zoom
worldAfter = (cursorPos - cameraPos) / newZoom
cameraPos += (worldAfter - worldBefore) * newZoom
```

### Tile Picking Pipeline

```
Canvas Click → Camera.screenToWorld() → IsoTransform.screenToTile() → Map.getTile() → Validate bounds
```

### Simulation Loop

`GameLoop` is a fixed-timestep accumulator pumped by `setInterval` at `tickMs / 4`:

- **Tick rate**: `DEFAULT_TICK_MS` (1000ms) wall time = 1 sim tick at 1x speed
- **Speed tiers**: 1x / 2x / 3x discrete multipliers (`KeyboardHandler` keys `1`/`2`/`3`); wall-clock elapsed is multiplied before accumulating
- **Pause**: `Space` toggles; the interval keeps pumping but elapsed wall-clock is discarded so resuming doesn't credit a phantom burst
- **Catch-up**: up to `MAX_CATCHUP_TICKS` (5) per advance to recover from tab-switch / GC pauses without spiraling

Each tick (`World.tick`, 1 tick = 1 day):

1. Advances `tickCount` and `day` first (post-increment — so the first growth tick fires when `tickCount === ZONE_GROWTH_INTERVAL`, not at 0)
2. Recomputes land value if dirty, or unconditionally on `LAND_VALUE_INTERVAL` cadence (defense-in-depth)
3. Heals all `DIRT` tiles back to `GRASS`
4. On a month-boundary day (`day % DAYS_PER_MONTH === 0`), settles a month of tax at the pre-growth population
5. On growth ticks (`tickCount % ZONE_GROWTH_INTERVAL === 0`), walks zone tiles in two branches — **both require an orthogonal road neighbor**:
   - No building yet on this tile → create a level-0 building (road adjacency is the only gate)
   - Building already exists → level-up / density growth gated by land-value thresholds + per-building cooldown

   The growth pass reads `landValue` as a frozen snapshot taken at step 2.

### Procedural terrain generation

Pipeline: `createRng(seed)` → `fbm2d` (fractional Brownian motion via `valueNoise`) → `shapeHeightmap` → `buildWaterMask` → `generateTerrain` composes all four into a fully populated `GameMap`.

Default seed: `DEFAULT_NEWCITY_SEED = 0xC1A1E11`.

Invocation rule: `new World(W, H)` and `World.reset({ regenerate: true })` invoke the generator. Save-hydration callsites (`worldStore.getWorld` when a save exists, `deserializeV5`/`deserializeV6`) construct/reset with `{ regenerate: false }` so the generator does NOT run on load.

Failure fallback: `worldStore.getWorld` invokes `world.reset({ regenerate: true })` if `deserializeWorldInto` fails on a corrupt save, producing a fresh procedural map.

HMR guard: `hasCurrentWorldApi` requires `regenerateTerrain` on the world singleton — stale pre-change singletons are discarded and a new one is created.

Dev hook: `window.__cimulity.dev.regenerateTerrain(seed?)` routes through `GameSession.regenerateTerrain` (full destructive-reset cleanup of Pixi containers and input state) before calling `world.regenerateTerrain`.

### Rendering Strategy

- **Per-tile Graphics**: each visible tile/building owns its own Pixi `Graphics` (no shared batch). `DiamondTileVisual` and `CubeBuildingVisual` mount on demand.
- **Viewport culling**: `viewportCulling.visibleTileBounds()` returns **separate `terrain` and `buildings` tile-index ranges** from camera state; the buildings range is expanded by `MAX_BUILDING_LIFT_PX` so lifted cube tops near the viewport edge aren't clipped. `TileRenderer` mounts only tiles within those bounds, and unmounts/destroys their visuals when they leave the view (they're rebuilt on remount).
- **Visual registry**: `visuals/visualRegistry.ts` holds two maps — `terrainByType` (TileType → terrain visual instance) and `buildingByType` (BuildingType → building visual instance) — registered at startup. Decouples tile/building data from polygon shapes.
- **React ↔ Pixi bridge**: `GameCanvas` keeps the latest callbacks in `callbacksRef` and exposes a `stableForwarders` ref whose identity never changes — the mount effect captures forwarders once, so React re-renders never re-mount the Pixi session.

### React StrictMode Safety

- **Idempotent initialization**: `PixiApp.init()` can be called multiple times safely
- **Effect cleanup + disposal flag**: the mount effect's cleanup clears `sessionRef.current` and disposes the session; `GameSession` checks a `disposed` flag so an in-flight `pixiApp.init()` that resolves *after* StrictMode unmount is discarded cleanly
- **Ref guards**: prevent duplicate session creation within a single mounted effect path
- **Proper cleanup**: All PixiJS resources destroyed on unmount
- **No memory leaks**: Verified with hot reload testing
