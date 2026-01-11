'use client';

/**
 * GameCanvas component: Mounts PixiJS and handles lifecycle
 *
 * React StrictMode Safety:
 * - useEffect cleanup properly destroys PixiJS
 * - PixiApp.init() is idempotent
 * - Refs prevent double-initialization
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { PixiApp } from '@/game/render/PixiApp';
import { World } from '@/game/core/World';
import { PointerHandler } from '@/game/input/PointerHandler';
import { CameraController } from '@/game/input/CameraController';
import { ToolManager, Tool } from '@/game/input/ToolManager';
import { KeyboardHandler } from '@/game/input/KeyboardHandler';
import { executeToolAction } from '@/game/core/ToolActions';
import type { TileCoord } from '@/game/types/coordinates';

export interface GameCanvasProps {
  onTileHover: (tile: TileCoord | null) => void;
  onTileClick: (tile: TileCoord) => void;
  onFpsUpdate: (fps: number) => void;
  onCameraUpdate: (x: number, y: number, zoom: number) => void;
  currentTool?: Tool;
  onToolChange?: (tool: Tool) => void;
}

export function GameCanvas({
  onTileHover,
  onTileClick,
  onFpsUpdate,
  onCameraUpdate,
  currentTool = Tool.SELECT,
  onToolChange,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiAppRef = useRef<PixiApp | null>(null);
  const worldRef = useRef<World | null>(null);
  const pointerHandlerRef = useRef<PointerHandler | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const toolManagerRef = useRef<ToolManager>(new ToolManager());
  const keyboardHandlerRef = useRef<KeyboardHandler | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Sync external tool changes to tool manager
  useEffect(() => {
    toolManagerRef.current.setTool(currentTool);
  }, [currentTool]);

  // Handle tool execution on tiles
  const handleToolExecution = useCallback((tiles: TileCoord[]) => {
    if (!worldRef.current || !pixiAppRef.current) return;

    const tool = toolManagerRef.current.getCurrentTool();
    const modified = executeToolAction(tool, tiles, worldRef.current);

    if (modified) {
      const tileRenderer = pixiAppRef.current.getTileRenderer();
      tileRenderer?.markDirty();
    }
  }, []);

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
          // Execute tool action on single tile
          handleToolExecution([tile]);
          pixiApp.setSelectedTile(tile);
          onTileClick(tile);
        },
        onTileDrag: (tiles) => {
          // Execute tool action on all dragged tiles
          handleToolExecution(tiles);
        },
        onDragPreview: (tiles) => {
          // Only show preview for ROAD tool
          const currentTool = toolManagerRef.current.getCurrentTool();
          const selectionRenderer = pixiApp.getSelectionRenderer();
          if (tiles === null || currentTool !== Tool.ROAD) {
            selectionRenderer?.clearDragPreview();
          } else {
            selectionRenderer?.setDragPreview(tiles);
          }
        },
      });
      pointerHandlerRef.current = pointerHandler;

      const cameraController = new CameraController(canvas, camera, {
        onCameraUpdate,
      });
      cameraControllerRef.current = cameraController;

      // Setup keyboard handler for tool shortcuts
      const keyboardHandler = new KeyboardHandler({
        onToolChange: (tool) => {
          toolManagerRef.current.setTool(tool);
          onToolChange?.(tool);
        },
      });
      keyboardHandlerRef.current = keyboardHandler;

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
      keyboardHandlerRef.current?.detach();
      pixiAppRef.current?.destroy();

      pixiAppRef.current = null;
      pointerHandlerRef.current = null;
      cameraControllerRef.current = null;
      keyboardHandlerRef.current = null;
      worldRef.current = null;

      setIsInitialized(false);
    };
  }, [onTileHover, onTileClick, onFpsUpdate, onCameraUpdate, onToolChange, handleToolExecution]);

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
