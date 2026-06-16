'use client';

/**
 * Game HUD overlay
 * Displays: Selected tile coords, FPS, Camera position
 */

import { useState } from 'react';
import type { TileCoord } from '@/game/types/coordinates';
import type { WorldDate } from '@/game/core/World';
import type { DemandVector } from '@/game/core/Demand';
import { Tool } from '@/game/tools';
import type { DataView } from '@/game/render/dataView';
import type { StatsSample } from '@/app/hooks/sampleStats';
import { StatsPanel } from './StatsPanel';
import { DataViewPanel } from './DataViewPanel';

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
  [Tool.PARK]: 'Park',
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
  happiness: number;
  currentTool?: Tool;
  speedMultiplier: 1 | 2 | 3;
  paused: boolean;
  statsSamples: StatsSample[];
  dataView: DataView;
  onDataViewChange: (v: DataView) => void;
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
  happiness,
  money,
  date,
  cameraX,
  cameraY,
  cameraZoom,
  currentTool,
  speedMultiplier,
  paused,
  statsSamples,
  dataView,
  onDataViewChange,
}: GameHUDProps) {
  // Panel is hidden by default; toggled by the [Stats] button.
  const [statsOpen, setStatsOpen] = useState(false);
  // Data panel visibility is independent of the active view — closing the panel
  // does NOT reset to 'none'; only clicking a view button changes the overlay.
  const [dataOpen, setDataOpen] = useState(false);

  // Debug section is inlined out of production builds via the same gate devApi uses.
  const isDev = process.env.NODE_ENV === 'development';
  return (
    <>
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
        <div>
          <strong>Happiness:</strong> <BarBlocks value={happiness} color="#ff9800" /> {happiness.toFixed(2)}
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

      {/* [Stats] toggle button: pointerEvents 'auto' so it receives clicks despite
          the HUD root being 'none'. Positioned left of the "New City" button. */}
      <button
        onClick={() => setStatsOpen((o) => !o)}
        style={{
          position: 'fixed',
          top: '16px',
          right: '128px',
          padding: '8px 16px',
          backgroundColor: statsOpen ? 'rgba(33, 150, 243, 0.8)' : 'rgba(60, 60, 60, 0.8)',
          color: 'white',
          border: statsOpen ? '2px solid rgba(33, 150, 243, 1)' : '2px solid transparent',
          borderRadius: '4px',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '14px',
          zIndex: 1000,
          pointerEvents: 'auto',
        }}
      >
        [Stats]
      </button>

      {statsOpen && <StatsPanel samples={statsSamples} />}

      {/* [Data] toggle button: placed left of [Stats] (right:'128px').
          right:'232px' avoids overlap with [Stats] (~91px wide at right:128px → left edge ~219px).
          Closing this panel does NOT reset the active overlay — toggle panel ≠ toggle overlay. */}
      <button
        onClick={() => setDataOpen((o) => !o)}
        style={{
          position: 'fixed',
          top: '16px',
          right: '232px',
          padding: '8px 16px',
          backgroundColor: dataOpen ? 'rgba(33, 150, 243, 0.8)' : 'rgba(60, 60, 60, 0.8)',
          color: 'white',
          border: dataOpen ? '2px solid rgba(33, 150, 243, 1)' : '2px solid transparent',
          borderRadius: '4px',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '14px',
          zIndex: 1000,
          pointerEvents: 'auto',
        }}
      >
        [Data]
      </button>

      {dataOpen && <DataViewPanel active={dataView} onSelect={onDataViewChange} />}
    </>
  );
}
