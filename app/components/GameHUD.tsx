'use client';

/**
 * Game HUD overlay
 * Displays: Selected tile coords, FPS, Camera position
 */

import type { TileCoord } from '@/game/types/coordinates';
import { Tool } from '@/game/tools';

const TOOL_LABELS: Record<Tool, string> = {
  [Tool.SELECT]: 'Select',
  [Tool.ROAD]: 'Road',
  [Tool.BULLDOZE]: 'Bulldoze',
  [Tool.ZONE_RESIDENTIAL]: 'Residential',
  [Tool.ZONE_COMMERCIAL]: 'Commercial',
  [Tool.ZONE_INDUSTRIAL]: 'Industrial',
};

export interface GameHUDProps {
  selectedTile: TileCoord | null;
  fps: number;
  tick: number;
  dirt: number;
  cameraX: number;
  cameraY: number;
  cameraZoom: number;
  currentTool?: Tool;
}

export function GameHUD({
  selectedTile,
  fps,
  tick,
  dirt,
  cameraX,
  cameraY,
  cameraZoom,
  currentTool,
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
        <strong>Tick:</strong> {tick}
      </div>
      <div>
        <strong>Dirt:</strong> {dirt}
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
        Keys: S/R/B/1/2/3 | Drag: road/bulldoze/zone
      </div>
    </div>
  );
}
