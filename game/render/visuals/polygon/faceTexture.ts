/**
 * Building-face textures + per-face affine fill matrices for the cube buildings.
 *
 * Cube faces are flat parallelograms in anchor-local screen space, so a plain
 * front-on (wall) / top-down (roof) texture can be skewed onto each face by an
 * affine matrix — the art itself needs no iso baked in. With Pixi's
 * `textureSpace: 'global'` fill, the matrix maps texture-px -> local-px; Pixi
 * inverts it and divides by the texture's source size to get UVs, and repeat
 * wrap is auto-enabled for texture fills (so the textures should tile
 * seamlessly). Textures are grayscale and tinted per face at fill time, which
 * preserves the existing per-type colour + face shading.
 *
 * Each building type has several interchangeable wall variants; a building picks
 * one deterministically from its anchor (see `wallVariant`) so a city mixes
 * facades without any single building flickering between them.
 *
 * This module also preloads the terrain grass + water textures (single COLOUR
 * tiles; `getGrassTexture` / `getWaterTexture`), so `PixiApp.init` keeps one
 * `preloadFaceTextures()` call and reuses the same `loadTexture` plumbing. Those
 * tiles are consumed by `DiamondTileVisual` (terrain), not by the cube faces.
 */

import { Assets, Matrix, Texture } from 'pixi.js';
import type { BuildingType } from '@/game/core/Building';
import type { Point } from './cubeGeometry';

// next.config sets basePath '/cimulity' in production; mirror it here via the
// inlined env var so runtime asset URLs resolve under GitHub Pages (Next does
// not rewrite raw string URLs the way it does for <Image>/<Link>).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Wall variants per building type (files `${type}-0..N-1.png`). */
export const WALL_VARIANTS = 3;
const BUILDING_TYPES: readonly BuildingType[] = ['residential', 'commercial', 'industrial'];

const ROOF_URL = `${BASE_PATH}/textures/roof.png`;
const GABLE_ROOF_URL = `${BASE_PATH}/textures/gable-roof.png`;
const GRASS_URL = `${BASE_PATH}/textures/grass.png`;
const WATER_URL = `${BASE_PATH}/textures/water.png`;
const ROAD_URL = `${BASE_PATH}/textures/road.png`;
const PARK_URL = `${BASE_PATH}/textures/park.png`;
const DIRT_URL = `${BASE_PATH}/textures/dirt.png`;
const SAND_URL = `${BASE_PATH}/textures/sand.png`;
const ROCK_URL = `${BASE_PATH}/textures/rock.png`;
const YARD_RESIDENTIAL_URL = `${BASE_PATH}/textures/yard-residential.png`;
const YARD_COMMERCIAL_URL = `${BASE_PATH}/textures/yard-commercial.png`;
const YARD_INDUSTRIAL_URL = `${BASE_PATH}/textures/yard-industrial.png`;
const POLICE_WALL_URL = `${BASE_PATH}/textures/police-wall.png`;
const FIRE_WALL_URL = `${BASE_PATH}/textures/fire-wall.png`;
const HOSPITAL_WALL_URL = `${BASE_PATH}/textures/hospital-wall.png`;
const SCHOOL_WALL_URL = `${BASE_PATH}/textures/school-wall.png`;
const POWERPLANT_WALL_URL = `${BASE_PATH}/textures/powerplant-wall.png`;
const CHIMNEY_URL = `${BASE_PATH}/textures/chimney.png`;
const WATERTOWER_BODY_URL = `${BASE_PATH}/textures/watertower-body.png`;
const WATERTOWER_TANK_URL = `${BASE_PATH}/textures/watertower-tank.png`;
const TREE_0_URL = `${BASE_PATH}/textures/tree-0.png`;
const TREE_1_URL = `${BASE_PATH}/textures/tree-1.png`;
const BENCH_URL = `${BASE_PATH}/textures/bench.png`;
const FLOWERBED_URL = `${BASE_PATH}/textures/flowerbed.png`;
const wallUrl = (type: BuildingType, variant: number) =>
  `${BASE_PATH}/textures/${type}-${variant}.png`;

