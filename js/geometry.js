// Cube geometry shared by all modules.
// Coordinates in cm. The cube interior spans -H..H on every axis.
//   +x = right, +y = up (lid), +z = front.

export const H = 10;                // half the cube size (cm)
export const S = 2 * H;             // mirror size (cm)
export const MAX_BOUNCES = 8;
export const MAX_PER_EDGE = 10;
export const MAX_LIGHTS = 128;      // >= 12 * MAX_PER_EDGE + 6

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const absP = (p) => p.map(Math.abs);
export const faceDist = (p) => Math.max(...absP(p));
/** A corner LED: all three coordinates near the walls. */
export const isCorner = (p) => Math.min(...absP(p)) > 0.85 * faceDist(p);

/** The face an LED sits on (axis with the largest coordinate) + its 2D position on that face. */
export function onFace(p) {
  const a = absP(p);
  const axis = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
  const sign = Math.sign(p[axis]);
  const u = p[(axis + 1) % 3], v = p[(axis + 2) % 3];
  return { axis, sign, u, v, r: Math.hypot(u, v) / (Math.SQRT2 * faceDist(p)) };
}

/**
 * The peephole sits in the lid or in the front face. The renderer always works in a
 * "view frame" in which the peephole face is +z.
 * Lid: world (x, y, z) -> view (x, -z, y), so you look down with the front wall at the bottom.
 */
export class ViewFrame {
  constructor(holeFace, hole) {
    this.holeFace = holeFace;      // 'lid' | 'front'
    this.hole = hole;              // [u, v] of the peephole on its face (view frame x, y)
  }

  get inLid() { return this.holeFace === 'lid'; }

  toView(p) { return this.inLid ? [p[0], -p[2], p[1]] : p; }

  fromView(p) { return this.inLid ? [p[0], p[2], -p[1]] : p; }

  /** Peephole centre in world coordinates. */
  get holeWorld() { return this.fromView([this.hole[0], this.hole[1], H]); }
}

/** One LED: position, whether it is switched on, its base colour and its live colour. */
export class Light {
  constructor(p, { on = true, strip = false } = {}) {
    this.p = p;
    this.v = p;                    // position in the view frame (set by the effects)
    this.on = on;
    this.strip = strip;
    this.i = 0;                    // index in the layout (strip order)
    this.base = [1, 1, 1];         // colour from the "Basiskleur" setting
    this.c = this.base;            // colour * intensity actually sent to the LED
  }
}
