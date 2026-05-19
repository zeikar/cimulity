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

// Zone shortcuts moved from 1/2/3 to q/w/e so 1/2/3 are free for speed tiers (see KEY_TO_SPEED below) and Space toggles pause.
const KEY_TO_TOOL: Record<string, Tool> = {
  r: Tool.ROAD,
  b: Tool.BULLDOZE,
  s: Tool.SELECT,
  Escape: Tool.SELECT,
  q: Tool.ZONE_RESIDENTIAL,
  w: Tool.ZONE_COMMERCIAL,
  e: Tool.ZONE_INDUSTRIAL,
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

    // Order: pause → speed → tool. 1/2/3 NEVER fall through to tool lookup because they were removed from KEY_TO_TOOL.
    if (event.key === ' ') {
      event.preventDefault();
      this.callbacks.onPauseToggle?.();
      return;
    }

    const speed = KEY_TO_SPEED[event.key];
    if (speed !== undefined) {
      event.preventDefault();
      this.callbacks.onSpeedChange?.(speed);
      return;
    }

    const tool = KEY_TO_TOOL[event.key];
    if (tool) {
      event.preventDefault();
      this.callbacks.onToolChange(tool);
    }
  };

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}
