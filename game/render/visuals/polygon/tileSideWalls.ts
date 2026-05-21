export type NeighborRenderHeights = { n?: number; e?: number; s?: number; w?: number };

function effectiveNeighborRH(selfRH: number, neighborRH: number | undefined): number {
  return neighborRH ?? Math.max(0, selfRH - 1);
}

export function shouldDrawFace(face: 'n' | 'e' | 's' | 'w', selfRH: number, neighborRH: number | undefined): boolean {
  if (face === 'n' || face === 'w') return false;
  return selfRH > effectiveNeighborRH(selfRH, neighborRH);
}

export function wallSteps(selfRH: number, neighborRH: number | undefined): number {
  return Math.max(0, selfRH - effectiveNeighborRH(selfRH, neighborRH));
}