/** On-screen size (local px) of one full wall tile before it repeats. Smaller
 *  => more, smaller windows per wall. Pixel-art walls use a small (~64px) source
 *  texture, so this is sized to magnify it slightly (chunky dots) rather than
 *  minify. */
export const WALL_TILE_PX = 96;

/**
 * Compute how many times the wall texture repeats along each axis for a given
 * face. The face is ordered [topStart, topEnd, bottomEnd, bottomStart]. Used by
 * both `wallFaceFillMatrix` (texture mapping) and `windowLights` (cell layout),
 * so the two stay bit-for-bit aligned.
 */
export function wallFaceRepeats(face: ReadonlyArray<Point>): { repeatX: number; repeatY: number } {
  const o = face[0];
  const ax = face[1].x - o.x;
  const ay = face[1].y - o.y;
  const bx = face[3].x - o.x;
  const by = face[3].y - o.y;
  return {
    repeatX: Math.max(0.01, Math.hypot(ax, ay) / WALL_TILE_PX),
    repeatY: Math.max(0.01, Math.hypot(bx, by) / WALL_TILE_PX),
  };
}

/** type -> [variant0, variant1, ...] textures (null until loaded / on failure). */
const wallTextures = new Map<BuildingType, Array<Texture | null>>();
let roofTexture: Texture | null = null;
let gableRoofTexture: Texture | null = null;
let grassTexture: Texture | null = null;
let waterTexture: Texture | null = null;
let roadTexture: Texture | null = null;
let parkTexture: Texture | null = null;
let dirtTexture: Texture | null = null;
let sandTexture: Texture | null = null;
let rockTexture: Texture | null = null;
let yardResidentialTexture: Texture | null = null;
let yardCommercialTexture: Texture | null = null;
let yardIndustrialTexture: Texture | null = null;
let policeWallTexture: Texture | null = null;
let fireWallTexture: Texture | null = null;
let hospitalWallTexture: Texture | null = null;
let schoolWallTexture: Texture | null = null;
let powerPlantWallTexture: Texture | null = null;
let chimneyTexture: Texture | null = null;
let waterTowerBodyTexture: Texture | null = null;
let waterTowerTankTexture: Texture | null = null;
let tree0Texture: Texture | null = null;
let tree1Texture: Texture | null = null;
let benchTexture: Texture | null = null;
let flowerbedTexture: Texture | null = null;

function loadTexture(url: string): Promise<Texture | null> {
  // No asset loader without a browser (headless vitest mounts visuals directly).
  if (typeof window === 'undefined') return Promise.resolve(null);
  return Assets.load<Texture>(url)
    .then((t) => {
      t.source.scaleMode = 'nearest';
      t.source.wrapMode = 'repeat';
      return t;
    })
    .catch((err) => {
      console.warn(`[faceTexture] failed to load ${url}`, err);
      return null;
    });
}

/**
 * Preload every wall variant + the roof texture + the terrain grass and water
 * textures. Call from PixiApp.init BEFORE the first render so cube
 * GraphicsContexts (cached by shape) bake the loaded textures + correct-size
 * matrices rather than a flat fallback. The payload is small, so blocking the
 * first frame keeps the cached-context path simple with no perceptible startup
 * stall. Faces and terrain tiles fall back to a flat fill if a load fails.
 */
