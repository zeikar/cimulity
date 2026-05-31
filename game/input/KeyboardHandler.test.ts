import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { KeyboardHandler } from './KeyboardHandler';
import { Tool } from '../tools/Tool';

// Local alias for the SpeedTier that KeyboardCallbacks uses internally (1|2|3).
type SpeedTier = 1 | 2 | 3;

// Minimal event shape KeyboardHandler reads — only the fields the production code touches.
type StubKeyEvent = { key: string; target: unknown; preventDefault: () => void };
type StubListener = (e: StubKeyEvent) => void;

// Minimal listener registry, restored per-test.
let listeners: Array<StubListener>;
let onToolChange: Mock<(tool: Tool) => void>;
let onSpeedChange: Mock<(tier: SpeedTier) => void>;
let onPauseToggle: Mock<() => void>;

// Sentinel classes so `event.target instanceof HTMLInputElement` works without jsdom.
class FakeInputElement {}
class FakeTextAreaElement {}

beforeEach(() => {
  listeners = [];
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: StubListener) => {
      if (type === 'keydown') listeners.push(fn);
    },
    removeEventListener: (type: string, fn: StubListener) => {
      if (type === 'keydown') listeners = listeners.filter((l) => l !== fn);
    },
  });
  vi.stubGlobal('HTMLInputElement', FakeInputElement);
  vi.stubGlobal('HTMLTextAreaElement', FakeTextAreaElement);
  onToolChange = vi.fn<(tool: Tool) => void>();
  onSpeedChange = vi.fn<(tier: SpeedTier) => void>();
  onPauseToggle = vi.fn<() => void>();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fire(key: string, target: unknown = null, modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}) {
  const event = { key, target, preventDefault: vi.fn(), ...modifiers };
  for (const l of listeners) l(event);
  return event;
}

