import { createRng } from "./prng";
import { fbm2d } from "./valueNoise";
import { shapeHeightmap } from "./heightShaping";
import { buildWaterMask } from "./waterMask";
import { MAX_ELEVATION } from "./Terrain";

export const DEFAULT_NEWCITY_SEED = 0xc15a1e11;

export function generateTerrain(
  width: number,
  height: number,
  seed?: number,
): { elevations: number[][]; waterMask: boolean[][] } {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError(
      `generateTerrain: width and height must be positive integers, got width=${width} height=${height}`,
    );
  }
  const effectiveSeed = seed ?? DEFAULT_NEWCITY_SEED;
  const rng = createRng(effectiveSeed);
  const noise = fbm2d(width, height, rng);
  // Both paths consume the same unshaped noise field independently.
  const elevations = shapeHeightmap(noise, MAX_ELEVATION);
  const waterMask = buildWaterMask(noise);
  return { elevations, waterMask };
}
