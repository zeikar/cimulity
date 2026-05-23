'use client';

/**
 * Game HUD overlay
 * Displays: Selected tile coords, FPS, Camera position
 */

import type { TileCoord } from '@/game/types/coordinates';
import type { WorldDate } from '@/game/core/World';
import { Tool } from '@/game/tools';

const TOOL_LABELS: Record<Tool, string> = {
  [Tool.SELECT]: 'Select',
  [Tool.PAINT_WATER]: 'Paint Water',
  [Tool.PAINT_GRASS]: 'Paint Grass',
  [Tool.ROAD]: 'Road',
  [Tool.BULLDOZE]: 'Bulldoze',
  [Tool.ZONE_RESIDENTIAL]: 'Residential',
  [Tool.ZONE_COMMERCIAL]: 'Commercial',
  [Tool.ZONE_INDUSTRIAL]: 'Industrial',
  [Tool.TERRAIN_UP]: 'Raise',
  [Tool.TERRAIN_DOWN]: 'Lower',
};

export interface GameHUDProps {
  selectedTile: TileCoord | null;
  fps: number;
  tick: number;
  dirt: number;
  population: number;
  money: number;
  date: WorldDate;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  currentTool?: Tool;
  speedMultiplier: 1 | 2 | 3;
  paused: boolean;
}

export function GameHUD({
  selectedTile,
  fps,
  tick,
  dirt,
  population,
  money,
  date,
  cameraX,
  cameraY,
  cameraZoom,
  currentTool,
  speedMultiplier,
  paused,
}: GameHUDProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        padding: '16px',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '14px',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 1000,
      }}
    >
      <div>
        <strong>FPS:</strong> {fps}
      </div>
      <div>
        <strong>Speed:</strong> {speedMultiplier}x
      </div>
      <div>
        <strong>Status:</strong> {paused ? 'Paused' : 'Running'}
      </div>
      <div>
        <strong>Date:</strong> Year {date.year}, Month {date.month}, Day {date.day}
      </div>
      <div>
        <strong>Tick:</strong> {tick}
      </div>
      <div>
        <strong>Dirt:</strong> {dirt}
      </div>
      <div>
        <strong>Population:</strong> {population}
      </div>
      <div>
        <strong>Money:</strong> {money}
      </div>
      {currentTool && (
        <div>
          <strong>Tool:</strong> {TOOL_LABELS[currentTool]}
        </div>
      )}
      <div>
        <strong>Selected Tile:</strong>{' '}
        {selectedTile ? `(${selectedTile.x}, ${selectedTile.y})` : 'None'}
      </div>
      <div>
        <strong>Camera:</strong> ({Math.round(cameraX)}, {Math.round(cameraY)}) | Zoom: {cameraZoom.toFixed(2)}
      </div>
      <div style={{ marginTop: '8px', opacity: 0.7, fontSize: '12px' }}>
        Keys: S/R/B/Q/W/E | Shift+W/G=paint | Space=pause | 1/2/3=speed | Drag: road/bulldoze/zone/paint
      </div>
    </div>
  );
}
