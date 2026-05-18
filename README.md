# Cimulity

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

## Tech Stack

- **Framework**: Next.js 16.1.1 (App Router)
- **Language**: TypeScript (strict mode)
- **Rendering**: PixiJS 8.5.2 (WebGL with Canvas fallback)
- **Styling**: Tailwind CSS 4

## Project Architecture

The codebase follows a strict layered architecture to maintain clean separation of concerns:

> **Boundary principle:** input emits raw drag endpoints → tools build commands & paths → engine dispatches → core mutates state → render draws from core. React is the shell.

```
┌─────────────────────────────────────────────────────────────┐
│                    React Shell                               │
│  - Minimal state (only display values)                       │
│  - GameCanvas, GameHUD components                            │
└────────────────────┬────────────────────────────────────────┘
                     │ Callbacks & Events
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Input Layer                               │
│  - PointerHandler (tile picking)                             │
│  - CameraController (edge-pan / wheel zoom)                  │
│  - Emits raw drag endpoints only                             │
└────────────────────┬────────────────────────────────────────┘
                     │ Raw drag endpoints
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Tools Layer                               │
│  - Tool enum, RoadTool (path rules)                          │
│  - ToolActions, ToolResult                                   │
│  - Builds commands & paths from raw input                    │
└────────────────────┬────────────────────────────────────────┘
                     │ Commands
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Engine Layer                              │
│  - CommandDispatcher                                         │
│  - GameSession                                               │
└────────────────────┬────────────────────────────────────────┘
                     │ State mutations
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Core Layer (state primitives)             │
│  - World (game state container)                              │
│  - GameMap (2D grid structure)                               │
│  - Tile (data model)                                         │
│  - GameLoop (tick system - placeholder)                      │
└────────────────────┬────────────────────────────────────────┘
                     │ Reads state
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    Render Layer                              │
│  - PixiJS Application lifecycle                              │
│  - Camera (edge-pan/zoom with constraints)                   │
│  - IsoTransform (coordinate conversion)                      │
│  - TileRenderer, GridRenderer, SelectionRenderer             │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
cimulity/
├── app/                          # Next.js App Router
│   ├── components/               # React components
│   │   ├── GameCanvas.tsx        # PixiJS mount point
│   │   └── GameHUD.tsx           # HUD overlay
│   ├── page.tsx                  # Main game page
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Global styles
│
├── game/                         # Game engine code
│   ├── input/                    # Input layer (raw drag endpoints only)
│   │   ├── PointerHandler.ts     # Mouse/touch input
│   │   ├── CameraController.ts   # Edge-pan / wheel zoom
│   │   └── ToolManager.ts        # Active tool dispatch
│   │
│   ├── tools/                    # Tools layer (path rules + commands)
│   │   ├── Tool.ts               # Tool enum
│   │   ├── RoadTool.ts           # Road path rule
│   │   ├── ToolActions.ts        # Action definitions
│   │   ├── ToolResult.ts         # Result types
│   │   └── index.ts
│   │
│   ├── engine/                   # Engine layer (dispatch + session)
│   │   ├── CommandDispatcher.ts  # Routes commands to core
│   │   ├── GameSession.ts        # Session lifecycle
│   │   └── index.ts
│   │
│   ├── core/                     # Core layer (state primitives)
│   │   ├── Tile.ts               # Tile data model
│   │   ├── Map.ts                # 2D grid structure
│   │   ├── World.ts              # World state container
│   │   └── GameLoop.ts           # Tick system (placeholder)
│   │
│   ├── render/                   # Rendering layer (draws from core state)
│   │   ├── PixiApp.ts            # PixiJS lifecycle wrapper
│   │   ├── Camera.ts             # Camera system
│   │   ├── IsoTransform.ts       # Coordinate transforms
│   │   ├── TileRenderer.ts       # Tile rendering
│   │   ├── GridRenderer.ts       # Debug grid lines
│   │   └── SelectionRenderer.ts  # Hover/selection highlights
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

// Screen → Tile (inverse transform)
tileX = (screenX/32 + screenY/16) / 2
tileY = (screenY/16 - screenX/32) / 2
```

### Camera System

- **Pan**: Move cursor within 32px of any canvas edge; speed scales with proximity (up to 600px/s)
- **Zoom**: Mouse wheel zooms around cursor position (not center)
- **Constraints**: Pan limited to map boundaries, zoom 0.25x - 2x
- **Algorithm**: Uses transform matrix for efficient coordinate conversion

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

### Performance Optimizations

- **Batched rendering**: Graphics API optimized for minimal draw calls
- **Cached Graphics**: Tiles rendered once, not every frame
- **React optimization**: `useCallback` prevents infinite re-renders
- **Future**: Viewport frustum culling (render only visible tiles)

### React StrictMode Safety

- **Idempotent initialization**: PixiApp.init() can be called multiple times safely
- **Ref guards**: Prevent double-initialization in development
- **Proper cleanup**: All PixiJS resources destroyed on unmount
- **No memory leaks**: Verified with hot reload testing

## Roadmap

### MVP-1 (Remaining)

- [ ] **Expanded tile types** - Water, dirt, different terrain
- [ ] **Sprites/textures** - Replace colored shapes with actual graphics
- [ ] **Viewport culling** - Render only visible tiles

### MVP-2 (Future)

- [ ] **Citizens** - Population simulation
- [ ] **Resources** - Money, power, water systems
- [ ] **Services** - Police, fire, hospitals
- [ ] **Statistics** - Population, happiness, budget charts
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

**Built with GPT-4 + Claude Code** 🤖✨
