'use client';

/**
 * Main game page
 * Minimal React state - only UI display values
 */

import { useCallback, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { GameHUD } from './components/GameHUD';
import { Toolbar } from './components/Toolbar';
import { Tool } from '@/game/tools';
import { STARTING_FUNDS } from '@/game/core/World';
import type { WorldDate } from '@/game/core/World';
import type { TileCoord } from '@/game/types/coordinates';

export default function Home() {
  // Minimal React state: only UI display values
  const [selectedTile, setSelectedTile] = useState<TileCoord | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const [sim, setSim] = useState({ tick: 0, dirt: 0, population: 0, money: STARTING_FUNDS, date: { year: 1, month: 1, day: 1 } });
  const [currentTool, setCurrentTool] = useState<Tool>(Tool.SELECT);
  const [resetNonce, setResetNonce] = useState(0);

  const handleCameraUpdate = useCallback((x: number, y: number, zoom: number) => {
    setCamera({ x, y, zoom });
  }, []);

  const handleSimUpdate = useCallback((tick: number, dirt: number, population: number, money: number, date: WorldDate) => {
    setSim({ tick, dirt, population, money, date });
  }, []);

  const handleNewCity = useCallback(() => {
    if (!window.confirm('Start a new city? This erases your current city.')) {
      return;
    }
    setSelectedTile(null);
    setResetNonce((n) => n + 1);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <GameCanvas
        onTileClick={setSelectedTile}
        onFpsUpdate={setFps}
        onCameraUpdate={handleCameraUpdate}
        onTickUpdate={handleSimUpdate}
        currentTool={currentTool}
        onToolChange={setCurrentTool}
        resetNonce={resetNonce}
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
        currentTool={currentTool}
      />
      <Toolbar currentTool={currentTool} onToolChange={setCurrentTool} />
    </div>
  );
}
