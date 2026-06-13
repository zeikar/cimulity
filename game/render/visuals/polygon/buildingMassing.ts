/**
 * Deterministic massing planner for zone buildings: turns (type, level,
 * density, footprint size, height budget, per-building seed) into a small set
 * of boxes (podium + tower, main + wing, gable house) plus rooftop props
 * (AC units, water tanks, vent stacks, antennas), so same-stat buildings stop
 * rendering as identical flat-top cubes.
 *
 * Pure module — no Pixi, no Math.random; every choice derives from the seed so
 * a building keeps its silhouette across reloads and re-renders. Geometry
 * projection lives in massingGeometry; this module only decides WHAT to build.
 */

import type { BuildingType } from '@/game/core/Building';
import { cubeTypeInsetRatio } from './cubeTypeRatios';
import type { FracRect } from './massingGeometry';
import type { FacadeMode } from './windowGeometry';

export type MassingRoof =
  | { kind: 'flat' }
  | { kind: 'gable'; ridgeAxis: 'x' | 'y'; risePx: number; color: number };

export type MassingBox = {
  rect: FracRect;
  baseLiftPx: number;
  /** Wall height in px; gable boxes rise roof.risePx further above this. */
  wallHeightPx: number;
  roof: MassingRoof;
  /** Wall-window style for this box; tower = curtain, else punched. */
  facade: FacadeMode;
};

export type MassingProp =
  | { kind: 'ac' | 'tank' | 'vent'; rect: FracRect; baseLiftPx: number; heightPx: number }
  | { kind: 'antenna'; tx: number; ty: number; baseLiftPx: number; heightPx: number };

export type MassingPlan = {
  /** Painter order: a later box is never behind-and-not-above an earlier one. */
  boxes: MassingBox[];
  /** Drawn after all boxes; placed so no later-drawn box can occlude them. */
  props: MassingProp[];
  /** Highest point above the tile plane (gable ridges and props included). */
  totalHeightPx: number;
};

export type MassingInput = {
  type: BuildingType;
  level: number;
  density: 0 | 1 | 2;
  /** Structure rect size in tiles. */
  w: number;
  h: number;
  /** Overall height budget in px (cubeBodyHeightPx) before per-building jitter. */
  bodyHeightPx: number;
  /** Per-building variant seed — massingSeed(buildingId). */
  seed: number;
};

/** Massing variant count — bounds the faces-context cache key cardinality. */
export const MASSING_VARIANTS = 128;

// Salt distinct from wallVariant (0x45d9f3b) and windowSeed (0x9e3779b9) so the
// three per-building hashes stay independent.
const MASSING_SEED_SALT = 0x85ebca6b;

/** Deterministic per-building massing seed in [0, MASSING_VARIANTS). */
export function massingSeed(buildingId: number): number {
  let h = buildingId | 0;
  h = Math.imul(h ^ (h >>> 16), MASSING_SEED_SALT);
  h = Math.imul(h ^ (h >>> 16), MASSING_SEED_SALT);
  h = (h ^ (h >>> 16)) >>> 0;
  return h % MASSING_VARIANTS;
}

