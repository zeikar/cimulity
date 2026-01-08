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
  private isEdgePanning: boolean = false;
  private rafId: number | null = null;
  private lastFrameTime: number = 0;
  private pointerX: number = 0;
  private pointerY: number = 0;
  private edgePanSpeed: number = 600;
  private edgePanMargin: number = 32;

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
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerX = event.clientX - rect.left;
    this.pointerY = event.clientY - rect.top;
    this.startEdgePanIfNeeded(rect.width, rect.height);
  };

  private handlePointerLeave = (): void => {
    this.stopEdgePan();
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

  private startEdgePanIfNeeded(width: number, height: number): void {
    const inEdge =
      this.pointerX < this.edgePanMargin ||
      this.pointerX > width - this.edgePanMargin ||
      this.pointerY < this.edgePanMargin ||
      this.pointerY > height - this.edgePanMargin;

    if (inEdge && !this.isEdgePanning) {
      this.isEdgePanning = true;
      this.lastFrameTime = performance.now();
      this.rafId = requestAnimationFrame(this.edgePanStep);
      this.canvas.style.cursor = 'move';
    } else if (!inEdge && this.isEdgePanning) {
      this.stopEdgePan();
    }
  }

  private edgePanStep = (time: number): void => {
    if (!this.isEdgePanning) return;

    const rect = this.canvas.getBoundingClientRect();
    const deltaTime = Math.max(0, time - this.lastFrameTime) / 1000;
    this.lastFrameTime = time;

    let panX = 0;
    let panY = 0;

    if (this.pointerX < this.edgePanMargin) {
      const intensity = 1 - this.pointerX / this.edgePanMargin;
      panX += this.edgePanSpeed * intensity * deltaTime;
    } else if (this.pointerX > rect.width - this.edgePanMargin) {
      const distance = rect.width - this.pointerX;
      const intensity = 1 - distance / this.edgePanMargin;
      panX -= this.edgePanSpeed * intensity * deltaTime;
    }

    if (this.pointerY < this.edgePanMargin) {
      const intensity = 1 - this.pointerY / this.edgePanMargin;
      panY += this.edgePanSpeed * intensity * deltaTime;
    } else if (this.pointerY > rect.height - this.edgePanMargin) {
      const distance = rect.height - this.pointerY;
      const intensity = 1 - distance / this.edgePanMargin;
      panY -= this.edgePanSpeed * intensity * deltaTime;
    }

    if (panX !== 0 || panY !== 0) {
      this.camera.pan(panX, panY);
      this.notifyCameraUpdate();
    }

    this.rafId = requestAnimationFrame(this.edgePanStep);
  };

  private stopEdgePan(): void {
    this.isEdgePanning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.canvas.style.cursor = 'default';
  }

  detach(): void {
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.stopEdgePan();
  }
}
