/**
 * Keyboard input handler for tool shortcuts
 */

import { Tool } from '../tools/Tool';

// Local type alias — input layer does not import core types.
type SpeedTier = 1 | 2 | 3;

export interface KeyboardCallbacks {
  onToolChange: (tool: Tool) => void;
  onSpeedChange?: (tier: SpeedTier) => void;
  onPauseToggle?: () => void;
}

// Tool shortcuts: t=road, b=bulldoze, s=select, q/w/e=R/C/I zones, p=power plant,
// a=water tower (a for aqua; w stays Commercial to avoid shadowing), r=raise terrain,
// f=lower terrain, g=level terrain, c=police station (cops).
const KEY_TO_TOOL: Record<string, Tool> = {
  t: Tool.ROAD,
  r: Tool.TERRAIN_UP,
  f: Tool.TERRAIN_DOWN,
  g: Tool.TERRAIN_LEVEL,
  b: Tool.BULLDOZE,
  s: Tool.SELECT,
  Escape: Tool.SELECT,
  q: Tool.ZONE_RESIDENTIAL,
  w: Tool.ZONE_COMMERCIAL,
  e: Tool.ZONE_INDUSTRIAL,
  p: Tool.POWER_PLANT,
  a: Tool.WATER_TOWER,
  c: Tool.POLICE_STATION,
};

/**
 * Speed-tier shortcuts. Mirrors `KEY_TO_TOOL` in shape so input lookups stay symmetric.
 * Plain `1 | 2 | 3` literals — input layer does not import core types.
 */
const KEY_TO_SPEED: Record<string, SpeedTier> = {
  '1': 1,
  '2': 2,
  '3': 3,
};

export class KeyboardHandler {
  private callbacks: KeyboardCallbacks;

  constructor(callbacks: KeyboardCallbacks) {
    this.callbacks = callbacks;
    this.attachListeners();
  }

  private attachListeners(): void {
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    // Ignore if typing in an input field
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    // Modifier combos (Ctrl/Cmd+W, Cmd+Q, Cmd+R, etc.) belong to the browser/OS, not the game.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    // Normalize single-char keys so caps lock / shift don't break shortcuts; multi-char keys (Space, Escape) stay as-is.
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    // Order: pause → speed → tool. 1/2/3 NEVER fall through to tool lookup because they were removed from KEY_TO_TOOL.
    if (key === ' ') {
      event.preventDefault();
      this.callbacks.onPauseToggle?.();
      return;
    }

    const speed = KEY_TO_SPEED[key];
    if (speed !== undefined) {
      event.preventDefault();
      this.callbacks.onSpeedChange?.(speed);
      return;
    }

    const tool = KEY_TO_TOOL[key];
    if (tool) {
      event.preventDefault();
      this.callbacks.onToolChange(tool);
    }
  };

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}
