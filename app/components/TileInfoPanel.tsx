'use client';

/**
 * Tile inspector panel — SimCity-style info window shown when the SELECT tool
 * clicks a tile. Renders a one-shot snapshot captured at click time; it does
 * not live-update. Hidden when `info` is null.
 */

import { TileType } from '@/game/core/Tile';
import type { BuildingType } from '@/game/core/Building';
import type { StructureType } from '@/game/core/StructureMap';
import type { TileInfo } from '@/game/engine';
import type { ScreenCoord } from '@/game/types/coordinates';

// Cursor offset and rough panel extents used to keep the panel on-screen.
const CURSOR_OFFSET = 14;
const EST_WIDTH = 240;
const EST_HEIGHT = 240;

/**
 * Place the panel near the click, flipping to the opposite side of the cursor
 * when it would overflow the viewport, and clamping to a small margin.
 */
function anchoredPosition(anchor: ScreenCoord): { left: number; top: number } {
  const vw = typeof window !== 'undefined' ? window.innerWidth : EST_WIDTH;
  const vh = typeof window !== 'undefined' ? window.innerHeight : EST_HEIGHT;
  let left = anchor.x + CURSOR_OFFSET;
  let top = anchor.y + CURSOR_OFFSET;
  if (left + EST_WIDTH > vw) left = anchor.x - CURSOR_OFFSET - EST_WIDTH;
  if (top + EST_HEIGHT > vh) top = anchor.y - CURSOR_OFFSET - EST_HEIGHT;
  return { left: Math.max(8, left), top: Math.max(8, top) };
}

const TILE_TYPE_LABELS: Record<TileType, string> = {
  [TileType.GRASS]: 'Grass',
  [TileType.DIRT]: 'Dirt',
  [TileType.ROAD]: 'Road',
  [TileType.ZONE_RESIDENTIAL]: 'Residential Zone',
  [TileType.ZONE_COMMERCIAL]: 'Commercial Zone',
  [TileType.ZONE_INDUSTRIAL]: 'Industrial Zone',
  [TileType.POWER_PLANT]: 'Power Plant',
  [TileType.WATER_TOWER]: 'Water Tower',
  [TileType.POLICE_STATION]: 'Police Station',
  [TileType.FIRE_STATION]: 'Fire Station',
};

const STRUCTURE_TYPE_LABELS: Record<StructureType, string> = {
  power_plant: 'Power Plant',
  water_tower: 'Water Tower',
  police_station: 'Police Station',
  fire_station: 'Fire Station',
};

const BUILDING_TYPE_LABELS: Record<BuildingType, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
};

const DENSITY_LABELS: Record<0 | 1 | 2, string> = {
  0: 'Low',
  1: 'Medium',
  2: 'High',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function TileInfoPanel({
  info,
  anchor,
  onClose,
}: {
  info: TileInfo | null;
  anchor: ScreenCoord | null;
  onClose: () => void;
}) {
  if (!info || !anchor) return null;

  const { left, top } = anchoredPosition(anchor);

  const isZone =
    info.type === TileType.ZONE_RESIDENTIAL ||
    info.type === TileType.ZONE_COMMERCIAL ||
    info.type === TileType.ZONE_INDUSTRIAL;

  return (
    <div
      style={{
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        minWidth: '220px',
        padding: '12px 16px',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '13px',
        borderRadius: '6px',
        userSelect: 'none',
        // Above the Toolbar/HUD (zIndex 1000) so it's never painted over.
        zIndex: 1001,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <strong>
          Tile ({info.x}, {info.y})
        </strong>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontSize: '16px',
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Row label="Type">{TILE_TYPE_LABELS[info.type]}</Row>
        {isZone && <Row label="Zone Level">{info.level}</Row>}
        <Row label="Power">
          <span style={{ color: info.powered ? '#4caf50' : '#ff6b6b' }}>
            {info.powered ? 'Powered' : 'No Power'}
          </span>
        </Row>
        <Row label="Water">
          <span style={{ color: info.watered ? '#4caf50' : '#ff6b6b' }}>
            {info.watered ? 'Watered' : 'No Water'}
          </span>
        </Row>
        <Row label="Police">
          <span style={{ color: info.isServiceSource || info.serviceCovered ? '#4caf50' : '#ff6b6b' }}>
            {info.isServiceSource ? 'Police Station' : `${Math.round(info.coverage * 100)}%`}
          </span>
        </Row>
        <Row label="Land Value">{Math.round(info.landValue * 100)}%</Row>

        {info.building && (
          <>
            <div style={{ marginTop: '6px', opacity: 0.7 }}>Building</div>
            <Row label="Kind">{BUILDING_TYPE_LABELS[info.building.type]}</Row>
            <Row label="Level">{info.building.level}</Row>
            <Row label="Density">{DENSITY_LABELS[info.building.density]}</Row>
            <Row label="Age">{info.building.age}</Row>
          </>
        )}

        {info.structure && (
          <>
            <div style={{ marginTop: '6px', opacity: 0.7 }}>Structure</div>
            <Row label="Kind">{STRUCTURE_TYPE_LABELS[info.structure.type]}</Row>
          </>
        )}
      </div>
    </div>
  );
}
