/**
 * Camera control from user input
 */

import type { Camera } from '../render/Camera';

export interface CameraControlCallbacks {
  onCameraUpdate: (x: number, y: number, zoom: number) => void;
}

export class CameraController {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private callbacks: CameraControlCallbacks;
  private isPanning: boolean = false;
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;

  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    callbacks: CameraControlCallbacks
  ) {
    this.canvas = canvas;
    this.camera = camera;
    this.callbacks = callbacks;

    this.attachListeners();
  }

  private attachListeners(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  private handlePointerDown = (event: PointerEvent): void => {
    // Right-click or middle-click to pan
    if (event.button === 2 || event.button === 1) {
      event.preventDefault();
      this.isPanning = true;
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.canvas.style.cursor = 'grabbing';
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.isPanning) return;

    const deltaX = event.clientX - this.lastPointerX;
    const deltaY = event.clientY - this.lastPointerY;

    this.camera.pan(deltaX, deltaY);
    this.notifyCameraUpdate();

    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  };

  private handlePointerUp = (): void => {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = 'default';
    }
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();

    // Zoom delta (normalize across browsers)
    const delta = -event.deltaY * 0.001;

    // Get cursor position relative to canvas
    const rect = this.canvas.getBoundingClientRect();
    const pivotX = event.clientX - rect.left;
    const pivotY = event.clientY - rect.top;

    // Zoom around cursor
    this.camera.zoomAround(delta, { x: pivotX, y: pivotY });
    this.notifyCameraUpdate();
  };

  private notifyCameraUpdate(): void {
    const pos = this.camera.getPosition();
    this.callbacks.onCameraUpdate(pos.x, pos.y, this.camera.getZoom());
  }

  detach(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }
}
