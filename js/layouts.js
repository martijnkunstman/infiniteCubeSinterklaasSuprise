// LED layouts. Each layout builds the list of LEDs (also switched-off ones, for the overview)
// in strip order, and describes itself for the settings panel.

import { H, MAX_PER_EDGE, Light } from './geometry.js';
import { SPREAD_SETS_FRONT, SPREAD_SETS_LID } from './data/spread-sets.js';

/** Positions (cm, along an edge from -H to +H) like CSS flex justify-content. */
export function spacingPositions(n, mode, inset) {
  const L = 2 * H;
  const out = [];
  for (let i = 0; i < n; i++) {
    let t;
    if (mode === 'between') {
      const s = H - inset;                       // first/last LED tucked into the corner
      t = n === 1 ? 0 : -s + (2 * s * i) / (n - 1);
    } else if (mode === 'evenly') {
      t = -H + (L * (i + 1)) / (n + 1);
    } else {                                     // around
      t = -H + (L * (i + 0.5)) / n;
    }
    out.push(Math.max(-(H - inset), Math.min(H - inset, t)));
  }
  return out;
}

/** Base class: `build(s, d)` returns Lights; d = distance of the LED centres from the cube centre. */
export class Layout {
  constructor(key) { this.key = key; }

  /** @returns {Light[]} */
  build(/* s, d */) { throw new Error('not implemented'); }

  describe(/* s */) { return ''; }
}

// ---------------------------------------------------------------------------------------------
/**
 * "Maximale spreiding": a strip path found by an optimiser (simulated annealing) that minimises
 * how many mirror images overlap when seen from the peephole.
 */
export class SpreadLayout extends Layout {
  constructor() { super('spread'); }

  build(s, d) {
    const sets = s.frame.inLid ? SPREAD_SETS_LID : SPREAD_SETS_FRONT;
    return (sets[s.spreadCount] || sets[50]).map(([a, sg, x, y, z]) => {
      const p = [x, y, z];
      p[a] = sg * d;                                   // LED centre sits `inset` off the mirror
      return new Light(p, { strip: true });
    });
  }

