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

export interface GameCanvasProps {
  onTileHover?: (tile: TileCoord | null) => void;
  onTileClick: (tile: TileCoord) => void;
  onFpsUpdate: (fps: number) => void;
  onCameraUpdate: (x: number, y: number, zoom: number) => void;
  onTickUpdate?: (tick: number, dirt: number, population: number, money: number) => void;
  currentTool?: Tool;
  onToolChange?: (tool: Tool) => void;
  /** Bump to trigger a "New City" reset on the live session. */
  resetNonce?: number;
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
  });

  // Stable forwarders: identity never changes; read callbacksRef at call time.
  const stableForwarders = useRef({
    onTileHover: (t: TileCoord | null) => callbacksRef.current.onTileHover?.(t),
    onTileClick: (t: TileCoord) => callbacksRef.current.onTileClick(t),
    onFpsUpdate: (fps: number) => callbacksRef.current.onFpsUpdate(fps),
    onCameraUpdate: (x: number, y: number, zoom: number) =>
      callbacksRef.current.onCameraUpdate(x, y, zoom),
    onTickUpdate: (tick: number, dirt: number, population: number, money: number) =>
      callbacksRef.current.onTickUpdate?.(tick, dirt, population, money),
    onToolChange: (tool: Tool) => callbacksRef.current.onToolChange?.(tool),
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
    void session.start(container, window.innerWidth, window.innerHeight);

    // Handle window resize
    const handleResize = () => {
      sessionRef.current?.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);
      session.dispose();
      sessionRef.current = null;
    };
  }, []);

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
