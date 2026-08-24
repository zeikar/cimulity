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
│  - BuildingMap (id-keyed registry: footprints,               │
│    anchors, level/density/age/structureRect —                │
│    capacity inputs, read by sim, render, persistence)        │
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
│  - TileRenderer, SelectionRenderer                          │
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
│   │   ├── DataViewPanel.tsx     # Traffic/Jobs data-view toggle + legend
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
│   │   ├── roadGraph.ts          # Shared road-graph primitives (BFS steps, access nodes)
│   │   ├── laborMarket.ts        # Worker↔job matching over the road graph → commute O-D flows
│   │   ├── LaborMarketMap.ts     # Dirty/lazy labor-market holder (mirrors coverage maps)
│   │   ├── trafficAssignment.ts  # Loads commute flows onto road tiles → 0..255 congestion
│   │   ├── TrafficMap.ts         # Dirty/lazy traffic-congestion holder
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
│   │   ├── SelectionRenderer.ts  # Hover/selection highlights
│   │   ├── dataView.ts           # DataView type ('none' | 'traffic' | 'jobs')
│   │   ├── dataViewColors.ts     # Congestion/employment color ramps + per-building shares
│   │   ├── overlays/             # Render-only data overlays (read core, never mutate)
│   │   │   ├── UtilityStatusOverlay.ts
│   │   │   └── DataViewOverlay.ts    # Traffic/Jobs diamonds over road tiles / footprint cells
│   │   └── visuals/              # Per-tile visual implementations
│   │       ├── TileVisual.ts        # Visual contract
│   │       ├── visualRegistry.ts    # Type → registered visual instance
│   │       ├── palette.ts           # Color palette
│   │       └── polygon/             # Polygon-based visuals
│   │           ├── DiamondTileVisual.ts
│   │           ├── CubeBuildingVisual.ts
│   │           ├── cubeGeometry.ts
│   │           ├── cubeLift.ts
│   │           ├── cubeTypeRatios.ts
│   │           ├── cubeDropShadow.ts
│   │           ├── buildingMassing.ts   # Procedural massing plan (boxes/gables/props) per building
│   │           ├── massingGeometry.ts   # Fractional-rect → screen-face geometry for massing boxes
│   │           ├── windowGeometry.ts    # Window frame/glass inset-quad geometry (punched/curtain)
│   │           └── heightContour.ts     # Height-contour triangle clip (coastal sand / highland rock)
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
2. Recomputes utility and coverage maps if dirty or on their own cadence: `PowerMap` (binary road-BFS reachability from power plants), `WaterMap` (same pattern for water towers), `ServiceCoverageMap` (police), `FireCoverageMap` (fire), `HospitalCoverageMap` (hospital), and `SchoolCoverageMap` (school) — all four coverage maps use `propagateServiceCoverage` + the same constants, each hard-coding its own source type, graded 0..255 intensity, MAX across stations via min-distance. These are not persisted. In the same step, `TrafficMap` recomputes if dirty, or force-recomputes every `TRAFFIC_INTERVAL` (16) ticks — traffic is a simulation input now (it feeds land value and happiness, see below), so there is no "unread, skip the cadence recompute" guard. A traffic recompute always force-refreshes `LaborMarketMap` first (see "Traffic & Labor Market" below), since traffic loads the labor market's matched commute flows. Traffic resolves before land value (step 3 reads the congestion snapshot produced here), and both maps are then frozen read-only for the rest of the tick.
3. Recomputes land value if dirty, or unconditionally on `LAND_VALUE_INTERVAL` cadence (defense-in-depth). **Land value depends on coverage and traffic being fresh** (it reads the four coverage maps and the `TrafficMap` computed in step 2); a coverage or traffic change marks land value dirty, so all three are always in sync.
4. Heals all `DIRT` tiles back to `GRASS`
5. On a month-boundary day (`day % DAYS_PER_MONTH === 0`), settles a month of tax at the pre-growth population
6. On growth ticks (`tickCount % ZONE_GROWTH_INTERVAL === 0`), first runs an **abandonment sweep** over every building (added service-v8 / save v18 — `Building.abandoned: boolean`): if land value at the anchor no longer supports the building's level, it flips `abandoned = true`; if a previously-abandoned building's anchor land value now supports its level again, it flips back to `false`. Either flip freezes the building for the rest of this tick — recorded in a `frozenThisTick` set, not the live `abandoned` field, so a building that just re-occupied is still skipped by growth/merge below. Abandoned buildings are excluded from population, jobs, demand, and the labor market; the sweep runs before demand is (re)computed so this tick's growth pass already sees demand net of the buildings that just went derelict. The render layer shows a derelict tint with dark windows.

   The pass then walks zone tiles in two branches — **both require frontage road access**, though neither requires the tile itself to touch a road, and both skip any building frozen this tick:
   - No building yet on this tile → create a **level-1** building, gated on demand above `GROWTH_DEMAND_THRESHOLD` for that zone type, power at the seed tile, a frontage road (`pickSeedFrontage` scans distances 1..4 cardinally, tie-breaking S > E > W > N, so a seed may sit up to four cells behind the road), and a valid lot (`greedyDepthLot`)
   - Building already exists → gated first on `hasFrontageRoadAccess` + power (a building that loses either stops aging entirely), then one of three mutually exclusive branches, checked in this order:
     - **structure can still extend** (`canExtendStructure`, checked at ANY level now, not only below max) → grow the `structureRect` one cell along the depth axis, gated on demand above `GROWTH_DEMAND_THRESHOLD`, anchor land value ≥ `LEVEL_THRESHOLDS[min(level+1, ZONE_MAX_LEVEL)]` (the lookahead is clamped so a max-level building's threshold read doesn't land on the undefined index past the array's end), age cooldown, water, AND all four service coverages at the anchor
     - **structure is capped and `level < ZONE_MAX_LEVEL`** → level up, gated on the same demand/land-value/cooldown/water/coverage conditions
     - **structure is capped and at `ZONE_MAX_LEVEL`** → density bump, gated on demand ≥ `DENSITY_DEMAND_THRESHOLD`, its own cooldown, `density < 2`, water, AND the same four service coverages — deliberately **no land-value gate**: the abandonment sweep above already froze any level-5 building whose anchor land value sits below `LEVEL_THRESHOLDS[ZONE_MAX_LEVEL]` against this same frozen snapshot, so every building that reaches this branch already clears it and an explicit check would be dead code (that same sweep is also what claws density-created capacity back if land value later drops)

     Below `ZONE_MAX_LEVEL` this ordering is bit-identical to before (structure-grow already preceded level-up there). The one behavioural change is at max level: a building whose structure can still extend now does that instead of densifying. This is reachable only after a second-generation (4-wide) merge — a first-generation (2-wide) merge's depth cap is unchanged at `max(2, 2) = 2`, so only 4-wide-and-up lots (equal-shape merges double width 1→2→4) ever have room left to extend.

   Separately, after the per-tile loop, a width-axis **merge** pass considers every pair of adjacent, same-type, same-frontage buildings. On top of its existing geometry checks (equal lot depth, frontage-edge alignment, width-axis adjacency, 4×4 lot cap), `canMerge` now also requires equal `level`, equal `density`, and equal `structureRect` dimensions, which makes `buildingCapacity(merged) === buildingCapacity(a) + buildingCapacity(b)` hold exactly — a merge can no longer silently destroy capacity the way an unequal-shape union used to. The equal-level gate doubles as a fix for a related defect: the merged building's anchor is always one of the two originals' anchors, whose level the abandonment sweep already verified as supported this same tick, so a merge can no longer hand the next sweep a building it immediately abandons. Merging is capacity-*neutral* at first generation (a 2-wide merged lot's depth cap is still `max(2, 2) = 2`, so no new depth is gained) and only doubles capacity after a second merge (to 4-wide) plus the structure regrowing into the raised cap — not a flat capacity increase on every merge.

   The growth pass reads `landValue` as a frozen snapshot taken at step 3. Power gates initial zone spawn (checked on the seed tile, since no footprint exists yet) *and* every existing-building mutation — an unpowered building does not even age; water gates the mutations themselves at the footprint (binary): structure growth, level-up, density, and merge. Level-up and structure-grow additionally require police, fire, hospital, AND school coverage at the building anchor tile (graded fields gate at the anchor, not the footprint) — those same four coverages also raise land value via the combined service term.

   `LandValueMap` is a derived scalar field (0..1 per tile), recomputed on dirty/interval cadence. Three weighted inputs sum to a 1.0 base, PLUS an additive park boost and a subtractive road-congestion penalty, all clamped:
   - **Road proximity** (weight 0.40) — Chebyshev distance to nearest road within radius 6 (no BFS, pure distance).
   - **Zone-mix diversity** (weight 0.10) — distinct zone types in the 3×3 neighbourhood, divided by 3.
   - **Service coverage** (weight 0.50) — the average of the four services' normalised coverage (police, fire, hospital, school).
   - **Park proximity** (additive +0.25 max) — Chebyshev distance to nearest park cell within radius 4, nearest-park strongest-wins; park is a separate land-value amenity, NOT a coverage service.
   - **Road congestion** (subtractive −0.20 max) — the strongest distance-weighted congestion among ROAD tiles within radius 6, max-wins across tiles so two jammed roads don't stack; see `CONGESTION_PENALTY_MAX` in `LandValueMap.ts` for the magnitude rationale.

   Final: `clamp(0.40 * road + 0.10 * diversity + 0.50 * service + 0.25 * park - 0.20 * congestion, 0, 1)`.

   **Dual role of services:** the four coverage services hard-gate level-up, structure growth, AND the density bump at the building anchor in `World` (all four must cover the anchor), AND contribute to land value via the combined service term. A coverage-map or traffic change marks land value dirty (dirty cascade).

   Gate summary: power → initial spawn (seed tile) + all existing-building aging/growth/merge; water → structure growth, level-up, density, and merge at the footprint (binary); four coverage services → level-up, structure-grow, AND density bump at anchor (AND-gate); land value (road + diversity + service + park − congestion) → level-up/structure-grow at anchor via `LEVEL_THRESHOLDS` — deliberately NOT the density bump, since the abandonment sweep already enforces `LEVEL_THRESHOLDS[ZONE_MAX_LEVEL]` there against the same frozen snapshot. Density is further gated by demand ≥ `DENSITY_DEMAND_THRESHOLD`, its own cooldown, and water; merge by demand ≥ `DENSITY_DEMAND_THRESHOLD`, cooldown, water, and the equal-level/equal-density/equal-`structureRect` shape gates that make it capacity-conserving.

   Any building change in the growth pass (spawn, level-up, density bump, merge, or abandonment flip) calls `markLaborDirty()`, which cascades to `markTrafficDirty()` (traffic loads the labor market's commute flows, and — since traffic now feeds land value and happiness too — that call cascades again to `dirtyLandValueAndHappiness()`) and `markDemandDirty()` (demand is now derived from the labor market — see below); a single call keeps labor, traffic, land value, happiness, and demand all in sync. See "Traffic & Labor Market" below for the full cascade and the resulting across-tick feedback loop.

### Traffic & Labor Market

Two derived, non-persisted data layers — added after zoning/land-value/coverage were already in place — model commuting and its effect on road congestion, and now feed that congestion back into land value and happiness as a simulation input. Neither has a dedicated `systems/` file yet; this is the interim summary per [README.md](README.md).

- **Shared road graph** (`game/core/roadGraph.ts`): pure primitives used by both modules below — `ORTHOGONAL` step table, `accessNodeFor` (lowest-index ROAD cell on a building's frontage face), and `buildStructureOwned`/`isRoadNode` (the BFS must never route through a placed structure's footprint). Reads only `GameMap`/`StructureMap`/`Building`; must not import `World` or `zoneGrowth`.
- **Labor market** (`game/core/laborMarket.ts` + `LaborMarketMap.ts`): every non-abandoned residential building supplies `buildingCapacity(b)` workers and every non-abandoned commercial/industrial building supplies `buildingCapacity(b)` job capacity. `buildingCapacity` (`game/core/buildingCapacity.ts`: `structureRect.w * structureRect.h * level * DENSITY_CAPACITY_UNITS[density]`) is the one shared function `World.getPopulation`, `World.recomputeHappiness`, this labor market, `Demand.recompute`'s retail axis, and the jobs data-view overlay all sum — so simulated commuters, job slots, city population, and the HUD/overlay figures are always denominated in the same unit and can never drift apart — otherwise the sim would route a fraction of the residents it claims to have and every volume-calibrated knob downstream would be measured against the wrong magnitude. Only buildings with road access become graph nodes. A road-less residential building's workers go straight to `unemployed`; a road-less C/I building's capacity still counts toward `jobsCapacity` but is never inserted into `capByNode`, so it can never be filled. Zero-worker (level-0) origins are skipped so they don't inflate `reachableUnfilledJobs`. Matching is greedy nearest-with-overflow — a forward BFS from each origin's access node ranks reachable job nodes by road-hop distance, filling the nearest node with remaining capacity first and spilling over to the next when it fills. Capacity is global and consumed in deterministic origin order (ascending access-node index, then building id). Produces `CommuteFlow[]` (origin node → destination node → worker count) plus `employed`/`unemployed`/`jobsCapacity`/`jobsFilled`/`reachableUnfilledJobs` scalars. `Demand.recompute` (`game/core/Demand.ts`) is now a stateless function of that same snapshot, not an additive nudge onto separate structural terms: it derives a single aggregate workplace severity from the shortfall between reachable vacancies and `unemployed` against the whole labor market — deadbanded below `DEADBAND_RATE`, saturating at `SATURATION_RATE`, and floored at `MIN_MARKET` (`20 * POPULATION_PER_TILE_LEVEL`) so one *modal* density-0 building-level of imbalance (`structureRect` area 2) still reads as partial severity — then splits that one severity `COMMERCIAL_JOB_SHARE` / `1 - COMMERCIAL_JOB_SHARE` between commercial and industrial so neither double-counts the same shortage. Commercial additionally answers an internal-market retail axis (its capacity share against `COMMERCIAL_CAPACITY_SHARE`, damped by labor availability), and residential is the larger of its own mirrored severity (a vacancy surplus rather than a shortage) or `MIGRATION_PRESSURE` — a separately named external growth driver damped to zero as unemployment approaches `MIGRATION_UNEMPLOYMENT_CUTOFF`, not a baseline folded into the formula — except when the labor market holds neither workers nor job capacity (`marketEmpty`), when residential instead reads the flat `BOOTSTRAP_RESIDENTIAL_DEMAND`. Commercial and industrial carry the same kind of external driver: a `workplaceFloor` of `WORKPLACE_PRESSURE`, scaled by the same staffing damper (`1 - resSeverity`) that gates the retail axis, combined by `max` outside the severity on both bars, and forced to exactly 0 whenever the labor market holds no workforce at all (nothing left to staff a new workplace). A fully employed, balanced city therefore reads R 0.10 / C 0.10 / I 0.10 — commercial and industrial no longer rest at zero there, each bar now resting on its own external driver once the labor-derived severities settle at zero, and each damping to exactly 0.00 only past its *own* cutoff: at net labor balance, R reaches 0.00 once unemployment hits `MIGRATION_UNEMPLOYMENT_CUTOFF` (away from balance a vacancy surplus still drives R through `resSeverity`, so past-cutoff R is not always zero), while C and I reach 0.00 once the reachable-vacancy surplus hits `SATURATION_RATE` (an empty workforce zeroes the floor and therefore industrial, but commercial can still read its retail axis there — the zero-workforce hamlet reads C ≈ 0.19). Without an external driver on all three, the all-zero state would be absorbing (an empty zone tile supplies no workers, jobs, or levels to escape it); with them, `MIGRATION_PRESSURE` and `WORKPLACE_PRESSURE` together keep all three spawn/level-up gates open at `GROWTH_DEMAND_THRESHOLD` while every labor-derived severity sits at zero. Demand only states a direction, never the brake — land value, power, water, the four service coverages, and the age cooldown do the actual pacing — and this stateless formula has no lagged census, no integrator/anti-windup valve, and no per-tile stochastic evaluation, so a large newly-zoned block can spawn in a single growth pass and overshoot before the next tick's labor recompute reflects it.
- **Traffic assignment** (`game/core/trafficAssignment.ts` + `TrafficMap.ts`): consumes the labor market's `CommuteFlow[]` and loads each flow's worker count onto every road tile along the *exact* shortest road path from its origin to its exact destination. Flows are grouped by destination and a single reverse BFS is run per distinct destination (not one shared multi-source BFS) — an overflow flow may have been matched to a farther job than the nearest one, so routing must stay per-destination-exact. Load is normalized against `TRAFFIC_CAPACITY` (`100 * POPULATION_PER_TILE_LEVEL`, still 500 — chained to the same per-structure-tile-per-level commuter unit `buildingCapacity` multiplies, not re-derived from `POPULATION_PER_LEVEL` in parallel, so modelling labor participation later cannot silently decalibrate it) into a `0..255` congestion value per road tile. It is calibrated from the un-normalized trip loads measured in two play-verified cities — a single-corridor city, whose mid-corridor tiles carry the whole employed population and so saturate, versus an ordinary lattice with jobs among the homes, whose busiest street carries only the handful of short commutes that overlap on it. Capacity sits in the gap: the corridor city reads near-saturated — un-clamped at the sizes measured, and clamping only once its employed population passes the capacity — and takes roughly one `LEVEL_THRESHOLDS` band of land-value penalty, while an ordinary layout is nudged below the margin that would abandon anything. The measured loads, the rejected alternatives, and the numbers live in the `TRAFFIC_CAPACITY` JSDoc, which is the single source for them. `TrafficMap.getCongestionIndex()` reduces the whole grid to a single congestion-intensity-weighted mean in `[0, 1]` (`Σc_i² / (255 · Σc_i)`, each tile's own congestion doubling as its weight) for the happiness KPI below.
- **Feedback into land value and happiness**: `LandValueMap.recompute` takes the `TrafficMap` as a fourth argument and subtracts a proximity-weighted congestion penalty (see the land-value formula above); `World`'s happiness formula subtracts `HAPPINESS_W_TRAFFIC * getCongestionIndex()` (0.15) from the three positive terms (land value × 0.5, jobs balance × 0.3, budget health × 0.2 — see `World.getHappiness()`). The dirty-cascade edge is `markTrafficDirty()` → `dirtyLandValueAndHappiness()`, and `markLaborDirty()` routes through `markTrafficDirty()` so that edge fires from one place — giving the full chain `markLaborDirty()` → `markTrafficDirty()` → `dirtyLandValueAndHappiness()`, alongside the parallel `markDemandDirty()`. All cascades fire at **mark time**, never at recompute time, so a drain-on-read call between ticks (e.g. the data-view overlay's `getTrafficMap()`) never silently clears a pending land-value/happiness refresh. Each tick, traffic resolves (dirty-or-cadence, force-refreshing labor inside `recomputeTraffic`) before land value, and both are then frozen read-only snapshots for the rest of the tick (see the tick pipeline above) — so the full loop (traffic → land value → growth/abandonment → buildings → labor → traffic) runs ACROSS ticks, never within one: growth-pass building changes only set dirty flags at the end of a tick, resolved at the start of the next (one-tick lag). Accepted dynamic: a corridor congested enough to abandon its buildings loses those commuters on the next resolve, letting land value recover and buildings re-occupy — a bounded, growth-cadence oscillation. Level-1 buildings never oscillate this way (`maxSupportedLevel` floors at 1, so a level-1 building never abandons).
- **Dirty/lazy pattern**: both holders mirror the coverage-map holders (`recompute(...)`/`clear()`), but `getTrafficMap()` and `getLaborMarket()` *drain* dirtiness on read (recompute-if-dirty before returning) — the coverage getters do not. `CommandDispatcher` mark-only-dirties both traffic and labor (no eager drain — the getters already drain lazily) whenever a tool-driven edit invalidates power/water/service coverage (any structure or road change) or removes a building — a bulldozed building changes the origin/destination set, so it feeds the same invalidation path.
- **Data-view overlay** (`game/render/dataView.ts`, `dataViewColors.ts`, `game/render/overlays/DataViewOverlay.ts`, `app/components/DataViewPanel.tsx`): render-only — reads `world.getTrafficMap()` and `world.getLaborMarket().getFlows()`, never mutates core, respecting the layer boundary; its drain-on-read contract is unchanged by the feedback wiring above. A HUD panel toggles None/Traffic/Jobs. Traffic draws a green→yellow→red diamond over each loaded (congestion > 0) road tile; Jobs draws a red→yellow→green employment-share diamond over each building's footprint cells (grey = "no data," i.e. abandoned or zero-worker/zero-capacity; a road-less but occupied building is red, not grey, since it represents real unemployment/unfillable capacity rather than missing data).

### Procedural terrain generation

Pipeline: `createRng(seed)` → `fbm2d` (raw noise) → `shapeHeightmap` (gamma + median filter + quantize) → `buildWaterMask` (exact-count selection over the noise field to drive elevation clamping). `generateTerrain` still returns tile-shaped `{ elevations, waterMask }`; `World.reset({ regenerate: true })` projects those tile heights into `(height + 1) × (width + 1)` shared `vertexHeights` by taking the minimum touching tile height at each vertex. Water is derived from vertices: a tile is water if any of its four corner vertices is `<= SEA_LEVEL`. Terrain tools edit vertices, not tile cells: each Raise/Lower click targets the clicked tile's four vertices, drag rectangles edit the deduped vertex rectangle, and each vertex write is applied in deterministic row-major order if it passes the player slope cap of 3. A Level/Flatten tool targets the drag-start tile's 4-corner minimum and, for each vertex in the deduped rect, picks the value closest to that target between `[min(h, target), max(h, target)]` for which `canPlayerSetVertexHeight` returns true (so multi-pass convergence on cliffs falls out of the 8-neighbor `MAX_PLAYER_SLOPE_DELTA = 3` cap). Structured-tile protection is two-layer: structured source cells contribute no vertices, and any shared vertex whose write would break an adjacent structured tile's flatness is dropped per-vertex. A successful Lower or Level write that makes any corner of a DIRT tile reach sea level converts that DIRT tile to GRASS.

Default seed: `DEFAULT_NEWCITY_SEED = 0xC15A1E11`.

Invocation rule: `new World(W, H)` and `World.reset({ regenerate: true })` invoke the generator. Save-hydration callsites (`worldStore.getWorld` when a save exists, `deserializeWorldInto` for native v18 saves) construct/reset with `{ regenerate: false }` so the generator does NOT run on load.

Failure fallback: `worldStore.getWorld` invokes `world.reset({ regenerate: true })` if `deserializeWorldInto` fails on a corrupt save, producing a fresh procedural map.

HMR guard: `hasCurrentWorldApi` requires `regenerateTerrain` on the world singleton — stale pre-change singletons are discarded and a new one is created.

Dev hook: `window.__cimulity.dev.regenerateTerrain(seed?)` routes through `GameSession.regenerateTerrain` (full destructive-reset cleanup of Pixi containers and input state) before calling `world.regenerateTerrain`.

The render layer derives smooth slope geometry from shared vertex heights: `tileCornerHeights` reads a tile's four corner vertices directly, so adjacent tiles share identical edge/corner coordinates by construction. There is no separate in-bounds wall renderer; multi-step cliffs render as steep continuous ramps with per-triangle shading for depth cues. Map-edge tiles render an OOB skirt (`DiamondOOBSkirt`) so the world doesn't appear to float. Buildability for player-placed Road and Zone tools is coplanar: a tile is placeable iff topH + bottomH === leftH + rightH (single plane), every corner is above sea level, and the tile is not water. Flat tiles are the trivial subset; uniform N-S/E-W ramps qualify; triangle wedges and saddles do not. Simulation building spawn (World.tick) and save-load building-footprint validation deliberately stay strict-flat — building sprites are not tilted-ready — so a coplanar non-flat tile accepts player-placed roads or zones but never spawns a building, and loading a save with a building footprint on a non-flat tile is rejected. `Terrain.getTerrainShape` remains a visual label used for rough-cell darkening; it does not gate building. Buildings (`CubeBuildingVisual`) lift to `terrain.getRenderHeight`, which is the tile's max corner height. Per-triangle terrain shading is driven by a single world-space light vector `LIGHT_DIR_WORLD` in `game/render/visuals/lighting.ts`; future map-rotation work has a single lighting input to update rather than scattered magic numbers.

### Rendering Strategy

- **Per-tile Graphics**: each visible tile/building owns its own Pixi `Graphics` (no shared batch). `DiamondTileVisual` and `CubeBuildingVisual` mount on demand.
- **Viewport culling**: `viewportCulling.visibleTileBounds()` returns **separate `terrain` and `buildings` tile-index ranges** from camera state; the buildings range is expanded by `MAX_BUILDING_LIFT_PX` so lifted cube tops near the viewport edge aren't clipped. `TileRenderer` mounts only tiles within those bounds, and unmounts/destroys their visuals when they leave the view (they're rebuilt on remount).
- **Visual registry**: `visuals/visualRegistry.ts` holds two maps — `terrainByType` (TileType → terrain visual instance) and `buildingByType` (BuildingType → building visual instance) — registered at startup. Decouples tile/building data from polygon shapes.
- **React ↔ Pixi bridge**: `GameCanvas` keeps the latest callbacks in `callbacksRef` and exposes a `stableForwarders` ref whose identity never changes — the mount effect captures forwarders once, so React re-renders never re-mount the Pixi session.
- **Slope geometry**: `tileCornerHeights(terrain, x, y)` is the single source of truth for the four diamond corner heights; `projectTileCornerScreen(tile, corner, cornerHeight)` in `IsoTransform.ts` is the single source of truth for screen projection. `computeTerrainZIndex(renderHeight, x, y)` lives in `game/render/terrain/terrainZIndex.ts` as a pure helper used by both `DiamondTileVisual` (mount zIndex) and `screenToTileWithTerrain` (same-band tie-break). `DiamondTileVisual` uses corner heights for top fill + outline + per-triangle shading; `screenToTileWithTerrain` uses them for the picking hit-test over a `MAX_ELEVATION`-row neighborhood scan. `polygonContains` uses inclusive boundary semantics. `SelectionRenderer` uses corner heights for hover/select/drag-preview outlines. All five callers read from the same helpers.
- **Lighting model**: `lighting.ts` defines `LIGHT_DIR_WORLD` (surface-to-light; currently world pure-west `+` above, which iso-projects to screen ~10 o'clock — visually "upper-left / NW on screen") and `faceBrightness(normal)` (`AMBIENT + DIFFUSE * max(0, dot(normal, LIGHT_DIR_WORLD)) / FLAT_DOT`, normalized so flat-up maps to exactly 1.0 — preserves the current flat-tile palette). The `y = 0` component is a design choice: world N/S slope normals get equal brightness; E-W contrast is the dominant cue. `DiamondTileVisual` lifts each triangle's three corners to tile/world space `(x, y, h * LIGHTING_Z_SCALE)`, takes `upwardTriangleNormal` (scoped to terrain top triangles; cube side faces would need a different helper), and shades via `faceBrightness`. Cube drop-shadow direction is derived from the same vector via `shadowOffsetScreen(z)` (length scaled by `SHADOW_LENGTH_SCALE` for a stylized look). Cube face brightness (currently 55% / 75% in `CubeBuildingVisual`) is a planned follow-up.

### React StrictMode Safety

- **Idempotent initialization**: `PixiApp.init()` can be called multiple times safely
- **Effect cleanup + disposal flag**: the mount effect's cleanup clears `sessionRef.current` and disposes the session; `GameSession` checks a `disposed` flag so an in-flight `pixiApp.init()` that resolves *after* StrictMode unmount is discarded cleanly
- **Ref guards**: prevent duplicate session creation within a single mounted effect path
- **Proper cleanup**: All PixiJS resources destroyed on unmount
- **No memory leaks**: Verified with hot reload testing