  describe(s) {
    return `Eén strip van ${s.spreadCount} LEDs over bodem en wanden`
      + (s.frame.inLid ? ', beginnend in het midden van een vlak (LED 1)' : '')
      + ', bewust onregelmatig: de posities zijn door een '
      + 'optimalisatie zo gekozen dat de spiegelbeelden elkaar zo min mogelijk bedekken of op één lijn vallen. '
      + 'Elke wand heeft een eigen patroon. Afstand tussen LEDs 6,5–10 cm langs de spiegel; deksel en kijkgat blijven vrij.';
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * 10 cm grid: every LED sits half a step (5 cm) from each mirror edge and a full step (10 cm)
 * from its neighbours, so the mirror images continue the grid seamlessly. One continuous strip:
 * floor 2 x 2 square -> up the front wall -> bottom ring (y = -5) -> up -> top ring (y = +5).
 */
export class GridLayout extends Layout {
  static RING = [               // 8 wall columns, each 10 cm from the next along the walls
    ['z', -5], ['z', 5],        // front wall (z = +H), x = -5 and +5
    ['x', 5], ['x', -5],        // right wall (x = +H), z = +5 and -5
    ['-z', 5], ['-z', -5],      // back wall (z = -H), x = +5 and -5
    ['-x', -5], ['-x', 5],      // left wall (x = -H), z = -5 and +5
  ];

  static FLOOR = [[-5, -5], [5, -5], [5, 5], [-5, 5]];   // (x, z), ends next to the front wall

  constructor() { super('grid'); }

  build(s, d) {
    const wallPoint = ([wall, t], y) => {
      if (wall === 'z') return [t, y, d];
      if (wall === '-z') return [t, y, -d];
      if (wall === 'x') return [d, y, t];
      return [-d, y, t];
    };
    const lights = [];
    const add = (p) => lights.push(new Light(p, { strip: true }));
    GridLayout.FLOOR.forEach(([x, z]) => add([x, -d, z]));
    GridLayout.RING.forEach((c) => add(wallPoint(c, -5)));
    // step up at the last column, then the top ring in the same direction
    [7, 0, 1, 2, 3, 4, 5, 6].forEach((i) => add(wallPoint(GridLayout.RING[i], 5)));
    return lights;
  }

  describe() {
    return 'Eén strip van 20 LEDs, 10 cm uit elkaar: een vierkant van 4 op de bodem, dan twee ringen van 8 rond de wanden '
      + '(op 5 en 15 cm hoogte). Elke LED zit 5 cm van iedere spiegelrand, zodat de spiegelbeelden het raster naadloos '
      + 'voortzetten. Deksel vrij; de draad blijft 5 cm van het kijkgat.';
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * LED strip wound as a helix along the 4 side walls, from the floor up to just under the lid.
 * The strip lies flat on the mirrors and goes right into each corner, so the strip gap is
 * measured along the mirror surface (perimeter 8H). The winding phase is chosen so the strip
 * passes a front-face peephole halfway between two turns.
 */
export class HelixLayout extends Layout {
  constructor() { super('helix'); }

  /** Perimeter coordinate s: 0 = front wall at x = 0, increasing towards the right wall. */
  static perimeterPoint(s, d) {
    const P = 8 * d;
    s = ((s % P) + P) % P;
    if (s < d) return [s, d];                       // front, x: 0 -> d
    if (s < 3 * d) return [d, d - (s - d)];         // right, z: d -> -d
    if (s < 5 * d) return [d - (s - 3 * d), -d];    // back, x: d -> -d
    if (s < 7 * d) return [-d, -d + (s - 5 * d)];   // left, z: -d -> d
    return [-d + (s - 7 * d), d];                   // front, x: -d -> 0
  }

  info(s, d) {
    const n = s.stripCount, gap = s.stripGap;
    const P = 8 * H;                                 // one turn around the walls, on the mirror
    const yb = -d, yt = d - s.lidGap;                // floor corner up to under the lid
    const len = (n - 1) * gap;                       // strip length between first and last LED
    const rise = len > 0 ? (yt - yb) / len : 0;      // height gained per cm of strip
    const pitch = rise * P;                          // height between two turns
    return { n, gap, P, yb, yt, len, rise, pitch, turns: len / P };
  }

  build(s, d) {
    const h = this.info(s, d);
    // phase: at the peephole the strip should be half a turn-height away from the hole
    const sHole = ((s.hole[0] % h.P) + h.P) % h.P;
    const want = s.hole[1] + h.pitch / 2 - h.yb;
    const s0 = h.rise > 0 ? sHole - want / h.rise : 0;
    const clampD = (v) => Math.max(-d, Math.min(d, v));
    const lights = [];
    for (let k = 0; k < h.n; k++) {
      // point on the mirror surface; the LED centre sits `inset` in front of it
      // (an LED right in a corner is kept clear of the neighbouring wall too)
      const [x, z] = HelixLayout.perimeterPoint(s0 + k * h.gap, H);
      lights.push(new Light([clampD(x), h.yb + k * h.gap * h.rise, clampD(z)], { strip: true }));
    }
    return lights;
  }

  describe(s) {
    const h = this.info(s, H - s.inset);
    return 'De strip loopt als spiraal langs voor, rechts, achter en links, van de bodem tot net onder het deksel. '
      + `${h.turns.toFixed(1)} rondes, ${(h.pitch * 10).toFixed(0)} mm tussen de rondes, `
      + `${(h.len / 100).toFixed(2)} m strip. Bij het kijkgat loopt de strip precies tussen twee rondes door.`;
  }
}

// ---------------------------------------------------------------------------------------------
/**
 * Fixed layout: the three faces that meet in the back-left-bottom corner get a light in every
 * corner and one in the middle (like a dice "5"); the other three faces (front, right, top)
 * get 4 lights in a 2 x 2 grid, spaced around (like a dice "4").
 */
export class FixedLayout extends Layout {
  static FIVE = [{ axis: 2, sign: -1 }, { axis: 0, sign: -1 }, { axis: 1, sign: -1 }];
  static FOUR = [{ axis: 2, sign: 1 }, { axis: 0, sign: 1 }, { axis: 1, sign: 1 }];

  constructor() { super('fixed'); }

  build(s, d) {
    const lights = [];
    const onFiveFace = (c) => FixedLayout.FIVE.some((f) => c[f.axis] === f.sign);
    // corners of the "5" faces = every cube corner except front-right-top
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      if (onFiveFace([x, y, z])) lights.push(new Light([x * d, y * d, z * d]));
    }
    FixedLayout.FIVE.forEach((f) => {
      const p = [0, 0, 0];
      p[f.axis] = f.sign * d;
      lights.push(new Light(p));
    });
    const grid = spacingPositions(2, 'around', 0);   // -5 and +5 cm
    FixedLayout.FOUR.forEach((f) => {
      const [a, b] = [0, 1, 2].filter((k) => k !== f.axis);
      grid.forEach((u) => grid.forEach((v) => {
        const p = [0, 0, 0];
        p[f.axis] = f.sign * d; p[a] = u; p[b] = v;
        lights.push(new Light(p));
      }));
    });
    return lights;
  }

  describe() {
    return 'Achter, links en onder: een lampje in elke hoek en één in het midden (7 hoeken + 3 midden). '
      + 'Voor, rechts en boven: 4 lampjes per vlak in een 2 × 2 raster, space-around (12). Totaal 22.';
  }
}

// ---------------------------------------------------------------------------------------------
/** Free layout: n LEDs per edge (each edge can be switched off) + optional face centres. */
export class FreeLayout extends Layout {
  constructor() {
    super('free');
    this.edges = FreeLayout.#buildEdges();
    this.faces = [
      // off by default: with a centred peephole this LED sits right in front of your eye
      { axis: 2, sign: 1, name: 'voor (kijkgat)', on: false },
      { axis: 2, sign: -1, name: 'achter', on: true },
      { axis: 0, sign: -1, name: 'links', on: true },
      { axis: 0, sign: 1, name: 'rechts', on: true },
      { axis: 1, sign: 1, name: 'boven (deksel)', on: true },
      { axis: 1, sign: -1, name: 'onder', on: true },
    ];
  }

  static EDGE_GROUPS = ['Deksel (boven)', 'Staande ribben', 'Bodem (onder)'];

  // Each edge runs along one axis; the other two axes are at +-H.
  static #buildEdges() {
    const words = { x: ['links', 'rechts'], y: ['onder', 'boven'], z: ['achter', 'voor'] };
    const axes = ['x', 'y', 'z'];
    const edges = [];
    for (let along = 0; along < 3; along++) {
      const [a, b] = axes.filter((_, i) => i !== along);
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          const dir = { x: 0, y: 0, z: 0 };
          dir[a] = sa; dir[b] = sb;
          const parts = [];
          if (dir.y) parts.push(words.y[dir.y > 0 ? 1 : 0]);
          if (dir.z) parts.push(words.z[dir.z > 0 ? 1 : 0]);
          if (dir.x) parts.push(words.x[dir.x > 0 ? 1 : 0]);
          const group = dir.y > 0 ? 'Deksel (boven)' : dir.y < 0 ? 'Bodem (onder)' : 'Staande ribben';
          edges.push({ dir, name: parts.join('-'), group, on: true });
        }
      }
    }
    return edges;
  }