export async function preloadFaceTextures(): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const type of BUILDING_TYPES) {
    const variants: Array<Texture | null> = new Array(WALL_VARIANTS).fill(null);
    wallTextures.set(type, variants);
    for (let v = 0; v < WALL_VARIANTS; v++) {
      jobs.push(loadTexture(wallUrl(type, v)).then((t) => { variants[v] = t; }));
    }
  }
  jobs.push(loadTexture(ROOF_URL).then((t) => { roofTexture = t; }));
  jobs.push(loadTexture(GABLE_ROOF_URL).then((t) => { gableRoofTexture = t; }));
  jobs.push(loadTexture(GRASS_URL).then((t) => { grassTexture = t; }));
  jobs.push(loadTexture(WATER_URL).then((t) => { waterTexture = t; }));
  jobs.push(loadTexture(ROAD_URL).then((t) => { roadTexture = t; }));
  jobs.push(loadTexture(PARK_URL).then((t) => { parkTexture = t; }));
  jobs.push(loadTexture(DIRT_URL).then((t) => { dirtTexture = t; }));
  jobs.push(loadTexture(SAND_URL).then((t) => { sandTexture = t; }));
  jobs.push(loadTexture(ROCK_URL).then((t) => { rockTexture = t; }));
  jobs.push(loadTexture(YARD_RESIDENTIAL_URL).then((t) => { yardResidentialTexture = t; }));
  jobs.push(loadTexture(YARD_COMMERCIAL_URL).then((t) => { yardCommercialTexture = t; }));
  jobs.push(loadTexture(YARD_INDUSTRIAL_URL).then((t) => { yardIndustrialTexture = t; }));
  jobs.push(loadTexture(POLICE_WALL_URL).then((t) => { policeWallTexture = t; }));
  jobs.push(loadTexture(FIRE_WALL_URL).then((t) => { fireWallTexture = t; }));
  jobs.push(loadTexture(HOSPITAL_WALL_URL).then((t) => { hospitalWallTexture = t; }));
  jobs.push(loadTexture(SCHOOL_WALL_URL).then((t) => { schoolWallTexture = t; }));
  jobs.push(loadTexture(POWERPLANT_WALL_URL).then((t) => { powerPlantWallTexture = t; }));
  jobs.push(loadTexture(CHIMNEY_URL).then((t) => { chimneyTexture = t; }));
  jobs.push(loadTexture(WATERTOWER_BODY_URL).then((t) => { waterTowerBodyTexture = t; }));
  jobs.push(loadTexture(WATERTOWER_TANK_URL).then((t) => { waterTowerTankTexture = t; }));
  jobs.push(loadTexture(TREE_0_URL).then((t) => { tree0Texture = t; }));
  jobs.push(loadTexture(TREE_1_URL).then((t) => { tree1Texture = t; }));
  jobs.push(loadTexture(BENCH_URL).then((t) => { benchTexture = t; }));
  jobs.push(loadTexture(FLOWERBED_URL).then((t) => { flowerbedTexture = t; }));
  await Promise.all(jobs);
}

/**
 * Stable wall-variant index for a building, derived from its (immutable)
 * `buildingId` so the same building always renders the same facade — across
 * reload/HMR AND across growth (which moves the structure rect but not the id) —
 * while the city as a whole mixes variants. Integer-hash finalizer to spread
 * sequential ids across variants; `Math.imul` keeps it in 32-bit space.
 */
export function wallVariant(buildingId: number): number {
  let h = buildingId | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % WALL_VARIANTS;
}

/** Wall texture for a type+variant, or `Texture.EMPTY` (flat tint) until loaded. */
export function getWallTexture(type: BuildingType, variant: number): Texture {
  return wallTextures.get(type)?.[variant] ?? Texture.EMPTY;
}

/** Roof texture, or null until loaded (caller draws a flat-colour roof then). */
export function getRoofTexture(): Texture | null {
  return roofTexture;
}

/** Gable shingle texture (GRAYSCALE, tinted by the seeded roof colour), or null until loaded. */
export function getGableRoofTexture(): Texture | null {
  return gableRoofTexture;
}

/** Grass terrain texture (COLOUR), or null until loaded (caller draws flat grass then). */
export function getGrassTexture(): Texture | null {
  return grassTexture;
}

