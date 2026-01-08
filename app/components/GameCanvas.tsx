'use client';

/**
 * GameCanvas component: Mounts PixiJS and handles lifecycle
 *
 * React StrictMode Safety:
 * - useEffect cleanup properly destroys PixiJS
 * - PixiApp.init() is idempotent
 * - Refs prevent double-initialization
 */

import { useEffect, useRef, useState } from 'react';
import { PixiApp } from '@/game/render/PixiApp';
import { World } from '@/game/core/World';
import { PointerHandler } from '@/game/input/PointerHandler';
import { CameraController } from '@/game/input/CameraController';
import type { TileCoord } from '@/game/types/coordinates';

export interface GameCanvasProps {
  onTileHover: (tile: TileCoord | null) => void;
  onTileClick: (tile: TileCoord) => void;
  onFpsUpdate: (fps: number) => void;
  onCameraUpdate: (x: number, y: number, zoom: number) => void;
}

export function GameCanvas({
  onTileHover,
  onTileClick,
  onFpsUpdate,
  onCameraUpdate,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiAppRef = useRef<PixiApp | null>(null);
  const worldRef = useRef<World | null>(null);
  const pointerHandlerRef = useRef<PointerHandler | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Prevent double initialization in StrictMode
    if (pixiAppRef.current) return;

    const canvas = canvasRef.current;

    console.log('GameCanvas: Initializing world...');
    // Initialize world (16x16 grid for testing - will increase later)
    const world = new World(16, 16);
    worldRef.current = world;
    console.log('GameCanvas: World created');

    // Initialize PixiJS app
    const pixiApp = new PixiApp(world, {
      onTileHover: (tile) => {
        pixiApp.setHoverTile(tile);
        onTileHover(tile);
      },
      onTileClick: (tile) => {
        pixiApp.setSelectedTile(tile);
        onTileClick(tile);
      },
      onFpsUpdate,
      onCameraUpdate,
    });
    pixiAppRef.current = pixiApp;

    // Initialize PixiJS (async)
    pixiApp.init(canvas, window.innerWidth, window.innerHeight).then(() => {
      const camera = pixiApp.getCamera();
      if (!camera) return;

      // Setup input handlers
      const pointerHandler = new PointerHandler(canvas, camera, world.getMap(), {
        onTileHover: (tile) => {
          pixiApp.setHoverTile(tile);
          onTileHover(tile);
        },
        onTileClick: (tile) => {
          pixiApp.setSelectedTile(tile);
          onTileClick(tile);
        },
      });
      pointerHandlerRef.current = pointerHandler;

      const cameraController = new CameraController(canvas, camera, {
        onCameraUpdate,
      });
      cameraControllerRef.current = cameraController;

      setIsInitialized(true);
    });

    // Handle window resize
    const handleResize = () => {
      pixiApp.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup function
    return () => {
      window.removeEventListener('resize', handleResize);

      pointerHandlerRef.current?.detach();
      cameraControllerRef.current?.detach();
      pixiAppRef.current?.destroy();

      pixiAppRef.current = null;
      pointerHandlerRef.current = null;
      cameraControllerRef.current = null;
      worldRef.current = null;

      setIsInitialized(false);
    };
  }, [onTileHover, onTileClick, onFpsUpdate, onCameraUpdate]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        display: 'block',
      }}
    />
  );
}