  build(s, d) {
    const lights = [];
    const ts = spacingPositions(Math.min(MAX_PER_EDGE, s.perEdge), s.spacing, s.inset);
    this.edges.forEach((e) => {
      const along = ['x', 'y', 'z'].findIndex((k) => e.dir[k] === 0);
      ts.forEach((t) => {
        const p = [e.dir.x * d, e.dir.y * d, e.dir.z * d];
        p[along] = t;
        lights.push(new Light(p, { on: e.on }));
      });
    });
    if (s.faces) {
      this.faces.forEach((f) => {
        const p = [0, 0, 0];
        p[f.axis] = f.sign * d;
        lights.push(new Light(p, { on: f.on }));
      });
    }
    return lights;
  }

  describe() {
    return 'Stel zelf het aantal lampjes per ribbe, de verdeling en de lampjes in het midden van de vlakken in.';
  }
}

// ---------------------------------------------------------------------------------------------
/** All layouts by key; builds the lights for the current settings and gives them colours. */
export class LayoutRegistry {
  constructor() {
    this.free = new FreeLayout();
    this.layouts = new Map([new SpreadLayout(), new GridLayout(), new HelixLayout(), new FixedLayout(), this.free]
      .map((l) => [l.key, l]));
  }

  get(key) { return this.layouts.get(key) || this.free; }

  /** Lights for settings `s`, with index and base colour from the palette. */
  buildLights(s) {
    const lights = this.get(s.layout).build(s, H - s.inset);
    lights.forEach((l, i) => {
      l.i = i;
      l.base = s.palette.colorOf(i, lights.length);
      l.c = l.base;
    });
    return lights;
  }

  describe(s) { return this.get(s.layout).describe(s); }
}
