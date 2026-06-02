'use client';

/**
 * Main game page
 * Minimal React state - only UI display values
 */

import { useCallback, useRef, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { GameHUD } from './components/GameHUD';
import { TileInfoPanel } from './components/TileInfoPanel';
import { Toolbar } from './components/Toolbar';
import { Tool } from '@/game/tools';
import { STARTING_FUNDS, EMPTY_CITY_HAPPINESS } from '@/game/core/World';
import type { WorldDate } from '@/game/core/World';
import type { DemandVector } from '@/game/core/Demand';
import type { TileCoord, ScreenCoord } from '@/game/types/coordinates';
import type { TileInfo } from '@/game/engine';

export default function Home() {
  // Minimal React state: only UI display values
  const [selectedTile, setSelectedTile] = useState<TileCoord | null>(null);
  // Inspector snapshot + the cursor position that anchors its panel.
  const [inspect, setInspect] = useState<{ info: TileInfo; anchor: ScreenCoord } | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [sim, setSim] = useState({ tick: 0, dirt: 0, population: 0, money: STARTING_FUNDS, date: { year: 1, month: 1, day: 1 }, demand: { residential: 0.25, commercial: 0.25, industrial: 0.25 }, happiness: EMPTY_CITY_HAPPINESS });
  const [currentTool, setCurrentTool] = useState<Tool>(Tool.SELECT);
  const [resetNonce, setResetNonce] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState<1 | 2 | 3>(1);
  const [paused, setPaused] = useState(false);

  const speedCommandRef = useRef<((m: 1 | 2 | 3) => void) | null>(null);
  const pauseCommandRef = useRef<(() => void) | null>(null);
  /**
   * Toolbar clicks that arrive before GameCanvas populates the command refs
   * are buffered here and drained inside `handleCommandsReady` (which
   * `GameCanvas.onCommandsReady` invokes after refs go live). Pause uses a
   * toggle COUNT — odd parity flips state, even is a no-op.
   */
  const pendingCommandsRef = useRef<{
    speed: 1 | 2 | 3 | null;
    pauseToggles: number;
  }>({ speed: null, pauseToggles: 0 });

  const handleCameraUpdate = useCallback((x: number, y: number, zoom: number) => {
    setCamera({ x, y, zoom });
  }, []);

  const handleSimUpdate = useCallback((tick: number, dirt: number, population: number, money: number, date: WorldDate, demand: DemandVector, happiness: number) => {
    setSim({ tick, dirt, population, money, date, demand, happiness });
  }, []);

  // A SELECT click sends a snapshot + anchor; a non-SELECT click sends null,
  // which dismisses the panel.
  const handleTileInspect = useCallback((info: TileInfo | null, screen: ScreenCoord) => {
    setInspect(info ? { info, anchor: screen } : null);
  }, []);

  // Dismiss the inspector panel when switching to a non-SELECT tool, so a
  // build tool (even without clicking) hides stale tile info. Shared by the
  // Toolbar and the keyboard tool-change path.
  const handleToolChange = useCallback((tool: Tool) => {
    setCurrentTool(tool);
    if (tool !== Tool.SELECT) setInspect(null);
  }, []);

  const handleSpeedSync = useCallback((m: 1 | 2 | 3) => setSpeedMultiplier(m), []);
  const handlePauseSync = useCallback((p: boolean) => setPaused(p), []);

  const handleSpeedClick = useCallback((m: 1 | 2 | 3) => {
    if (speedCommandRef.current) {
      speedCommandRef.current(m);
    } else {
      pendingCommandsRef.current.speed = m;
    }
  }, []);

  const handlePauseClick = useCallback(() => {
    if (pauseCommandRef.current) {
      pauseCommandRef.current();
    } else {
      pendingCommandsRef.current.pauseToggles++;
    }
  }, []);

  const handleCommandsReady = useCallback(() => {
    const pending = pendingCommandsRef.current;
    if (pending.speed !== null && speedCommandRef.current) {
      speedCommandRef.current(pending.speed);
      pending.speed = null;
    }
    if (pending.pauseToggles > 0 && pauseCommandRef.current) {
      const odd = pending.pauseToggles % 2 === 1;
      pending.pauseToggles = 0;
      if (odd) pauseCommandRef.current();
    }
  }, []);

  const handleNewCity = useCallback(() => {
    if (!window.confirm('Start a new city? This erases your current city.')) {
      return;
    }
    // Drop any pre-mount Toolbar pause/speed clicks so they cannot replay after the reset clears the engine's queues.
    pendingCommandsRef.current = { speed: null, pauseToggles: 0 };
    setSelectedTile(null);
    setInspect(null);
    setResetNonce((n) => n + 1);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <GameCanvas
        onTileClick={setSelectedTile}
        onTileInspect={handleTileInspect}
        onFpsUpdate={setFps}
        onCameraUpdate={handleCameraUpdate}
        onTickUpdate={handleSimUpdate}
        currentTool={currentTool}
        onToolChange={handleToolChange}
        resetNonce={resetNonce}
        commandSpeedRef={speedCommandRef}
        commandPauseRef={pauseCommandRef}
        onCommandsReady={handleCommandsReady}
        onSpeedChange={handleSpeedSync}
        onPauseChange={handlePauseSync}
      />
      <button
        onClick={handleNewCity}
        style={{
          position: 'fixed',
          top: '16px',
          right: '16px',
          padding: '8px 16px',
          backgroundColor: 'rgba(60, 60, 60, 0.8)',
          color: 'white',
          border: '2px solid transparent',
          borderRadius: '4px',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '14px',
          zIndex: 1000,
        }}
      >
        New City
      </button>
      <GameHUD
        selectedTile={selectedTile}
        fps={fps}
        cameraX={camera.x}
        cameraY={camera.y}
        cameraZoom={camera.zoom}
        tick={sim.tick}
        dirt={sim.dirt}
        population={sim.population}
        money={sim.money}
        date={sim.date}
        demand={sim.demand}
        happiness={sim.happiness}
        currentTool={currentTool}
        speedMultiplier={speedMultiplier}
        paused={paused}
      />
      <TileInfoPanel
        info={inspect?.info ?? null}
        anchor={inspect?.anchor ?? null}
        onClose={() => setInspect(null)}
      />
      <Toolbar
        currentTool={currentTool}
        onToolChange={handleToolChange}
        paused={paused}
        speedMultiplier={speedMultiplier}
        onPauseToggle={handlePauseClick}
        onSpeedChange={handleSpeedClick}
      />
    </div>
  );
}
