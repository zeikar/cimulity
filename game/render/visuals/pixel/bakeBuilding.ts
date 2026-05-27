/**
 * Pixi 8 render-glue: bake a per-building facade RenderTexture from a
 * composed placement plan.
 *
 * Each face's rectilinear strip of atlas Sprites is iso-projected into screen
 * space inside the RT by an explicit per-face affine matrix derived from the
 * polygon's actual face quad corners (see plan §2.4 corner pairing). The bake
 * uses two distinct offsets (plan §8):
 *   - `internalBakeTranslation` — added to each face affine's (tx, ty) so the
 *     padded AABB lands inside [0..W) × [0..H) of the RT. Not exposed.
 *   - `spriteOffset` — returned for the caller to position the wrapper-local
 *     Sprite at the correct anchor-local coordinates.
 *
 * NOT gated. Verified by gameplay/manual testing.
 */

import type { Renderer, Texture } from 'pixi.js';
import { Container, Matrix, RenderTexture, Sprite } from 'pixi.js';

import type { FacadeAtlas } from './facadeAtlas';
import type { FacadeFaceSize, FacadePlacement } from './facadeComposer';

export type BakedBuildingTexture = {
  texture: Texture;
  spriteOffset: { x: number; y: number };
};

type Point = { x: number; y: number };

export function bakeBuildingFacade(args: {
  renderer: Renderer;
  atlas: FacadeAtlas;
  placements: ReadonlyArray<FacadePlacement>;
  faceSizes: { top: FacadeFaceSize; left: FacadeFaceSize; right: FacadeFaceSize };
  targets: {
    top: ReadonlyArray<Point>;
    left: ReadonlyArray<Point>;
    right: ReadonlyArray<Point>;
  };
}): BakedBuildingTexture {
  const { renderer, atlas, placements, faceSizes, targets } = args;
  const pad = 2;

  // Union AABB across all 12 target face vertices in anchor-local coords.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const face of [targets.top, targets.left, targets.right]) {
    for (const p of face) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const internalBakeTranslation = { x: -minX + pad, y: -minY + pad };
  const spriteOffset = { x: minX - pad, y: minY - pad };

  const rtWidth = Math.ceil(maxX - minX + 2 * pad);
  const rtHeight = Math.ceil(maxY - minY + 2 * pad);
  const rt = RenderTexture.create({ width: rtWidth, height: rtHeight });
  rt.source.scaleMode = 'nearest';

  const parent = new Container();

  const faceNames = ['top', 'left', 'right'] as const;
  for (const faceName of faceNames) {
    const faceSize = faceSizes[faceName];
    const face = new Container();

    for (const p of placements) {
      if (p.face !== faceName) continue;
      const tex = atlas.textures.get(p.moduleId);
      if (!tex) continue;
      const s = new Sprite(tex);
      s.x = Math.round(p.x);
      s.y = Math.round(p.y);
      face.addChild(s);
    }

    // Corner pairing per plan §2.4. cubeFacePolygons returns:
    //   top:   [N, E, S, W]   (diamond — NOT rect-aligned)
    //   left:  [S, W, W+lift, S+lift]
    //   right: [E, S, S+lift, E+lift]
    // We solve a rect-to-quad affine with src S0=(0,0), S1=(W,0), S2=(0,H).
    let t0: Point;
    let t1: Point;
    let t2: Point;

    if (faceName === 'top') {
      // (0,0)→W, (W_top,0)→N, (0,H_top)→S. 4th corner (W_top,H_top)→E by affine linearity.
      t0 = targets.top[3]; // W
      t1 = targets.top[0]; // N
      t2 = targets.top[2]; // S
    } else if (faceName === 'left') {
      // (0,0)→W, (W_left,0)→S, (0,H_left)→W+lift.
      t0 = targets.left[1]; // W
      t1 = targets.left[0]; // S
      t2 = targets.left[2]; // W+lift
    } else {
      // right: (0,0)→S, (W_right,0)→E, (0,H_right)→S+lift.
      t0 = targets.right[1]; // S
      t1 = targets.right[0]; // E
      t2 = targets.right[2]; // S+lift
    }

    const W = faceSize.w;
    const H = faceSize.h;

    const a = (t1.x - t0.x) / W;
    const b = (t1.y - t0.y) / W;
    const c = (t2.x - t0.x) / H;
    const d = (t2.y - t0.y) / H;
    const tx = t0.x + internalBakeTranslation.x;
    const ty = t0.y + internalBakeTranslation.y;

    face.setFromMatrix(new Matrix(a, b, c, d, tx, ty));
    parent.addChild(face);
  }

  renderer.render({ container: parent, target: rt, clear: true });

  // Cascades through face containers and their Sprite children. Sprite.destroy
  // without options does NOT destroy the atlas Textures.
  parent.destroy({ children: true });

  return { texture: rt, spriteOffset };
}