/** Water terrain texture (COLOUR), or null until loaded (caller draws flat water then). */
export function getWaterTexture(): Texture | null {
  return waterTexture;
}

/** Road asphalt texture (opaque COLOUR), or null until loaded (caller draws flat-colour bands then). */
export function getRoadTexture(): Texture | null {
  return roadTexture;
}

/** Park lawn terrain texture (COLOUR), or null until loaded (caller draws flat park colour then). */
export function getParkTexture(): Texture | null {
  return parkTexture;
}

/** Bare dirt terrain texture (COLOUR), or null until loaded (caller draws flat dirt colour then). */
export function getDirtTexture(): Texture | null {
  return dirtTexture;
}

/** Sand terrain texture (COLOUR), or null until loaded / on failure (caller then
 *  falls through to the existing land/flat fill — there is no separate flat-sand fallback). */
export function getSandTexture(): Texture | null {
  return sandTexture;
}

/** Highland rock terrain texture (COLOUR), or null until loaded / on failure
 *  (caller then falls through to the existing land/flat fill — no flat-rock fallback). */
export function getRockTexture(): Texture | null {
  return rockTexture;
}

/** Per-type yard ground texture (COLOUR) displayed around zone buildings, or null until loaded (flat fallback). */
export function getYardTexture(type: BuildingType): Texture | null {
  switch (type) {
    case 'residential': return yardResidentialTexture;
    case 'commercial':  return yardCommercialTexture;
    case 'industrial':  return yardIndustrialTexture;
  }
}

/** Police station wall texture (opaque COLOUR, windowless — windows drawn on top as vector), or null until loaded. */
export function getPoliceWallTexture(): Texture | null {
  return policeWallTexture;
}

/** Fire station wall texture (opaque COLOUR, windowless — windows drawn on top as vector), or null until loaded. */
export function getFireWallTexture(): Texture | null {
  return fireWallTexture;
}

/** Hospital wall texture (opaque COLOUR, windowless — windows drawn on top as vector), or null until loaded. */
export function getHospitalWallTexture(): Texture | null {
  return hospitalWallTexture;
}

/** School wall texture (opaque COLOUR, windowless — windows drawn on top as vector), or null until loaded. */
export function getSchoolWallTexture(): Texture | null {
  return schoolWallTexture;
}

/** Power plant wall texture (opaque COLOUR, windowless — windows drawn on top as vector), or null until loaded. */
export function getPowerPlantWallTexture(): Texture | null {
  return powerPlantWallTexture;
}

/** Chimney texture (opaque COLOUR), or null until loaded. */
export function getChimneyTexture(): Texture | null {
  return chimneyTexture;
}

/** Water tower body texture (opaque COLOUR), or null until loaded. */
export function getWaterTowerBodyTexture(): Texture | null {
  return waterTowerBodyTexture;
}

/** Water tower tank texture (opaque COLOUR), or null until loaded. */
export function getWaterTowerTankTexture(): Texture | null {
  return waterTowerTankTexture;
}

/** Tree decoration texture (COLOUR+alpha), or null until loaded. variant 0 = round deciduous, 1 = conifer. */
export function getTreeTexture(variant: 0 | 1): Texture | null {
  return variant === 0 ? tree0Texture : tree1Texture;
}

/** Park bench decoration texture (COLOUR+alpha), or null until loaded. */
export function getBenchTexture(): Texture | null {
  return benchTexture;
}

/** Flowerbed decoration texture (COLOUR+alpha), or null until loaded. */
export function getFlowerbedTexture(): Texture | null {
  return flowerbedTexture;
}