/** Deterministic value in [0, 1) for (seed, slot) — the planner's dice rolls. */
export function seedUnit(seed: number, slot: number): number {
  let h = (Math.imul(seed, 0x9e3779b1) + Math.imul(slot + 1, 0x85ebca77)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** Gable roof palette: terracotta, slate, brown, moss — picked per seed. */
export const GABLE_ROOF_COLORS: readonly number[] = [0xa84a32, 0x5f6e7d, 0x7c6248, 0x586b4a];

// Prop footprint sizes in tiles / heights in px — small enough to read as
// rooftop clutter, large enough to survive the iso projection.
const AC_SIZE = 0.16;
const AC_HEIGHT = 3;
const TANK_SIZE = 0.2;
const TANK_HEIGHT = 6;
const VENT_SIZE = 0.1;

function finishPlan(boxes: MassingBox[], props: MassingProp[]): MassingPlan {
  let totalHeightPx = 0;
  for (const b of boxes) {
    const top = b.baseLiftPx + b.wallHeightPx + (b.roof.kind === 'gable' ? b.roof.risePx : 0);
    if (top > totalHeightPx) totalHeightPx = top;
  }
  for (const p of props) {
    const top = p.baseLiftPx + p.heightPx;
    if (top > totalHeightPx) totalHeightPx = top;
  }
  return { boxes, props, totalHeightPx };
}

/** Seeded size×size square inside `roof` (with margin), or null if it cannot fit. */
function placeUnit(roof: FracRect, size: number, u: number, v: number): FracRect | null {
  const margin = 0.1;
  const availX = roof.x1 - roof.x0 - 2 * margin - size;
  const availY = roof.y1 - roof.y0 - 2 * margin - size;
  if (availX < 0 || availY < 0) return null;
  const x0 = roof.x0 + margin + availX * u;
  const y0 = roof.y0 + margin + availY * v;
  return { x0, y0, x1: x0 + size, y1: y0 + size };
}

/**
 * Split `outer` along its longer axis into a back main block and a front wing
 * (front = larger x+y, so drawing main first keeps painter order correct).
 */
function splitMainWing(
  outer: FracRect,
  wingFrac: number,
): { main: FracRect; wing: FracRect; axis: 'x' | 'y' } {
  const sx = outer.x1 - outer.x0;
  const sy = outer.y1 - outer.y0;
  if (sx >= sy) {
    const cut = outer.x1 - sx * wingFrac;
    return {
      main: { ...outer, x1: cut },
      wing: { ...outer, x0: cut },
      axis: 'x',
    };
  }
  const cut = outer.y1 - sy * wingFrac;
  return {
    main: { ...outer, y1: cut },
    wing: { ...outer, y0: cut },
    axis: 'y',
  };
}

/** Back half of `rect` along `axis` — prop zone safe from a taller front wing. */
function backHalf(rect: FracRect, axis: 'x' | 'y'): FracRect {
  if (axis === 'x') return { ...rect, x1: rect.x0 + (rect.x1 - rect.x0) / 2 };
  return { ...rect, y1: rect.y0 + (rect.y1 - rect.y0) / 2 };
}

function gableRoof(bodyH: number, outer: FracRect, seed: number): MassingBox {
  const wallH = Math.max(4, Math.round(bodyH * 0.62));
  const rise = Math.max(3, Math.min(bodyH - wallH, Math.round(wallH * 1.2)));
  const sx = outer.x1 - outer.x0;
  const sy = outer.y1 - outer.y0;
  const ridgeAxis: 'x' | 'y' = sx > sy ? 'x' : sy > sx ? 'y' : seedUnit(seed, 2) < 0.5 ? 'x' : 'y';
  const color = GABLE_ROOF_COLORS[Math.floor(seedUnit(seed, 3) * GABLE_ROOF_COLORS.length)];
  return {
    rect: outer,
    baseLiftPx: 0,
    wallHeightPx: wallH,
    roof: { kind: 'gable', ridgeAxis, risePx: rise, color },
    facade: 'punched',
  };
}

function residentialPlan(
  outer: FracRect,
  bodyH: number,
  input: MassingInput,
): MassingPlan {
  const { level, density, w, h, seed } = input;

  // Low density always reads as houses; small low-level lots flip a coin so
  // medium-density suburbs mix gabled and flat-top stock.
  if (density === 0 || (level <= 2 && seedUnit(seed, 1) < 0.5)) {
    return finishPlan([gableRoof(bodyH, outer, seed)], []);
  }

  const boxes: MassingBox[] = [];
  const props: MassingProp[] = [];
  let mainRect = outer;

  if (Math.min(w, h) >= 2 && bodyH >= 18) {
    const wingFrac = 0.32 + 0.08 * seedUnit(seed, 4);
    const { main, wing } = splitMainWing(outer, wingFrac);
    mainRect = main;
    const wingH = Math.max(4, Math.round(bodyH * (0.55 + 0.15 * seedUnit(seed, 5))));
    boxes.push({ rect: main, baseLiftPx: 0, wallHeightPx: bodyH, roof: { kind: 'flat' }, facade: 'punched' });
    boxes.push({ rect: wing, baseLiftPx: 0, wallHeightPx: wingH, roof: { kind: 'flat' }, facade: 'punched' });
  } else {
    boxes.push({ rect: outer, baseLiftPx: 0, wallHeightPx: bodyH, roof: { kind: 'flat' }, facade: 'punched' });
  }

  // High-rise slabs carry a water tank; lower slabs an AC unit. The wing is
  // always shorter than the main block, so main-roof props cannot be occluded.
  if (density === 2 && bodyH >= 30) {
    const rect = placeUnit(mainRect, TANK_SIZE, seedUnit(seed, 6), seedUnit(seed, 7));
    if (rect) props.push({ kind: 'tank', rect, baseLiftPx: bodyH, heightPx: TANK_HEIGHT });
  } else if (bodyH >= 10) {
    const rect = placeUnit(mainRect, AC_SIZE, seedUnit(seed, 6), seedUnit(seed, 7));
    if (rect) props.push({ kind: 'ac', rect, baseLiftPx: bodyH, heightPx: AC_HEIGHT });
  }

  return finishPlan(boxes, props);
}

function commercialPlan(
  outer: FracRect,
  bodyH: number,
  input: MassingInput,
): MassingPlan {
  const { level, w, h, seed } = input;

  if (level >= 3 && Math.min(w, h) >= 2) {
    const boxes: MassingBox[] = [];
    const props: MassingProp[] = [];

    const podiumH = Math.max(6, Math.round(bodyH * (0.22 + 0.08 * seedUnit(seed, 2))));
    const towerH = Math.max(4, bodyH - podiumH);
    const sx = outer.x1 - outer.x0;
    const sy = outer.y1 - outer.y0;
    const tw = sx * (0.55 + 0.2 * seedUnit(seed, 3));
    const th = sy * (0.55 + 0.2 * seedUnit(seed, 4));
    // Tower sits at the back corner or centered — never the front corner, so the
    // podium's front strip stays free for props drawn after the tower.
    const centered = seedUnit(seed, 5) >= 0.5;
    const tx0 = outer.x0 + (centered ? (sx - tw) / 2 : 0);
    const ty0 = outer.y0 + (centered ? (sy - th) / 2 : 0);
    const tower: FracRect = { x0: tx0, y0: ty0, x1: tx0 + tw, y1: ty0 + th };

    boxes.push({ rect: outer, baseLiftPx: 0, wallHeightPx: podiumH, roof: { kind: 'flat' }, facade: 'punched' });
    boxes.push({ rect: tower, baseLiftPx: podiumH, wallHeightPx: towerH, roof: { kind: 'flat' }, facade: 'curtain' });

    if (level >= 5 && seedUnit(seed, 6) < 0.6) {
      props.push({
        kind: 'antenna',
        tx: tower.x0 + 0.3 * tw,
        ty: tower.y0 + 0.3 * th,
        baseLiftPx: podiumH + towerH,
        heightPx: 8 + Math.round(6 * seedUnit(seed, 7)),
      });
    }

    const frontStrip: FracRect = { x0: outer.x0, y0: tower.y1, x1: outer.x1, y1: outer.y1 };
    const acRect = placeUnit(frontStrip, AC_SIZE, seedUnit(seed, 8), seedUnit(seed, 9));
    if (acRect) props.push({ kind: 'ac', rect: acRect, baseLiftPx: podiumH, heightPx: AC_HEIGHT });

    return finishPlan(boxes, props);
  }

  const props: MassingProp[] = [];
  if (bodyH >= 10) {
    const rect = placeUnit(outer, AC_SIZE, seedUnit(seed, 2), seedUnit(seed, 3));
    if (rect) props.push({ kind: 'ac', rect, baseLiftPx: bodyH, heightPx: AC_HEIGHT });
  }
  return finishPlan(
    [{ rect: outer, baseLiftPx: 0, wallHeightPx: bodyH, roof: { kind: 'flat' }, facade: 'punched' }],
    props,
  );
}

function industrialPlan(
  outer: FracRect,
  bodyH: number,
  input: MassingInput,
): MassingPlan {
  const { w, h, seed } = input;
  const boxes: MassingBox[] = [];
  let ventRoof = outer;

  if (Math.min(w, h) >= 2 && bodyH >= 8) {
    const wingFrac = 0.28 + 0.08 * seedUnit(seed, 2);
    const { main, wing, axis } = splitMainWing(outer, wingFrac);
    // The wing is sometimes a taller head house — vents go to the back half of
    // the main roof so they stay clear of its screen projection.
    const wingH = Math.max(4, Math.round(bodyH * (seedUnit(seed, 3) < 0.5 ? 1.3 : 0.6)));
    boxes.push({ rect: main, baseLiftPx: 0, wallHeightPx: bodyH, roof: { kind: 'flat' }, facade: 'punched' });
    boxes.push({ rect: wing, baseLiftPx: 0, wallHeightPx: wingH, roof: { kind: 'flat' }, facade: 'punched' });
    ventRoof = backHalf(main, axis);
  } else {
    boxes.push({ rect: outer, baseLiftPx: 0, wallHeightPx: bodyH, roof: { kind: 'flat' }, facade: 'punched' });
  }

  const props: MassingProp[] = [];
  const ventCount = w * h >= 6 ? 2 : 1;
  for (let i = 0; i < ventCount; i++) {
    const rect = placeUnit(ventRoof, VENT_SIZE, seedUnit(seed, 10 + i), seedUnit(seed, 20 + i));
    if (rect) {
      props.push({
        kind: 'vent',
        rect,
        baseLiftPx: bodyH,
        heightPx: 6 + Math.round(5 * seedUnit(seed, 30 + i)),
      });
    }
  }

  return finishPlan(boxes, props);
}

/**
 * Build the massing plan for one building. `bodyHeightPx` is the pre-massing
 * cube height (cubeBodyHeightPx) so overall city scale is preserved; a seeded
 * ±10% jitter keeps same-stat neighbours from matching exactly.
 */
export function buildMassingPlan(input: MassingInput): MassingPlan {
  const { type, level, w, h, bodyHeightPx, seed } = input;
  if (level <= 0 || bodyHeightPx <= 0 || w <= 0 || h <= 0) {
    return { boxes: [], props: [], totalHeightPx: 0 };
  }

  const inset = cubeTypeInsetRatio(type);
  const outer: FracRect = {
    x0: w * inset,
    y0: h * inset,
    x1: w * (1 - inset),
    y1: h * (1 - inset),
  };
  const jitter = 0.9 + 0.2 * seedUnit(seed, 0);
  const bodyH = Math.max(4, Math.round(bodyHeightPx * jitter));

  switch (type) {
    case 'residential':
      return residentialPlan(outer, bodyH, input);
    case 'commercial':
      return commercialPlan(outer, bodyH, input);
    case 'industrial':
      return industrialPlan(outer, bodyH, input);
  }
}
