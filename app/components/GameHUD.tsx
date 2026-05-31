'use client';

/**
 * Game HUD overlay
 * Displays: Selected tile coords, FPS, Camera position
 */

import type { TileCoord } from '@/game/types/coordinates';
import type { WorldDate } from '@/game/core/World';
import type { DemandVector } from '@/game/core/Demand';
import { Tool } from '@/game/tools';

const TOOL_LABELS: Record<Tool, string> = {
  [Tool.SELECT]: 'Select',
  [Tool.ROAD]: 'Road',
  [Tool.BULLDOZE]: 'Bulldoze',
  [Tool.ZONE_RESIDENTIAL]: 'Residential',
  [Tool.ZONE_COMMERCIAL]: 'Commercial',
  [Tool.ZONE_INDUSTRIAL]: 'Industrial',
  [Tool.POWER_PLANT]: 'Power Plant',
  [Tool.WATER_TOWER]: 'Water Tower',
  [Tool.POLICE_STATION]: 'Police Station',
  [Tool.FIRE_STATION]: 'Fire Station',
  [Tool.HOSPITAL]: 'Hospital',
  [Tool.SCHOOL]: 'School',
  [Tool.TERRAIN_UP]: 'Raise',
  [Tool.TERRAIN_DOWN]: 'Lower',
  [Tool.TERRAIN_LEVEL]: 'Level',
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
  demand: DemandVector;
  currentTool?: Tool;
  speedMultiplier: 1 | 2 | 3;
  paused: boolean;
}

function BarBlocks({ value, color }: { value: number; color: string }) {
  const filled = Math.round(value * 10);
  return (
    <span style={{ color }}>
      {'█'.repeat(filled)}{'░'.repeat(10 - filled)}
    </span>
  );
}

export function GameHUD({
  selectedTile,
  fps,
  tick,
  dirt,
  population,
  demand,
  money,
  date,
  cameraX,
  cameraY,
  cameraZoom,
  currentTool,
  speedMultiplier,
  paused,
}: GameHUDProps) {
  // Debug section is inlined out of production builds via the same gate devApi uses.
  const isDev = process.env.NODE_ENV === 'development';
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
        <strong>Date:</strong> Year {date.year}, Month {date.month}, Day {date.day}
      </div>
      <div>
        <strong>Population:</strong> {population}
      </div>
      <div>
        <strong>Money:</strong> {money}
      </div>
      <div>
        <strong>R:</strong> <BarBlocks value={demand.residential} color="#4caf50" /> {demand.residential.toFixed(2)}
      </div>
      <div>
        <strong>C:</strong> <BarBlocks value={demand.commercial} color="#2196f3" /> {demand.commercial.toFixed(2)}
      </div>
      <div>
        <strong>I:</strong> <BarBlocks value={demand.industrial} color="#ffeb3b" /> {demand.industrial.toFixed(2)}
      </div>

      {isDev && (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.2)', opacity: 0.7, fontSize: '12px' }}>
          <div style={{ marginBottom: '4px', letterSpacing: '1px' }}>DEBUG</div>
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
        </div>
      )}
    </div>
  );
}