describe('KeyboardHandler', () => {
  it('Space triggers onPauseToggle (not onToolChange or onSpeedChange) and calls preventDefault', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire(' ');
    expect(onPauseToggle).toHaveBeenCalledOnce();
    expect(onToolChange).not.toHaveBeenCalled();
    expect(onSpeedChange).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('1 / 2 / 3 trigger onSpeedChange with correct tiers (not onToolChange) and call preventDefault', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });

    const e1 = fire('1');
    expect(onSpeedChange).toHaveBeenCalledWith(1);
    expect(onToolChange).not.toHaveBeenCalled();
    expect(e1.preventDefault).toHaveBeenCalled();

    onSpeedChange.mockClear();
    const e2 = fire('2');
    expect(onSpeedChange).toHaveBeenCalledWith(2);
    expect(e2.preventDefault).toHaveBeenCalled();

    onSpeedChange.mockClear();
    const e3 = fire('3');
    expect(onSpeedChange).toHaveBeenCalledWith(3);
    expect(e3.preventDefault).toHaveBeenCalled();
  });

  it('q / w / e trigger onToolChange with ZONE_RESIDENTIAL / COMMERCIAL / INDUSTRIAL and call preventDefault', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });

    const eq = fire('q');
    expect(onToolChange).toHaveBeenCalledWith(Tool.ZONE_RESIDENTIAL);
    expect(eq.preventDefault).toHaveBeenCalled();

    onToolChange.mockClear();
    const ew = fire('w');
    expect(onToolChange).toHaveBeenCalledWith(Tool.ZONE_COMMERCIAL);
    expect(ew.preventDefault).toHaveBeenCalled();

    onToolChange.mockClear();
    const ee = fire('e');
    expect(onToolChange).toHaveBeenCalledWith(Tool.ZONE_INDUSTRIAL);
    expect(ee.preventDefault).toHaveBeenCalled();
  });

  it('t / b / s / Escape / r / f / g / p / a / c / d trigger onToolChange with the correct tool each', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });

    const pairs: Array<[string, Tool]> = [
      ['t', Tool.ROAD],
      ['b', Tool.BULLDOZE],
      ['s', Tool.SELECT],
      ['Escape', Tool.SELECT],
      ['r', Tool.TERRAIN_UP],
      ['f', Tool.TERRAIN_DOWN],
      ['g', Tool.TERRAIN_LEVEL],
      ['p', Tool.POWER_PLANT],
      ['a', Tool.WATER_TOWER],
      ['c', Tool.POLICE_STATION],
      ['d', Tool.FIRE_STATION],
    ];
    for (const [key, expected] of pairs) {
      onToolChange.mockClear();
      const event = fire(key);
      expect(onToolChange).toHaveBeenCalledWith(expected);
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });

  it('keys typed into an HTMLInputElement target are ignored', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire('1', new FakeInputElement());
    expect(onToolChange).not.toHaveBeenCalled();
    expect(onSpeedChange).not.toHaveBeenCalled();
    expect(onPauseToggle).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('keys typed into an HTMLTextAreaElement target are ignored', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire(' ', new FakeTextAreaElement());
    expect(onToolChange).not.toHaveBeenCalled();
    expect(onSpeedChange).not.toHaveBeenCalled();
    expect(onPauseToggle).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('detach() removes the listener so further keydown events do not fire callbacks', () => {
    const handler = new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    handler.detach();
    fire(' ');
    fire('1');
    fire('r');
    expect(onPauseToggle).not.toHaveBeenCalled();
    expect(onSpeedChange).not.toHaveBeenCalled();
    expect(onToolChange).not.toHaveBeenCalled();
  });

  it('modifier combos (Ctrl/Meta/Alt) are not intercepted — no callback fires and preventDefault is not called', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });

    // Ctrl+W (close-tab combo)
    const ectrlw = fire('w', null, { ctrlKey: true });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(ectrlw.preventDefault).not.toHaveBeenCalled();

    // Meta+W
    const emetaw = fire('w', null, { metaKey: true });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(emetaw.preventDefault).not.toHaveBeenCalled();

    // Alt+W
    const ealtw = fire('w', null, { altKey: true });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(ealtw.preventDefault).not.toHaveBeenCalled();

    // Ctrl+1 (speed tier key)
    const ectrl1 = fire('1', null, { ctrlKey: true });
    expect(onSpeedChange).not.toHaveBeenCalled();
    expect(ectrl1.preventDefault).not.toHaveBeenCalled();

    // Ctrl+Space (pause key)
    const ectrlspace = fire(' ', null, { ctrlKey: true });
    expect(onPauseToggle).not.toHaveBeenCalled();
    expect(ectrlspace.preventDefault).not.toHaveBeenCalled();

    // Ctrl+A (non-game key)
    const ectrla = fire('a', null, { ctrlKey: true });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(ectrla.preventDefault).not.toHaveBeenCalled();
  });

  it('uppercase Q / W / E (caps lock) trigger zone tools', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });

    const eQ = fire('Q');
    expect(onToolChange).toHaveBeenCalledWith(Tool.ZONE_RESIDENTIAL);
    expect(eQ.preventDefault).toHaveBeenCalled();

    onToolChange.mockClear();
    const eW = fire('W');
    expect(onToolChange).toHaveBeenCalledWith(Tool.ZONE_COMMERCIAL);
    expect(eW.preventDefault).toHaveBeenCalled();

    onToolChange.mockClear();
    const eE = fire('E');
    expect(onToolChange).toHaveBeenCalledWith(Tool.ZONE_INDUSTRIAL);
    expect(eE.preventDefault).toHaveBeenCalled();
  });

  it('shift modifier is ignored for tool keys — w + shift still fires Tool.ZONE_COMMERCIAL', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire('w', null, { shiftKey: true });
    expect(onToolChange).toHaveBeenCalledWith(Tool.ZONE_COMMERCIAL);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('plain w (no shift) still fires Tool.ZONE_COMMERCIAL (regression)', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire('w', null, { shiftKey: false });
    expect(onToolChange).toHaveBeenCalledWith(Tool.ZONE_COMMERCIAL);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('Ctrl+R is not intercepted — modifier short-circuit guards new TERRAIN_UP bind', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire('r', null, { ctrlKey: true });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('Ctrl+T is not intercepted', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire('t', null, { ctrlKey: true });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('Ctrl+F is not intercepted', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire('f', null, { ctrlKey: true });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('Ctrl+G is not intercepted — modifier short-circuit guards TERRAIN_LEVEL bind', () => {
    new KeyboardHandler({ onToolChange, onSpeedChange, onPauseToggle });
    const event = fire('g', null, { ctrlKey: true });
    expect(onToolChange).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