/**
 * Affine fill matrix mapping a wall texture onto a wall parallelogram.
 *
 * `face` is ordered [topStart, topEnd, bottomEnd, bottomStart] (see
 * cubeFacePolygons left/right). The texture's x-axis follows the top edge
 * (topStart -> topEnd, the iso skew), the y-axis follows the wall drop
 * (topStart -> bottomStart). `ox/oy` is the same anchor-local draw offset
 * drawPoly applies, so the matrix lines up with the drawn path. `tex` is the
 * resolved wall texture — its real source size is the matrix divisor (Pixi
 * divides by that internally to get UVs).
 *
 * Fractional repeats are allowed: < 1 shows only part of the (multi-window) tile
 * per wall, > 1 wraps; floored at a small epsilon to avoid div-by-zero.
 */
export function wallFaceFillMatrix(
  face: ReadonlyArray<Point>,
  ox: number,
  oy: number,
  tex: Texture,
): Matrix {
  const texW = tex.source.width || 1;
  const texH = tex.source.height || 1;

  const o = face[0];
  const ax = face[1].x - o.x;
  const ay = face[1].y - o.y;
  const bx = face[3].x - o.x;
  const by = face[3].y - o.y;

  const { repeatX, repeatY } = wallFaceRepeats(face);

  // x-column (edge dir) = a/(repeatX*texW), y-column (wall drop) = b/(repeatY*texH).
  return new Matrix(
    ax / (repeatX * texW),
    ay / (repeatX * texW),
    bx / (repeatY * texH),
    by / (repeatY * texH),
    o.x + ox,
    o.y + oy,
  );
}

/** On-screen size (local px) of one shingle tile before it repeats — 1:1 with
 *  the 48px source so courses stay chunky pixel-art. */
export const SHINGLE_TILE_PX = 48;

/**
 * Affine fill matrix mapping the shingle texture onto a gable roof slope.
 *
 * `face` is ordered [topStart, topEnd, bottomEnd, bottomStart] with the top
 * edge parallel to the ridge (see massingGableFaces), so the texture's x-axis
 * runs shingle courses along the slope and its y-axis follows the drop to the
 * eave. Same matrix form as wallFaceFillMatrix, with the shingle tile size.
 */
export function slopeFaceFillMatrix(
  face: ReadonlyArray<Point>,
  ox: number,
  oy: number,
  tex: Texture,
): Matrix {
  const texW = tex.source.width || 1;
  const texH = tex.source.height || 1;

  const o = face[0];
  const ax = face[1].x - o.x;
  const ay = face[1].y - o.y;
  const bx = face[3].x - o.x;
  const by = face[3].y - o.y;

  const repeatX = Math.max(0.01, Math.hypot(ax, ay) / SHINGLE_TILE_PX);
  const repeatY = Math.max(0.01, Math.hypot(bx, by) / SHINGLE_TILE_PX);

  return new Matrix(
    ax / (repeatX * texW),
    ay / (repeatX * texW),
    bx / (repeatY * texH),
    by / (repeatY * texH),
    o.x + ox,
    o.y + oy,
  );
}

/**
 * Affine fill matrix mapping the rooftop texture onto the top diamond face.
 *
 * `face` is the top polygon [N, E, S, W] (see cubeFacePolygons). The texture's
 * x-axis follows N->E and its y-axis follows N->W, so the roof grid aligns with
 * the iso tile grid. The whole texture maps once onto the diamond (one coherent
 * rooftop per building footprint), so it scales with footprint rather than
 * tiling into repeated mini-roofs.
 */
export function roofFaceFillMatrix(face: ReadonlyArray<Point>, ox: number, oy: number): Matrix {
  const tex = roofTexture;
  const texW = tex?.source.width || 1;
  const texH = tex?.source.height || 1;

  const o = face[0]; // N
  const ax = face[1].x - o.x; // N -> E
  const ay = face[1].y - o.y;
  const bx = face[3].x - o.x; // N -> W
  const by = face[3].y - o.y;

  return new Matrix(
    ax / texW,
    ay / texW,
    bx / texH,
    by / texH,
    o.x + ox,
    o.y + oy,
  );
}
