/**
 * Keyboard input handler for tool shortcuts
 */

import { Tool } from '../tools/Tool';

export interface KeyboardCallbacks {
  onToolChange: (tool: Tool) => void;
}

/**
 * Key mapping for tool shortcuts
 */
const KEY_TO_TOOL: Record<string, Tool> = {
  r: Tool.ROAD,
  b: Tool.BULLDOZE,
  s: Tool.SELECT,
  Escape: Tool.SELECT,
  '1': Tool.ZONE_RESIDENTIAL,
  '2': Tool.ZONE_COMMERCIAL,
  '3': Tool.ZONE_INDUSTRIAL,
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
