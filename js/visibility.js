// Visibility score: how many separate light points you see through the peephole.

export class VisibilityAnalyzer {
  static FOV_DEG = 100;
  static CELL = 0.03;          // grid cell for the neighbour search (rad)
  static PIXEL = 0.004;        // about one pixel (rad)

  /**
   * All mirror images of all LEDs up to the chosen number of reflections, seen from the eye at
   * the peephole. Image in mirror cell (i,j,k): x' = 20 i + (-1)^i x (same for y, z) and it
   * takes |i|+|j|+|k| reflections. An image counts as overlapping when a nearer image sits
   * within the sum of both apparent radii (x 1.5 for glow) plus about a pixel.
   */
  static analyse(s, lights) {
    const ims = VisibilityAnalyzer.#images(s, lights);
    ims.sort((p, q) => p.D - q.D);
    const { CELL, PIXEL } = VisibilityAnalyzer;
    const grid = new Map();
    let overlapped = 0;
    for (const m of ims) {
      const gx = Math.floor(m.x / CELL), gy = Math.floor(m.y / CELL);
      let hit = false;
      for (let ox = -1; ox <= 1 && !hit; ox++) for (let oy = -1; oy <= 1 && !hit; oy++) {
        for (const o of grid.get(`${gx + ox},${gy + oy}`) || []) {
          const ang = Math.acos(Math.min(1, m.x * o.x + m.y * o.y + m.z * o.z));
          if (ang < 1.5 * (s.ledR / m.D + s.ledR / o.D) + PIXEL) { hit = true; break; }
        }
      }
      if (hit) overlapped++;
      const key = `${gx},${gy}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(m);
    }
    return { images: ims.length, overlapped, distinct: ims.length - overlapped };
  }

  // Directions (unit vectors) and distances of all images inside the field of view.
  static #images(s, lights) {
    const eye = [s.hole[0], s.hole[1], 10];          // view frame: peephole face is +z
    const B = s.bounces;
    const cosMax = Math.cos((VisibilityAnalyzer.FOV_DEG / 2) * Math.PI / 180);
    const ims = [];
    lights.forEach((l) => {
      if (!l.on) return;
      const c = s.frame.toView(l.p);
      for (let i = -B; i <= B; i++) for (let j = -B; j <= B; j++) for (let k = -B; k <= 0; k++) {
        if (Math.abs(i) + Math.abs(j) + Math.abs(k) > B) continue;
        const dx = 20 * i + (i & 1 ? -c[0] : c[0]) - eye[0];
        const dy = 20 * j + (j & 1 ? -c[1] : c[1]) - eye[1];
        const dz = 20 * k + (k & 1 ? -c[2] : c[2]) - eye[2];
        const D = Math.hypot(dx, dy, dz);
        if (-dz / D < cosMax) continue;
        ims.push({ x: dx / D, y: dy / D, z: dz / D, D });
      }
    });
    return ims;
  }
}
