/**
 * World-space lighting primitives for terrain shading.
 *
 * Axes convention: +x east, +y south, +z up.
 * All vectors are immutable readonly tuples.
 * Pure math — zero Pixi dependencies.
 */

export type Vec3 = readonly [number, number, number];

// ---------------------------------------------------------------------------
// Vector math
// ---------------------------------------------------------------------------

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Normalize v to unit length. Returns [0, 0, 1] for zero-length input
 * (lenient fallback for degenerate runtime normals, e.g. a colinear triangle).
 */
export function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Strict normalizer used only for module-level constants. Throws if v is the
 * zero vector so that a future contributor accidentally passing [0,0,0] fails
 * loudly rather than silently becoming a fake flat-up light.
 */
function normalizeStrict(v: Vec3, label: string): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0) throw new Error(`${label} cannot be the zero vector`);
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ---------------------------------------------------------------------------
// Normal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the unit normal of a triangle defined by three world-space points,
 * ALWAYS pointing in the +z half-space (the z-flip handles either winding
 * order).
 *
 * Scope: terrain TOP triangles whose surface normal is known to face up.
 * NOT suitable for vertical cube side faces (whose true normal has z = 0 —
 * this helper would arbitrarily orient them); cubes need their own
 * face-normal helper if/when they migrate to this lighting model.
 */
export function upwardTriangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const result = normalize(cross(sub(b, a), sub(c, a)));
  // normalize returns [0,0,1] for zero-length cross (degenerate triangle) —
  // that already satisfies z >= 0, so only negate when z is strictly negative.
  if (result[2] < 0) return [-result[0], -result[1], -result[2]];
  return result;
}

// ---------------------------------------------------------------------------
// Lighting constants
// ---------------------------------------------------------------------------

/**
 * World-space direction FROM the surface TOWARD the light source (NW and
 * above). Terrain shading derives from this vector via faceBrightness().
 * Cube face brightness and cubeDropShadow offsets are tracked as follow-up
 * PRs that will also key off this constant; those migrations require
 * additional work (cube face normals + density-tint composition;
 * world-light-to-screen projection for the shadow offset) — not a drop-in
 * call-site swap.
 */
export const LIGHT_DIR_WORLD: Vec3 = normalizeStrict([-1, -1, 1.5], 'LIGHT_DIR_WORLD');

export const LIGHTING_Z_SCALE = 1.0;

export const AMBIENT = 0.55;

export const DIFFUSE = 0.45;

// FLAT_DOT: dot of straight-up normal with the light direction.
// Math.max(0, ...) is load-bearing — a horizontal/downward light produces
// dot <= 0, which the assertion below turns into a thrown error.
const FLAT_DOT = Math.max(0, dot([0, 0, 1], LIGHT_DIR_WORLD));

// Module-load guard: catches a horizontal or downward light configuration.
// Combined with normalizeStrict, both zero-vector AND horizontal-vector edge
// cases throw at import time.
if (FLAT_DOT <= 0) {
  throw new Error(
    'LIGHT_DIR_WORLD must have a positive z component (light from above) so flat terrain is lit.',
  );
}

// ---------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------

/**
 * Computes brightness in [0, 1] for a surface with the given world-space
 * unit normal using a normalized Lambert model.
 *
 * Diffuse term is normalized by the flat-up dot product (FLAT_DOT) so flat
 * terrain (normal=(0,0,1)) maps to brightness 1.0 exactly — preserves
 * today's flat-tile color. Slopes facing away from the light clamp at
 * AMBIENT; slopes that out-align the up direction clamp at 1.0 (flat is the
 * 'fully lit' ceiling).
 */
export function faceBrightness(normal: Vec3): number {
  const n = normalize(normal);
  const lambert = Math.max(0, dot(n, LIGHT_DIR_WORLD)) / FLAT_DOT;
  const raw = AMBIENT + DIFFUSE * lambert;
  return Math.min(1, raw);
}
