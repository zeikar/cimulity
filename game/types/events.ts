/**
 * Event type definitions
 */

import type { TileCoord } from './coordinates';

export interface TileHoverEvent {
  tile: TileCoord | null;
}

export interface TileClickEvent {
  tile: TileCoord;
}

export interface CameraUpdateEvent {
  x: number;
  y: number;
  zoom: number;
}
