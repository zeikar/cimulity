import { mulberry32, pickIndex, seedFor } from './buildingSeed';

export type RoofType = 'flat' | 'gabled' | 'stepped';

// Kind only. offset + tallSide are derived from footprint shape at draw
// time and are NOT part of the variation token.
export type VolumeSplitKind = 'none' | 'x' | 'y';

export type ShellVariation = {
  roof: RoofType;
  splitKind: VolumeSplitKind;
  setbackSteps: 0 | 1 | 2;
  liftJitterPct: -4 | 0 | 4; // quantized
};

export function shellVariationFor(
  building: { id: number; level: number },
  footprint: { w: number; h: number },
): ShellVariation {
  const { w, h } = footprint;
  const rng = mulberry32(seedFor(building.id));

  // Draw 1: roof (consume rng even when forced flat to keep draw order stable)
  let roof: RoofType;
  if (building.level <= 2) {
    roof = 'flat';
  } else {
    const roofIdx = pickIndex(rng, [0.50, 0.35, 0.15]);
    roof = (['flat', 'gabled', 'stepped'] as const)[roofIdx];
  }

  // Draw 2: volume split eligibility
  let splitKind: VolumeSplitKind = 'none';
  if (building.level >= 3 && w * h >= 4) {
    const r1 = rng();
    if (r1 < 0.5) {
      if (w >= h && w >= 2) {
        splitKind = 'x';
      } else if (h >= 2) {
        splitKind = 'y';
      }
    }
  }

  // No rng draw — pure function of level
  const setbackSteps = (
    building.level >= 5 ? 2 : building.level >= 4 ? 1 : 0
  ) as 0 | 1 | 2;

  // Draw 3: lift jitter bucket
  const bucket = Math.floor(rng() * 3);
  const liftJitterPct = ([-4, 0, 4] as const)[bucket];

  return { roof, splitKind, setbackSteps, liftJitterPct };
}

const ROOF_CODES: Record<RoofType, string> = {
  flat: 'flat',
  gabled: 'gab',
  stepped: 'step',
};

export function shellVariationToken(v: ShellVariation): string {
  return (
    `roof:${ROOF_CODES[v.roof]}` +
    `|vsplit:${v.splitKind}` +
    `|setback:${v.setbackSteps}` +
    `|liftJ:${String(v.liftJitterPct)}`
  );
}

export function volumeSplitGeometry(
  splitKind: VolumeSplitKind,
  footprint: { w: number; h: number },
): { offset: number; tallSide: 'lo' } | null {
  const { w, h } = footprint;
  if (splitKind === 'none') return null;
  if (splitKind === 'x') return { offset: Math.floor(w / 2), tallSide: 'lo' };
  return { offset: Math.floor(h / 2), tallSide: 'lo' };
}
