// Shared pure constants for growth + merge policy; kept dep-free so mergePolicy.ts can import without circling through World.ts.

export const GROWTH_COOLDOWN_INTERVALS = 8;

export function stagger(id: number): number {
  return ((id ^ (id >>> 16)) * 2654435761 >>> 0) % 7;
}
