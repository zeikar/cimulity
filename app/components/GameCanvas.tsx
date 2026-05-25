'use client';

/**
 * GameCanvas component: thin React shell that mounts/disposes a GameSession
 *
 * React StrictMode Safety:
 * - useEffect cleanup disposes the GameSession (GameSession's disposed flag
 *   discards an in-flight async init)
 * - sessionRef prevents double-initialization
 */

import { useEffect, useRef } from 'react';
import { GameSession } from '@/game/engine';
import { Tool } from '@/game/tools';
import type { TileCoord } from '@/game/types/coordinates';
import type { WorldDate } from '@/game/core/World';
import type { DemandVector } from '@/game/core/Demand';

export interface GameCanvasProps {
  onTileHover?: (tile: TileCoord | null) => void;
  onTileClick: (tile: TileCoord) => void;
  onFpsUpdate: (fps: number) => void;
  onCameraUpdate: (x: number, y: number, zoom: number) => void;
  onTickUpdate?: (tick: number, dirt: number, population: number, money: number, date: WorldDate, demand: DemandVector) => void;
  currentTool?: Tool;
  onToolChange?: (tool: Tool) => void;
  /** Bump to trigger a "New City" reset on the live session. */
  resetNonce?: number;
  /** Engine → React mirror callback for the authoritative speed tier. */
  onSpeedChange?: (multiplier: 1 | 2 | 3) => void;
  /** Engine → React mirror callback for the authoritative paused flag. */
  onPauseChange?: (paused: boolean) => void;
  /** Page-supplied ref; GameCanvas populates with a speed commander after mount. */
  commandSpeedRef?: React.RefObject<((m: 1 | 2 | 3) => void) | null>;
  /** Page-supplied ref; GameCanvas populates with a pause-toggle commander after mount. */
  commandPauseRef?: React.RefObject<(() => void) | null>;
  /** Fires AFTER commandSpeedRef/commandPauseRef are populated, so the page can drain any pre-mount Toolbar clicks. */
  onCommandsReady?: () => void;
}

export function GameCanvas({
  onTileHover,
  onTileClick,
  onFpsUpdate,
  onCameraUpdate,
  onTickUpdate,
  currentTool = Tool.SELECT,
  onToolChange,
  resetNonce = 0,
  onSpeedChange,
  onPauseChange,
  commandSpeedRef,
  commandPauseRef,
  onCommandsReady,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<GameSession | null>(null);

  // Latest prop callbacks, refreshed every render so stable forwarders below
  // always reach the current callbacks without recreating the session.
  const callbacksRef = useRef({
    onTileHover,
    onTileClick,
    onFpsUpdate,
    onCameraUpdate,
    onTickUpdate,
    onToolChange,
    onSpeedChange,
    onPauseChange,
  });

  // Stable forwarders: identity never changes; read callbacksRef at call time.
  const stableForwarders = useRef({
    onTileHover: (t: TileCoord | null) => callbacksRef.current.onTileHover?.(t),
    onTileClick: (t: TileCoord) => callbacksRef.current.onTileClick(t),
    onFpsUpdate: (fps: number) => callbacksRef.current.onFpsUpdate(fps),
    onCameraUpdate: (x: number, y: number, zoom: number) =>
      callbacksRef.current.onCameraUpdate(x, y, zoom),
    onTickUpdate: (tick: number, dirt: number, population: number, money: number, date: WorldDate, demand: DemandVector) =>
      callbacksRef.current.onTickUpdate?.(tick, dirt, population, money, date, demand),
    onToolChange: (tool: Tool) => callbacksRef.current.onToolChange?.(tool),
    onSpeedChange: (multiplier: 1 | 2 | 3) => callbacksRef.current.onSpeedChange?.(multiplier),
    onPauseChange: (paused: boolean) => callbacksRef.current.onPauseChange?.(paused),
  });

  // Track current tool so the mount effect can read the initial tool without
  // closing over `currentTool` (avoids an exhaustive-deps warning).
  const currentToolRef = useRef(currentTool);

  // Refresh refs after every commit (no deps array). Declared before the
  // mount effect so refs are current when the mount effect first reads them.
  useEffect(() => {
    callbacksRef.current = {
      onTileHover,
      onTileClick,
      onFpsUpdate,
      onCameraUpdate,
      onTickUpdate,
      onToolChange,
      onSpeedChange,
      onPauseChange,
    };
    currentToolRef.current = currentTool;
  });

  // Sync external tool changes to the session (subsequent changes only;
  // the mount effect already did the initial sync).
  useEffect(() => {
    sessionRef.current?.setTool(currentTool);
  }, [currentTool]);

  // "New City": run on bump only, never on the initial mount (which would
  // wipe the just-hydrated save).
  const resetMounted = useRef(false);
  useEffect(() => {
    if (!resetMounted.current) {
      resetMounted.current = true;
      return;
    }
    sessionRef.current?.resetWorld();
  }, [resetNonce]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Prevent double initialization in StrictMode
    if (sessionRef.current) return;

    const container = containerRef.current;

    const session = new GameSession(stableForwarders.current);
    sessionRef.current = session;
    // Apply a non-default initial tool even if the [currentTool] effect's
    // first run preceded sessionRef.current being set.
    session.setTool(currentToolRef.current);
    if (commandSpeedRef) {
      commandSpeedRef.current = (m) => sessionRef.current?.setSpeedMultiplier(m);
    }
    if (commandPauseRef) {
      commandPauseRef.current = () => sessionRef.current?.togglePaused();
    }
    // Notify the page that the command refs are live, so it can drain any pre-mount
    // Toolbar clicks queued in pendingCommandsRef. Calls into the refs above resolve
    // to GameSession.setSpeedMultiplier/togglePaused, which queue internally until
    // gameLoop is constructed in start() — so no input is silently dropped (after hydration).
    onCommandsReady?.();
    void session.start(container, window.innerWidth, window.innerHeight);

    // Handle window resize
    const handleResize = () => {
      sessionRef.current?.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);
      if (commandSpeedRef) commandSpeedRef.current = null;
      if (commandPauseRef) commandPauseRef.current = null;
      session.dispose();
      sessionRef.current = null;
    };
  }, [commandSpeedRef, commandPauseRef, onCommandsReady]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
      }}
    />
  );
}
