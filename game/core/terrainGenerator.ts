/**
 * Terrain generator.
 *
 * After computing raw elevations and the water mask, a post-process clamp
 * enforces the invariant used by the rest of the engine:
 *   - Water cells (waterMask === true)  → elevation clamped to SEA_LEVEL.
 *   - Non-water cells with elev <= SEA_LEVEL → clamped to MIN_LAND_ELEVATION.
 *
 * Lowland (former 0/1 of the unshaped range) merges into a single elevation
 * MIN_LAND_ELEVATION. This is the accepted simplification — see plan.
 */
import { createRng } from "./prng";
import { fbm2d } from "./valueNoise";
import { shapeHeightmap } from "./heightShaping";
import { buildWaterMask } from "./waterMask";
import { MAX_ELEVATION, SEA_LEVEL, MIN_LAND_ELEVATION } from "./Terrain";

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

  // Post-process: enforce elevation invariant.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (waterMask[y][x]) {
        elevations[y][x] = SEA_LEVEL;
      } else if (elevations[y][x] <= SEA_LEVEL) {
        elevations[y][x] = MIN_LAND_ELEVATION;
      }
    }
  }

  return { elevations, waterMask };
}
