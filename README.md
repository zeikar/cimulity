# Cimulity

[![Built with HyperClaude](https://img.shields.io/badge/built%20with-HyperClaude-7c3aed)](http://zeikar.dev/hyperclaude/)

**Open-source minimal city simulation game in the browser.**

A SimCity-style city building simulation game built with Next.js, TypeScript, and PixiJS. Features an isometric grid-based world with camera controls, tile interactions, and a clean architectural separation between game logic, rendering, and UI.

## Current Status: MVP-1 (in progress)

Implemented so far:
- ✅ 64x64 isometric diamond grid rendering
- ✅ Camera controls (edge-pan by moving cursor to screen edge, mouse wheel zoom around cursor)
- ✅ Tile interaction (hover highlight, click selection)
- ✅ HUD overlay (FPS counter, tick counter, selected tile coordinates, camera position)
- ✅ UI toolbar for tool selection
- ✅ Road painting tool (click or click-drag)
- ✅ R/C/I zoning (click or drag a rectangle to paint residential/commercial/industrial)
- ✅ Bulldoze tool (rectangular area selection, leaves a regrowing scar)
- ✅ Fixed-timestep simulation tick loop
- ✅ Autosave to localStorage with a "New City" reset
- ✅ Clean architecture with separated concerns
- ✅ **Elevation & smooth slopes** - Shared-vertex-height ramps between tiles of different elevation (SimCity 3000-style); cliffs render as steep continuous ramps with depth shading; map-edge skirt prevents floating world
- ✅ **Directional terrain lighting** — per-triangle brightness from a centralized light vector (`LIGHT_DIR_WORLD` in `game/render/visuals/lighting.ts`; currently world pure-west + above, iso-projecting to screen ~10 o'clock / upper-left) replaces the planar-height heuristic. Cube drop-shadow direction derives from the same vector; cube face brightness migration is tracked separately.
- ✅ Terrain tools — Raise / Lower shared terrain vertices by ±1 (click edits the tile's 4 corners; drag edits a deduped vertex rectangle; water emerges when any corner reaches sea level)

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
- **Raise/Lower terrain**: R / F (or click Raise / Lower in the toolbar; drag to extend over a rectangle)

## Tech Stack

- **Framework**: Next.js 16.1.1 (App Router)
- **Language**: TypeScript (strict mode)
- **Rendering**: PixiJS 8.5.2 (WebGL with Canvas fallback)
- **Styling**: Tailwind CSS 4

## Architecture

Layered: input emits tile coords + active tool; engine (`CommandDispatcher`) calls pure tool helpers to build commands, then writes to core; render reads core. React is the shell.

See [docs/architecture.md](docs/architecture.md) for the full layer diagram, directory structure, coordinate math, and camera/picking details. Per-subsystem deep dives will live under `docs/systems/` as they land.

## Roadmap

### MVP-1 (Remaining)

- [ ] **Expanded tile types** - Additional terrain variety (water is derived from elevation — sea-level tiles render as water by default)
- [ ] **Sprites/textures** - Replace colored shapes with actual graphics

### MVP-2 (Future)

- [ ] **Power & water systems** - Utility networks
- [ ] **Services** - Police, fire, hospitals
- [ ] **Happiness/statistics** - Citizen happiness, budget charts
- [ ] **Sound effects** - Audio feedback

## Contributing

This is a learning/demonstration project. Feel free to fork and experiment!

### Code Style

- **TypeScript strict mode** enabled
- **Functional approach** where possible
- **Immutable data** in core layer (future)
- **Clean separation** of concerns
- **No circular dependencies** between layers

## License

MIT (or your preferred license)

---

**Built with [HyperClaude](http://zeikar.dev/hyperclaude/)** — *Claude builds, Codex critiques.* My own Claude Code plugin. 🤖✨
