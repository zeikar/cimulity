# Cimulity

[![Built with HyperClaude](https://img.shields.io/badge/built%20with-HyperClaude-7c3aed)](http://zeikar.dev/hyperclaude/)

**Open-source minimal city simulation game in the browser.**

Cimulity is a SimCity-style city builder built with Next.js, TypeScript, and PixiJS. It focuses on a small, readable simulation core: isometric terrain, roads, zoning, basic growth/economy, and terrain editing.

![Cimulity gameplay — an isometric city with roads, R/C/I buildings, service buildings, parks, and a coastline](docs/screenshots/city-overview.png)

## Project Status

MVP-1 is playable and in active development. The current build supports:
- 64x64 isometric terrain with camera pan/zoom, hover/select, and drag previews
- Roads, bulldoze, R/C/I zoning, and raise/lower/level terrain tools
- Vertex-based terrain with smooth slopes, elevation-derived water, and coplanar road/zone placement
- Fixed-timestep simulation with zone growth, population, money, speed/pause controls, autosave, and New City reset
- Power plants + binary reachability gate zone growth
- Water towers gate zone level-ups/density (power gates initial spawn)
- Police, fire, hospital, and school stations provide road-network coverage; level-up now requires all four at the anchor
- Land value gates level-up at the anchor: road proximity (weight 0.40), zone-mix diversity (0.10), service coverage (0.50 — avg of the four), plus additive park proximity (+0.25 max) and a subtractive road-congestion penalty (−0.20 max); park is a separate amenity, not a fifth coverage service
- Display-only happiness KPI (0–1 scalar, land value/jobs/budget weighted minus a congestion penalty) and a toggleable statistics panel with population/money/happiness/congestion sparklines
- Dot-art textures replace placeholder colored geometry: buildings get dynamic window lights (punched/curtain facades) and seeded per-building lot coverage; roads autotile into smooth diagonal asphalt ribbons with junction hubs and sidewalk aprons; terrain adds park/street decorations plus coastal sand and highland rock bands
- Buildings above level 1 abandon (go derelict) when land value drops below their level's requirement, and re-occupy on recovery; level 1 is the floor, so a level-1 building never goes derelict
- Aggregate labor market (job capacity, worker matching, employment) routes commutes over the road graph; those commute flows load each road tile into a per-tile congestion value, and a data-view overlay (None/Traffic/Jobs) visualizes both
- R/C/I demand is now derived from labor-market balance (jobs vs. workers), not blended in as a secondary signal, with a small damped floor (in-migration for R, an external-market pull for C/I) that keeps all three bars off exact zero at a fully employed balance, each still falling to zero past its own cutoff

Next focus: sound effects and continued tool-feedback polish.

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to play!

### Controls
- **Pan**: Move cursor to any screen edge to scroll (speed scales with proximity to edge)
- **Zoom**: Mouse wheel (zooms around cursor)
- **Select Tile**: Left-click on any tile
- **Hover**: Move mouse over tiles to see highlight
- **Tools**: S select, T road, B bulldoze, Q/W/E residential/commercial/industrial zones, P power plant, A water tower, C police station, D fire station, H hospital, L school, K park
- **Terrain**: R raise, F lower, G level/flatten
- **Time**: Space pause/resume, 1/2/3 speed
- **Panels**: **[Stats]** (top-right) toggles the sparkline panel. **[Data]** opens the data-view selector; its None/Traffic/Jobs buttons switch the overlay, and closing the selector leaves the chosen overlay active

## Tech Stack

- **Framework**: Next.js 16.1.1 (App Router)
- **Language**: TypeScript (strict mode)
- **Rendering**: PixiJS 8.15.0 (auto-detected renderer: WebGL, falling back to WebGPU)
- **Styling**: Tailwind CSS 4
- **Testing**: Vitest

## Architecture

Layered: input emits tile coords + active tool; engine (`CommandDispatcher`) calls pure tool helpers to build commands, then writes to core; render reads core. React is the shell.

See [docs/architecture.md](docs/architecture.md) for the full layer diagram, directory structure, coordinate math, and camera/picking details. Per-subsystem deep dives will live under `docs/systems/` as they land.

## Roadmap

### MVP-1

- [ ] **Expanded tile types** - Additional terrain variety (water is derived from elevation — sea-level tiles render as water by default; coastal sand and highland rock are render-only elevation bands, not new tile types)
- [x] **Sprites/textures** - Dot-art building and terrain sprites replace colored shapes, with dynamic window lights, autotiled roads, decorations, and per-building lot coverage

### MVP-2

- [x] **Services** - Police, fire, hospital, and school coverage all shipped (road-network + distance falloff); the coverage family has four members (police/fire/hospital emergency trio + school education); level-up gates on all four at the anchor
- [x] **Parks** - Park tile shipped (forest-green, keyboard K, cost 100); raises nearby land value (Chebyshev radius 4, additive +0.25 max, nearest-park strongest-wins); park is a land-value amenity — it is NOT a fifth coverage service (the formula is road 0.40 + diversity 0.10 + service 0.50, plus the additive park +0.25 and a subtractive road-congestion penalty of −0.20 max)
- [x] **Happiness/statistics** - Display-only happiness KPI (0..1) and a statistics panel with population/money/happiness/congestion sparklines; happiness does not yet feed simulation
- [ ] **Sound effects** - Audio feedback
- [x] **Land-value model** - Road weight rebalanced 0.7→0.40, diversity 0.3→0.10; the four coverage services now contribute a combined service term (weight 0.50, average of the four normalised coverages) atop the additive park bonus (+0.25) and a subtractive road-congestion penalty (−0.20 max). Services play a dual role: hard-gate level-up at the anchor AND feed land value.

## Contributing

This is a learning/demonstration project. Feel free to fork and experiment!

### Code Style

- **TypeScript strict mode** enabled
- **Functional approach** where possible
- **Immutable data** in core layer (future)
- **Clean separation** of concerns
- **No circular dependencies** between layers

## License

MIT — see [LICENSE](LICENSE).

---

**Built with [HyperClaude](http://zeikar.dev/hyperclaude/)** — *Claude builds, Codex critiques.* My own Claude Code plugin. 🤖✨
