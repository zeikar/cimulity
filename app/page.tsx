'use client';

/**
 * Main game page
 * Minimal React state - only UI display values
 */

import { useCallback, useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { GameHUD } from './components/GameHUD';
import type { TileCoord } from '@/game/types/coordinates';

export default function Home() {
  // Minimal React state: only UI display values
  const [selectedTile, setSelectedTile] = useState<TileCoord | null>(null);
  const [hoveredTile, setHoveredTile] = useState<TileCoord | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const handleCameraUpdate = useCallback((x: number, y: number, zoom: number) => {
    setCamera({ x, y, zoom });
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <GameCanvas
        onTileHover={setHoveredTile}
        onTileClick={setSelectedTile}
        onFpsUpdate={setFps}
        onCameraUpdate={handleCameraUpdate}
      />
      <GameHUD
        selectedTile={selectedTile}
        fps={fps}
        cameraX={camera.x}
        cameraY={camera.y}
        cameraZoom={camera.zoom}
      />
    </div>
  );
}
