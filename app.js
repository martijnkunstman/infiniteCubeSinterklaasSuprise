// Infinity Cube Viewer
// Ray tracer (WebGL fragment shader) for a 20 cm mirror cube seen through a peephole.
// Coordinates in cm. Cube interior spans -10..10 on every axis.
//   +x = right, +y = up (lid), +z = front.
// The peephole sits in the lid (default) or in the front face. The shader always works in a
// "view frame" in which the peephole face is +z; toView/fromView rotate between the two.

(() => {
  'use strict';

  const H = 10;               // half the cube size (cm)
  const MAX_BOUNCES = 8;

  // lid: world (x, y, z) -> view (x, -z, y), so you look down with the front wall at the bottom
  const holeInLid = (s) => (s ? s.holeFace : $('holeFace').value) === 'lid';
  const toView = (p, s) => (holeInLid(s) ? [p[0], -p[2], p[1]] : p);
  const fromView = (p, s) => (holeInLid(s) ? [p[0], p[2], -p[1]] : p);
  const holeWorld = (s) => fromView([s.hole[0], s.hole[1], H], s);

  // ---------- Edges / lights ----------
  // Each edge runs along one axis; the other two axes are at +-H.
  const EDGES = [];
  (function buildEdges() {
    const words = {
      x: ['links', 'rechts'],
      y: ['onder', 'boven'],
      z: ['achter', 'voor'],
    };
    const axes = ['x', 'y', 'z'];
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
          EDGES.push({ dir, name: parts.join('-'), group, on: true });
        }
      }
    }
  })();

  // Face centres: normal axis + sign
  const FACES = [
    // off by default: with a centred peephole this LED sits right in front of your eye
    { axis: 2, sign: 1, name: 'voor (kijkgat)', on: false },
    { axis: 2, sign: -1, name: 'achter', on: true },
    { axis: 0, sign: -1, name: 'links', on: true },
    { axis: 0, sign: 1, name: 'rechts', on: true },
    { axis: 1, sign: 1, name: 'boven (deksel)', on: true },
    { axis: 1, sign: -1, name: 'onder', on: true },
  ];

  const MAX_PER_EDGE = 10;
  const MAX_LIGHTS = 128;     // >= 12 * MAX_PER_EDGE + 6

  // Positions (cm, along the edge from -H to +H) like CSS flex justify-content.
  function spacingPositions(n, mode, inset) {
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

  // All LEDs (also switched-off ones, for the overview) with stable colour indices.
  // Fixed layout: the three faces that meet in the back-left-bottom corner get a light in
  // every corner and one in the middle (like a dice "5"); the other three faces (front,
  // right, top) get 4 lights in a 2 x 2 grid, spaced around (like a dice "4").
  const FIVE_FACES = [{ axis: 2, sign: -1 }, { axis: 0, sign: -1 }, { axis: 1, sign: -1 }];
  const FOUR_FACES = [{ axis: 2, sign: 1 }, { axis: 0, sign: 1 }, { axis: 1, sign: 1 }];

  function buildFixedLights(d) {
    const lights = [];
    const onFiveFace = (c) => FIVE_FACES.some((f) => c[f.axis] === f.sign);
    // corners of the "5" faces = every cube corner except front-right-top
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      if (onFiveFace([x, y, z])) lights.push({ p: [x * d, y * d, z * d], on: true });
    }
    FIVE_FACES.forEach((f) => {
      const p = [0, 0, 0];
      p[f.axis] = f.sign * d;
      lights.push({ p, on: true });
    });
    const grid = spacingPositions(2, 'around', 0);   // -5 and +5 cm
    FOUR_FACES.forEach((f) => {
      const [a, b] = [0, 1, 2].filter((k) => k !== f.axis);
      grid.forEach((u) => grid.forEach((v) => {
        const p = [0, 0, 0];
        p[f.axis] = f.sign * d; p[a] = u; p[b] = v;
        lights.push({ p, on: true });
      }));
    });
    return lights;
  }

  // LED strip wound as a helix along the 4 side walls, from the floor up to just under the
  // lid. The strip runs flat on the mirrors, so neighbouring LEDs are exactly one strip gap
  // apart (measured along the wall). The strip never touches the lid. The winding phase is
  // chosen so the strip passes the peephole halfway between two turns, keeping the hole clear.
  // Perimeter coordinate s: 0 = front wall at x = 0, increasing towards the right wall.
  function perimeterPoint(s, d) {
    const P = 8 * d;
    s = ((s % P) + P) % P;
    if (s < d) return [s, d];                       // front, x: 0 -> d
    if (s < 3 * d) return [d, d - (s - d)];         // right, z: d -> -d
    if (s < 5 * d) return [d - (s - 3 * d), -d];    // back, x: d -> -d
    if (s < 7 * d) return [-d, -d + (s - 5 * d)];   // left, z: -d -> d
    return [-d + (s - 7 * d), d];                   // front, x: -d -> 0
  }

  // The strip lies flat on the mirrors and goes right into each corner, so the strip gap is
  // measured along the mirror surface (perimeter 8H), not along the LED centres.
  function helixInfo(s, d) {
    const n = s.stripCount, gap = s.stripGap;
    const P = 8 * H;                                 // one turn around the walls, on the mirror
    const yb = -d, yt = d - s.lidGap;                // floor corner up to under the lid
    const len = (n - 1) * gap;                       // strip length between first and last LED
    const rise = len > 0 ? (yt - yb) / len : 0;      // height gained per cm of strip
    const pitch = rise * P;                          // height between two turns
    return { n, gap, P, yb, yt, len, rise, pitch, turns: len / P };
  }

  function buildHelixLights(s, d) {
    const h = helixInfo(s, d);
    // phase: at the peephole the strip should be half a turn-height away from the hole
    const sHole = ((s.hole[0] % h.P) + h.P) % h.P;
    const want = s.hole[1] + h.pitch / 2 - h.yb;
    const s0 = h.rise > 0 ? sHole - want / h.rise : 0;
    const lights = [];
    const clampD = (v) => Math.max(-d, Math.min(d, v));
    for (let k = 0; k < h.n; k++) {
      // point on the mirror surface, then the LED centre sits `inset` in front of it
      // (an LED right in a corner is kept clear of the neighbouring wall too)
      const [x, z] = perimeterPoint(s0 + k * h.gap, H);
      lights.push({ p: [clampD(x), h.yb + k * h.gap * h.rise, clampD(z)], on: true, strip: true });
    }
    return lights;
  }

  // 10 cm grid: every LED sits half a step (5 cm) from each mirror edge and a full step
  // (10 cm) from its neighbours, so the mirror images continue the grid seamlessly.
  // One continuous strip with exactly 10 cm between LEDs along the mirror surface:
  //   floor 2 x 2 square -> up the front wall -> bottom ring (y = -5) -> up -> top ring (y = +5).
  // Positions are on the mirror surface (cm); the LED centre sits `inset` in front of it.
  const GRID_RING = [            // 8 wall columns, each 10 cm from the next along the walls
    ['z', -5], ['z', 5],         // front wall (z = +H), x = -5 and +5
    ['x', 5], ['x', -5],         // right wall (x = +H), z = +5 and -5
    ['-z', 5], ['-z', -5],       // back wall (z = -H), x = +5 and -5
    ['-x', -5], ['-x', 5],       // left wall (x = -H), z = -5 and +5
  ];
  const GRID_FLOOR = [[-5, -5], [5, -5], [5, 5], [-5, 5]];   // (x, z), ends next to the front wall

  function buildGridLights(d) {
    const lights = [];
    const wallPoint = ([wall, t], y) => {
      if (wall === 'z') return [t, y, d];
      if (wall === '-z') return [t, y, -d];
      if (wall === 'x') return [d, y, t];
      return [-d, y, t];
    };
    GRID_FLOOR.forEach(([x, z]) => lights.push({ p: [x, -d, z], on: true, strip: true }));
    GRID_RING.forEach((c) => lights.push({ p: wallPoint(c, -5), on: true, strip: true }));
    // step up at the last column, then the top ring in the same direction
    [7, 0, 1, 2, 3, 4, 5, 6].forEach((i) => lights.push({ p: wallPoint(GRID_RING[i], 5), on: true, strip: true }));
    return lights;
  }

  // "Maximale spreiding": a strip path found by an optimiser (simulated annealing) that
  // minimises how many mirror images overlap when seen from the peephole. Each entry is a
  // point on the mirror surface [normal axis, sign, x, y, z] in cm; neighbours are 6.5-10 cm
  // apart along the mirrors, lid and peephole are kept clear, the wire does not cross itself.
  const SPREAD_SETS_FRONT = {
    20: [[0,1,10,-8.1,4.7],[1,-1,3.9,-10,2.4],[1,-1,0,-10,-3.3],[1,-1,-2.3,-10,5.9],[1,-1,-8.4,-10,1.8],[0,-1,-10,-5.2,0.8],[0,-1,-10,-0.4,7.7],[2,1,-2.8,-2.6,10],[2,1,5.2,-1.3,10],[0,1,10,-2.9,5.1],[0,1,10,2.3,1.1],[0,1,10,3.8,-7.8],[2,-1,4,8.7,-10],[2,-1,-5.6,7.8,-10],[0,-1,-10,5,-6.1],[0,-1,-10,3.3,2.4],[0,-1,-10,8,8.3],[2,1,-2.2,8.7,10],[2,1,6.2,6.1,10],[0,1,10,8.3,6.5]],
    30: [[1,-1,-2.2,-10,7.5],[1,-1,-4.7,-10,-0.2],[1,-1,4.2,-10,-1.8],[0,1,10,-8.3,1],[1,-1,6.8,-10,-4.2],[1,-1,-0.3,-10,-1.2],[1,-1,-8.7,-10,-3.1],[0,-1,-10,-5.3,3.6],[1,-1,-8.2,-10,6.7],[1,-1,1,-10,8.5],[2,1,6.7,-3.8,10],[0,1,10,2.4,7.2],[0,1,10,0.7,-1.4],[0,1,10,-0.7,-8.1],[2,-1,3,-3.5,-10],[2,-1,-6.1,0.4,-10],[0,-1,-10,-4.3,-5.3],[0,-1,-10,-1.8,2.8],[2,1,-7.8,-1.4,10],[2,1,0.7,3,10],[2,1,8.2,8.3,10],[0,1,10,7.5,2.6],[0,1,10,6.9,-5.6],[2,-1,4.6,5.1,-10],[2,-1,-4.7,7,-10],[0,-1,-10,8.4,-6.4],[0,-1,-10,5,0.5],[0,-1,-10,5.3,7.9],[2,1,-3.5,8.1,10],[0,-1,-10,8.3,8.2]],
    40: [[1,-1,1,-10,2.3],[1,-1,-0.6,-10,-6],[1,-1,-3.6,-10,1.9],[1,-1,-7.9,-10,-6.4],[0,-1,-10,-5.2,0.1],[0,-1,-10,-6.1,6.8],[1,-1,-8.3,-10,1.1],[1,-1,-8.6,-10,8.1],[1,-1,0.6,-10,7.9],[1,-1,6.9,-10,3.2],[1,-1,8.6,-10,-4.8],[1,-1,2.4,-10,-8.1],[2,-1,-1.1,-5.8,-10],[2,-1,-8.8,-1.2,-10],[0,-1,-10,-2.6,-3],[0,-1,-10,-2.8,6.8],[2,1,-4.6,-4.9,10],[2,1,2.8,-2.5,10],[0,1,10,-4.3,7.4],[0,1,10,-1.2,0.5],[0,1,10,0.8,-6.4],[2,-1,3.9,-0.6,-10],[2,-1,-4.4,3.1,-10],[0,-1,-10,8.6,-7.5],[0,-1,-10,8.5,2.2],[0,-1,-10,6.7,8.5],[2,1,-2.3,7.2,10],[2,1,7.5,8.1,10],[0,1,10,5.1,3.2],[0,1,10,3.8,-5.1],[2,-1,5.7,6.9,-10],[2,-1,-0.4,4.1,-10],[2,-1,-8.7,4.2,-10],[0,-1,-10,0.5,-2.6],[0,-1,-10,2.2,5.3],[2,1,-6.6,2,10],[2,1,2.9,4.2,10],[0,1,10,-0.1,8.6],[0,1,10,8.1,4],[0,1,10,7.5,-5.9]],
    50: [[1,-1,-5,-10,-5],[1,-1,3.1,-10,0.7],[1,-1,-5.3,-10,3.3],[1,-1,-1,-10,-1.9],[1,-1,-8.7,-10,-7.4],[1,-1,-8.3,-10,2.2],[2,1,-8.8,-8.5,10],[1,-1,-2.4,-10,4.9],[1,-1,6.1,-10,7.9],[0,1,10,-6.9,2.7],[0,1,10,-4,-3.2],[2,-1,8.5,-5.1,-10],[2,-1,0.3,-6.9,-10],[2,-1,-8.7,-3.5,-10],[0,-1,-10,-5.7,-1.7],[0,-1,-10,-6.6,6.5],[2,1,-3.8,-8.5,10],[1,-1,1.6,-10,7.1],[0,1,10,-8.5,7.1],[1,-1,8.3,-10,0.5],[1,-1,3.9,-10,-7.1],[2,-1,3.1,-4.4,-10],[2,-1,-5.3,-1.2,-10],[0,-1,-10,0.2,-5.1],[0,-1,-10,-1.6,3.9],[2,1,-6.6,-0.2,10],[2,1,1.2,3.3,10],[2,1,8.6,-1,10],[0,1,10,-2.6,2.4],[0,1,10,1.6,-5.9],[2,-1,5.7,2.8,-10],[2,-1,-3.4,1.8,-10],[0,-1,-10,0,-8.8],[0,-1,-10,2.9,-0.7],[0,-1,-10,3.7,5.8],[2,1,-5.4,7.5,10],[2,1,2.4,6.8,10],[0,1,10,5.3,8.4],[0,1,10,0.3,1],[0,1,10,5,-6.7],[2,-1,3.8,5.9,-10],[2,-1,-5,4.3,-10],[0,-1,-10,3.4,-7.6],[0,-1,-10,8.7,0.5],[0,-1,-10,7.2,8.4],[2,1,-2.1,8.7,10],[2,1,6.8,8.5,10],[0,1,10,6.4,4.4],[0,1,10,8.2,-5],[2,-1,7.2,6.4,-10]],
  };

  // Peephole in the lid: the strip starts in the middle of a face (LED 1).
  const SPREAD_SETS_LID = {
    20: [[0,1,10,0,0],[0,1,10,-3.1,6.6],[0,1,10,-1.5,-3],[2,-1,8.8,-5.3,-10],[2,-1,-0.3,-3.6,-10],[2,-1,-6.1,0.3,-10],[2,-1,3,-2,-10],[0,1,10,2.1,-8.3],[0,1,10,7.8,-1.2],[0,1,10,0.1,3.8],[2,1,8.6,3.7,10],[2,1,4.1,-5.1,10],[2,1,-5.4,-6.8,10],[2,1,-7.7,2.2,10],[2,1,1.9,3.9,10],[2,1,-1.1,-5.5,10],[1,-1,-7.5,-10,7.6],[1,-1,-2.1,-10,1.9],[1,-1,-6.3,-10,-4.5],[0,-1,-10,-5.3,-1.8]],
    30: [[1,-1,0,-10,0],[1,-1,0.9,-10,-8.7],[1,-1,4.6,-10,-2.6],[1,-1,8.2,-10,6.4],[0,1,10,-4.2,6.5],[2,1,8.7,1.8,10],[2,1,2.6,6.1,10],[2,1,0.7,-3.4,10],[2,1,-7.2,-6.2,10],[2,1,-0.7,-6.3,10],[1,-1,-3.8,-10,4.8],[0,-1,-10,-8.4,-0.7],[0,-1,-10,-1.2,-7],[0,-1,-10,7.4,-5.7],[0,-1,-10,6.8,1.6],[0,-1,-10,3.3,8.8],[0,-1,-10,-6,6.9],[0,-1,-10,-2.7,0.4],[1,-1,-8.5,-10,-3.9],[2,-1,-8.7,-7.5,-10],[2,-1,-3.8,0,-10],[2,-1,5.2,2.9,-10],[2,-1,8.3,-3.6,-10],[0,1,10,5,-8.4],[0,1,10,4.9,-1.5],[0,1,10,8,7.8],[2,1,5.8,5.4,10],[0,1,10,5.7,4.4],[0,1,10,3.4,-4.6],[0,1,10,-0.9,2]],
    40: [[1,-1,0,-10,0],[1,-1,4,-10,-8.8],[1,-1,-3.5,-10,-6.1],[1,-1,-3.4,-10,3.4],[1,-1,5.6,-10,4.6],[2,1,8.7,-8.5,10],[0,1,10,-7.8,4.4],[0,1,10,-1,-1.1],[0,1,10,2.1,-7.3],[0,1,10,7.1,-2.3],[0,1,10,1.3,5.3],[2,1,8.1,2.9,10],[2,1,1.3,4.8,10],[2,1,-0.5,-3.3,10],[2,1,-4,3.5,10],[0,-1,-10,4.3,7.9],[0,-1,-10,-4.7,4.4],[0,-1,-10,0.7,-3.7],[2,-1,-7,0.1,-10],[2,-1,-0.5,1,-10],[2,-1,6.2,6.2,-10],[2,-1,-2.1,8.6,-10],[2,-1,-8.7,5.5,-10],[0,-1,-10,4.5,-1.6],[0,-1,-10,0.4,-6.9],[0,-1,-10,-5.5,0.2],[0,-1,-10,-7.1,7.7],[1,-1,-6.4,-10,6.7],[2,1,-4.8,-5.2,10],[2,1,4.5,-7.4,10],[1,-1,1.6,-10,4],[1,-1,8.8,-10,0.5],[0,1,10,-8.8,-8.8],[2,-1,8.8,-0.8,-10],[2,-1,2.2,2.4,-10],[2,-1,5.8,-3.1,-10],[2,-1,-2.5,-6.5,-10],[0,-1,-10,-5.8,-8.8],[2,-1,-3.7,0.7,-10],[2,-1,0.9,7.3,-10]],
    50: [[0,1,10,0,0],[0,1,10,2.2,8.4],[0,1,10,-7,7.1],[1,-1,7.7,-10,0.1],[1,-1,1.7,-10,3.3],[1,-1,3,-10,-5.8],[2,-1,-1.7,-6,-10],[2,-1,-5.9,2.4,-10],[2,-1,1.2,4.1,-10],[2,-1,8.1,-3,-10],[0,1,10,-8.7,-6.1],[0,1,10,0.5,-3.3],[0,1,10,7.5,1.4],[0,1,10,7.3,-5.1],[2,-1,5.8,7.8,-10],[2,-1,-1.9,7.7,-10],[0,-1,-10,7.2,-8.7],[0,-1,-10,3.5,-2],[0,-1,-10,-2.2,3.1],[0,-1,-10,-5.9,-3.5],[1,-1,-7.2,-10,2.2],[0,-1,-10,-8.8,8.5],[2,1,-3.5,-5.7,10],[2,1,-1.3,1.1,10],[2,1,-8.1,6.7,10],[2,1,0.3,7.8,10],[2,1,8.3,8.4,10],[2,1,6.6,0.8,10],[2,1,-0.2,-5.4,10],[1,-1,-4.8,-10,8.3],[2,1,-8.6,-4.8,10],[0,-1,-10,0,5.2],[2,1,-8.2,0.6,10],[0,-1,-10,5.6,5.9],[2,1,-4.9,4.4,10],[2,1,4.2,7.6,10],[2,1,3.2,-1.8,10],[2,1,6.5,4,10],[0,1,10,-1.8,5.6],[0,1,10,-5,-1.3],[1,-1,8.6,-10,3.5],[1,-1,1,-10,8.7],[1,-1,-4.3,-10,3.5],[1,-1,-5.9,-10,-5.8],[0,-1,-10,-5.1,-8.3],[0,-1,-10,-3.7,-0.3],[0,-1,-10,3.4,-7],[2,-1,-4.6,-0.8,-10],[0,-1,-10,0.6,-8.8],[2,-1,-6.3,6.1,-10]],
  };

  function buildSpreadLights(d, count, lid) {
    const sets = lid ? SPREAD_SETS_LID : SPREAD_SETS_FRONT;
    return (sets[count] || sets[50]).map(([a, sg, x, y, z]) => {
      const p = [x, y, z];
      p[a] = sg * d;                                   // LED centre sits `inset` off the mirror
      return { p, on: true, strip: true };
    });
  }

  function buildLights(s) {
    const d = H - s.inset;
    const lights = s.layout === 'spread' ? buildSpreadLights(d, s.spreadCount, holeInLid(s))
      : s.layout === 'grid' ? buildGridLights(d)
      : s.layout === 'helix' ? buildHelixLights(s, d)
      : s.layout === 'fixed' ? buildFixedLights(d) : buildFreeLights(s, d);
    lights.forEach((l, i) => {
      l.i = i;
      l.base = lightColor(i, lights.length);   // colour from the "Basiskleur" setting
      l.c = l.base;                            // colour * intensity actually sent to the LED
    });
    return lights;
  }

  function buildFreeLights(s, d) {
    const lights = [];
    const ts = spacingPositions(s.perEdge, s.spacing, s.inset);
    EDGES.forEach((e) => {
      const along = ['x', 'y', 'z'].findIndex((k) => e.dir[k] === 0);
      ts.forEach((t) => {
        const p = [e.dir.x * d, e.dir.y * d, e.dir.z * d];
        p[along] = t;
        lights.push({ p, on: e.on });
      });
    });
    if (s.faces) {
      FACES.forEach((f) => {
        const p = [0, 0, 0];
        p[f.axis] = f.sign * d;
        lights.push({ p, on: f.on });
      });
    }
    return lights;
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  const overview = $('overview');
  const octx = overview.getContext('2d');

  const ui = {};
  ['bounces', 'atten', 'bright', 'glow', 'led', 'inset', 'perEdge', 'holeX', 'holeY', 'holeD',
    'eye', 'fov', 'seam', 'amb', 'speed', 'frontDim', 'stripCount', 'stripGap', 'lidGap']
    .forEach((id) => { ui[id] = $(id); });

  const fmt = {
    bounces: (v) => `${v}`,
    atten: (v) => `${v}%`,
    bright: (v) => (+v).toFixed(1),
    glow: (v) => (+v).toFixed(2),
    led: (v) => `${(v * 10).toFixed(1)} mm`,
    inset: (v) => `${(+v).toFixed(1)} cm`,
    perEdge: (v) => `${v} (${v * 12} totaal)`,
    holeX: (v) => `${(+v).toFixed(1)} cm`,
    holeY: (v) => `${(+v).toFixed(1)} cm`,
    holeD: (v) => `${(v * 10).toFixed(0)} mm`,
    eye: (v) => `${(+v).toFixed(1)} cm`,
    fov: (v) => `${v}°`,
    seam: (v) => `${(v * 10).toFixed(1)} mm`,
    amb: (v) => (+v).toFixed(3),
    speed: (v) => (+v === 0 ? 'pauze' : `${(+v).toFixed(2)}×`),
    frontDim: (v) => `${v}%`,
    stripCount: (v) => `${v}`,
    stripGap: (v) => `${(+v).toFixed(1)} cm`,
    lidGap: (v) => `${(+v).toFixed(1)} cm`,
  };

  // ---------- Camera ----------
  let yaw = 0, pitch = 0;
  function camBasis() {
    const cp = Math.cos(pitch);
    const fwd = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
    let right = [-fwd[2], 0, fwd[0]];          // cross(fwd, up)
    const rl = Math.hypot(right[0], right[2]) || 1;
    right = [right[0] / rl, 0, right[2] / rl];
    const up = [                               // cross(right, fwd)
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];
    return { fwd, right, up };
  }

  // ---------- Colors ----------
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)];
  }
  function lightColor(i, total) {
    switch ($('colorMode').value) {
      case 'warm': return hexToRgb('#ffb066');
      case 'cool': return hexToRgb('#d6e6ff');
      case 'rainbow': return hslToRgb((i * 360) / total, 1, 0.55);
      case 'custom': return hexToRgb($('customColor').value);
      case 'sint':
      default: return i % 2 ? hexToRgb('#ffc23a') : hexToRgb('#ff2424');
    }
  }

  // ---------- Effects: every LED gets its own colour + intensity per frame ----------
  // Each effect maps (light, time, all lights) -> [r, g, b]; the length of the vector is the
  // intensity (0 = off, 1 = full). Most effects use the LED's 3D position so they work for
  // any number of LEDs per edge.
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const hue = (h, l = 0.55) => hslToRgb(((h % 360) + 360) % 360, 1, l);
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const RED = [1, 0.06, 0.05], GOLD = [1, 0.7, 0.12], WHITE = [1, 0.92, 0.8], ICE = [0.6, 0.8, 1];

  // --- helpers for motion effects ---
  // Running light: `pos` is the LED's place on a closed path of `n` steps, `head` the moving
  // head. The LED fades in just before the head arrives and leaves a fading tail, so the eye
  // sees smooth movement instead of blinking (phi phenomenon).
  function chase(pos, head, n, fadeIn = 0.6, tail = 1.1) {
    let a = (((head - pos) % n) + n) % n;
    if (a > n - fadeIn) a -= n;
    return a < 0 ? Math.pow(1 + a / fadeIn, 2) : Math.exp(-a * tail);
  }
  const absP = (p) => p.map(Math.abs);
  const faceDist = (p) => Math.max(...absP(p));
  // A corner LED: all three coordinates near the walls.
  const isCorner = (p) => Math.min(...absP(p)) > 0.85 * faceDist(p);
  // The face an LED sits on (axis with the largest coordinate) + its 2D position on that face.
  function onFace(p) {
    const a = absP(p);
    const axis = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    const sign = Math.sign(p[axis]);
    const u = p[(axis + 1) % 3], v = p[(axis + 2) % 3];
    return { axis, sign, u, v, r: Math.hypot(u, v) / (Math.SQRT2 * faceDist(p)) };
  }
  // Axis of the main diagonal (back-left-bottom -> front-right-top) and a basis around it.
  const DIAG_E1 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
  const DIAG_E2 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const DIM = 0.03;

  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const SHOW = ['helixComets', 'candyCane', 'risingRings', 'fill', 'twinkle'];
  const SHOW_T = 10, SHOW_FADE = 1.5;

  const EFFECTS = {
    showreel: {
      name: '★ Spiraal-show (wisselt elke 10 s)',
      desc: 'Speelt achter elkaar: kometen langs de spiraal → zuurstok → stijgende ringen → vullen en leeglopen → sterren. '
        + 'Elke overgang vloeit zacht over.',
      fn: (l, t, all) => {
        const i = Math.floor(t / SHOW_T);
        const local = t - i * SHOW_T;
        const at = (j) => SHOW[((j % SHOW.length) + SHOW.length) % SHOW.length];   // also safe for t < 0
        const cur = EFFECTS[at(i)].fn(l, t, all);
        if (local < SHOW_T - SHOW_FADE) return cur;
        const next = EFFECTS[at(i + 1)].fn(l, t, all);
        return mix(cur, next, smooth(SHOW_T - SHOW_FADE, SHOW_T, local));
      },
    },
    helixComets: {
      name: '☄ Kometen langs de strip',
      desc: 'Drie gekleurde kometen met een lange staart klimmen in stripvolgorde omhoog. '
        + 'Bij de spiraal-indeling draaien ze rond de wanden; in de spiegels klimmen er eindeloos veel spiralen.',
      fn: (l, t, all) => {
        const n = all.length;
        let c = mul(l.base, 0.015);
        for (let j = 0; j < 3; j++) {
          const k = chase(l.i, t * 7 + (j * n) / 3, n, 0.7, 0.4);
          c = c.map((v, m) => v + hue(j * 120 + t * 12)[m] * k);
        }
        return c.map((v) => Math.min(1, v));
      },
    },
    candyCane: {
      name: '⚕ Zuurstok (rood-witte draai)',
      desc: 'Schuine rood-witte banden draaien rond de kubus, zoals een zuurstok of de staf van de Sint. '
        + 'De zij-spiegels herhalen ze tot een eindeloze draaiende zuil.',
      fn: (l, t) => {
        const a = Math.atan2(l.p[2], l.p[0]);
        const f = Math.sin(2 * a + l.p[1] * 0.35 - t * 2.2);
        return mix(mul(WHITE, 0.75), RED, smooth(-0.35, 0.35, f));
      },
    },
    risingRings: {
      name: '◎ Stijgende ringen',
      desc: 'Een ring licht op en stijgt van de bodem naar het deksel, elke ring een nieuwe kleur. '
        + 'Via bodem- en dekselspiegel lijkt hij eindeloos door te stijgen.',
      fn: (l, t) => {
        const cycle = t * 0.45;
        const y = -12 + (cycle % 1) * 24;
        const k = Math.exp(-Math.pow((l.p[1] - y) / 1.8, 2));
        return mul(hue(Math.floor(cycle) * 65 + 10), 0.02 + k);
      },
    },
    fill: {
      name: '▮ Vullen en leeglopen',
      desc: 'De strip vult zich LED voor LED in regenboogkleuren van onder naar boven en loopt daarna weer leeg.',
      fn: (l, t, all) => {
        const n = all.length;
        const c = (t * 10) % (2 * n);
        const k = c < n ? Math.min(1, Math.max(0, c - l.i)) : 1 - Math.min(1, Math.max(0, c - n - l.i));
        return mul(hue((l.i * 300) / n), 0.02 + k);
      },
    },
    static: {
      name: 'Vast (basiskleur)',
      desc: 'Alle LEDs branden constant in de basiskleur.',
      fn: (l) => l.base,
    },
    hexRing: {
      name: '↻ Zeshoek-ring (looplicht om de diagonaal)',
      desc: 'Een looplicht met staart rondt de 6 hoeklampjes die als gesloten ring langs de ribben liggen. '
        + 'De beweging draait om de diagonaal van de kubus; de spiegels maken er een groot draaiend patroon van.',
      fn: (l, t) => {
        const p = l.p;
        const sameSign = Math.sign(p[0]) === Math.sign(p[1]) && Math.sign(p[1]) === Math.sign(p[2]);
        if (!isCorner(p) || sameSign) return mul(l.base, DIM);
        const ang = Math.atan2(dot(p, DIAG_E2), dot(p, DIAG_E1));        // 6 corners = 60° apart
        const pos = ((ang / (Math.PI / 3)) % 6 + 6) % 6;
        const k = chase(pos, t * 2.2, 6);
        return mix(mul(l.base, DIM), hue(t * 25 + 40, 0.55), k);
      },
    },
    rotors: {
      name: '↻ Drie rotors (2 × 2 vlakken)',
      desc: 'Op voor, rechts en boven draaien de 4 lampjes rond, elk vlak in zijn eigen kleur. '
        + 'In de spiegels draait elke buurkubus andersom: een veld van tandwielen. Werkt met de vaste indeling.',
      fn: (l, t) => {
        if (isCorner(l.p)) return mul(l.base, DIM);
        const f = onFace(l.p);
        if (f.r < 0.15 || Math.abs(f.u) > 0.8 * faceDist(l.p) || Math.abs(f.v) > 0.8 * faceDist(l.p)) {
          return mul(l.base, DIM);                                       // centre or edge LED
        }
        const ang = f.sign * Math.atan2(f.v, f.u);                       // same turning sense seen from outside
        const pos = ((ang / (Math.PI / 2)) % 4 + 4) % 4;
        const k = chase(pos, t * 2.5, 4, 0.5, 1.6);
        return mul([RED, GOLD, ICE][f.axis], DIM + k);
      },
    },
    burst: {
      name: '✳ Explosie / implosie',
      desc: 'Licht schiet op elk vlak van het midden naar de hoeken en trekt weer terug: midden → 2 × 2 → hoeken. '
        + 'De hele spiegelwereld ademt als een ster.',
      fn: (l, t) => {
        const r = isCorner(l.p) ? 1 : onFace(l.p).r;
        const front = 0.5 - 0.5 * Math.cos(t * 1.6);                     // 0 = centre, 1 = corners
        const k = Math.exp(-Math.pow((r - front) / 0.22, 2));
        return mul(mix(GOLD, RED, r), DIM + k);
      },
    },
    diagonal: {
      name: '➚ Diagonaal-golf',
      desc: 'Een golf met staart reist van de hoek achter-links-onder naar voor-rechts-boven; elke golf een nieuwe kleur. '
        + 'Zo lopen de lampjes in een vaste volgorde schuin door het hele raster.',
      fn: (l, t) => {
        const s = (l.p[0] + l.p[1] + l.p[2]) / (3 * faceDist(l.p));     // -1 .. 1 along the diagonal
        const cycle = t * 0.55;
        const front = -1.4 + (cycle % 1) * 2.8;
        const a = front - s;
        const k = a >= 0 ? Math.exp(-a * 3) : Math.exp(-Math.pow(a / 0.15, 2));
        return mul(hue(Math.floor(cycle) * 75), DIM + k);
      },
    },
    breathe: {
      name: 'Ademen',
      desc: 'Alle LEDs zwellen langzaam samen aan en uit in de basiskleur. De hele tunnel ademt mee.',
      fn: (l, t) => mul(l.base, 0.08 + 0.92 * Math.pow(0.5 - 0.5 * Math.cos(t * 1.4), 2)),
    },
    scanner: {
      name: 'Scanner voor ↔ achter (tunnel-zoom)',
      desc: 'Een lichtvlak schuift van voor naar achter. Door de spiegels lijkt het eindeloos de diepte in te rijden.',
      fn: (l, t) => {
        const z = Math.sin(t * 1.1) * 10;
        const d = l.p[2] - z;
        return mul(l.base, 0.04 + Math.exp(-(d * d) / 5));
      },
    },
    lighthouse: {
      name: 'Vuurtoren (draaiende bundel)',
      desc: 'Een bundel draait horizontaal rond. In de spiegels zie je hem als een draaiende spaak door het hele raster.',
      fn: (l, t) => {
        if (Math.hypot(l.p[0], l.p[2]) < 1) return mul(l.base, 0.25);   // top / bottom centre
        const d = wrapPi(Math.atan2(l.p[2], l.p[0]) - t * 1.6);
        return mul(l.base, 0.03 + Math.exp(-(d * d) / 0.18));
      },
    },
    rainbowRise: {
      name: 'Regenboog-golf omhoog',
      desc: 'Kleurbanden stijgen op van bodem naar deksel. Boven en onder vermenigvuldigen tot een eindeloze kleurenschacht.',
      fn: (l, t) => hue(l.p[1] * 14 - t * 80),
    },
    spiral: {
      name: 'Spiraal (kurkentrekker)',
      desc: 'Kleur volgt de hoek rond de kubus plus de hoogte: een draaiende helix door alle reflecties.',
      fn: (l, t) => {
        const a = Math.atan2(l.p[2], l.p[0]) * 180 / Math.PI;
        return hue(a + l.p[1] * 12 + t * 70);
      },
    },
    heartbeat: {
      name: 'Hartslag vanuit het midden',
      desc: 'Een dubbele rode klop die van het midden naar buiten golft: vlakken eerst, dan ribben, dan hoeken.',
      fn: (l, t) => {
        const r = Math.hypot(l.p[0], l.p[1], l.p[2]);
        const ph = ((t - r * 0.035) % 1.3 + 1.3) % 1.3;
        const beat = Math.exp(-Math.pow((ph - 0.1) / 0.06, 2)) + 0.6 * Math.exp(-Math.pow((ph - 0.32) / 0.06, 2));
        return mul(RED, 0.04 + beat);
      },
    },
    twinkle: {
      name: 'Twinkelende sterren',
      desc: 'Elke LED fonkelt op zijn eigen moment, warm-wit. Door de spiegels lijkt het een sterrenhemel.',
      fn: (l, t) => {
        const f = 0.6 + hash(l.i) * 1.6, ph = hash(l.i + 50) * 6.283;
        const s = Math.pow(Math.max(0, Math.sin(t * f + ph)), 16);
        return mul(WHITE, 0.05 + s);
      },
    },
    fire: {
      name: 'Haardvuur',
      desc: 'Onrustig flakkerend oranje-rood, onderin het felst. Warm en gezellig voor pakjesavond.',
      fn: (l, t) => {
        const a = hash(l.i), b = hash(l.i + 9);
        const n = 0.5 + 0.25 * Math.sin(t * (7 + a * 5) + a * 20) + 0.25 * Math.sin(t * (13 + b * 7) + b * 30);
        const height = 1 - (l.p[1] + 10) / 20;          // 1 at the bottom, 0 at the top
        const k = Math.max(0, n * (0.35 + 0.65 * height));
        return mul(mix([1, 0.12, 0.02], [1, 0.62, 0.12], n), 0.1 + k);
      },
    },
    rain: {
      name: 'Vallende sterren',
      desc: 'Lichtdruppels met een staart vallen van boven naar beneden, elk in een eigen kolom en tempo.',
      fn: (l, t) => {
        const col = Math.round(l.p[0]) * 31 + Math.round(l.p[2]);
        const speed = 8 + hash(col) * 8;
        const y = 12 - (((t * speed + hash(col + 3) * 40) % 40) + 40) % 40;   // drop height
        const dy = l.p[1] - y;
        const k = dy >= 0 ? Math.exp(-dy / 2.5) : Math.exp(-(dy * dy) / 0.8);  // tail above the drop
        return mul(ICE, 0.02 + k);
      },
    },
    sint: {
      name: 'Sint & Piet (rood / goud wissel)',
      desc: 'Rood en goud wisselen elkaar zacht af, met af en toe een witte schittering.',
      fn: (l, t) => {
        const k = 0.5 + 0.5 * Math.sin(t * 1.5);
        const c = l.i % 2 ? mix(RED, GOLD, k) : mix(GOLD, RED, k);
        const slot = Math.floor(t * 5);
        const sparkle = hash(l.i * 13 + slot) > 0.94 ? 1 - (t * 5 - slot) : 0;
        return mix(c, WHITE, sparkle);
      },
    },
    rgbCube: {
      name: 'Kleurkubus (kleur = plek)',
      desc: 'Rood = links/rechts, groen = onder/boven, blauw = voor/achter; de hele kubus draait langzaam door de kleurruimte.',
      fn: (l, t) => {
        const a = t * 0.5, x = l.p[0] * Math.cos(a) - l.p[2] * Math.sin(a), z = l.p[0] * Math.sin(a) + l.p[2] * Math.cos(a);
        return [(x + 10) / 20, (l.p[1] + 10) / 20, (z + 10) / 20];
      },
    },
    fireworks: {
      name: 'Vuurwerk',
      desc: 'Op een willekeurige LED ontploft een kleur die als een schokgolf over de kubus uitdooft.',
      fn: (l, t, all) => {
        const period = 0.7;
        let c = [0, 0, 0];
        const now = Math.floor(t / period);
        for (let j = now - 3; j <= now; j++) {
          const age = t - j * period;
          if (age < 0) continue;
          const src = all[Math.floor(hash(j) * all.length)].p;
          const dist = Math.hypot(l.p[0] - src[0], l.p[1] - src[1], l.p[2] - src[2]);
          const ring = dist - age * 22;
          const k = Math.exp(-(ring * ring) / 10) * Math.exp(-age * 1.4);
          c = c.map((v, n) => v + hue(hash(j + 7) * 360)[n] * k);
        }
        return c.map((v) => Math.min(1, v));
      },
    },
  };

  function applyEffect(lights, t) {
    const fx = EFFECTS[$('effect').value] || EFFECTS.static;
    // LEDs on the front face sit right next to your eye and look huge; this dims them.
    const front = parseFloat($('frontDim').value) / 100;
    lights.forEach((l) => {
      const k = toView(l.p)[2] > 0.85 * faceDist(l.p) ? front : 1;
      l.c = fx.fn(l, t, lights).map((v) => Math.max(0, v) * k);
    });
  }

  // ---------- WebGL ----------
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) {
    document.querySelector('.stage').innerHTML =
      '<p style="padding:24px">WebGL is niet beschikbaar in deze browser.</p>';
    return;
  }
  if (!gl.getExtension('OES_texture_float')) {
    document.querySelector('.stage').innerHTML =
      '<p style="padding:24px">Deze browser ondersteunt geen float-textures (OES_texture_float).</p>';
    return;
  }

  const VS = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FS = `
    precision highp float;
    uniform vec2  uRes;
    uniform vec3  uEye;
    uniform vec3  uRight, uUp, uFwd;
    uniform float uTanHalf;
    uniform vec2  uHole;
    uniform float uHoleR;
    uniform float uLedR;
    uniform float uBright;
    uniform float uGlow;
    uniform float uAtten;
    uniform int   uBounces;
    uniform sampler2D uLights;   // row 0: positions, row 1: colours
    uniform int   uCount;
    uniform int   uAA;
    uniform float uLid;
    uniform float uSeam;
    uniform float uAmb;

    const float H = ${H.toFixed(1)};

    vec3 trace(vec3 ro, vec3 rd, float pixAng) {
      // 1. Pass through the peephole in the front face (z = +H).
      if (rd.z > -1e-4) return vec3(0.0);
      float t0 = (ro.z - H) / (-rd.z);
      vec3 p0 = ro + rd * t0;
      if (length(p0.xy - uHole) > uHoleR) return vec3(0.012, 0.010, 0.009); // outside of the box
      ro = p0;

      vec3 col = vec3(0.0);
      float thr = 1.0;      // remaining intensity
      float path = t0;      // unfolded distance from the eye

      for (int b = 0; b <= ${MAX_BOUNCES}; b++) {
        if (b > uBounces) break;

        // distance to the wall along each axis
        vec3 tt = vec3(1e9);
        if (abs(rd.x) > 1e-6) tt.x = (sign(rd.x) * H - ro.x) / rd.x;
        if (abs(rd.y) > 1e-6) tt.y = (sign(rd.y) * H - ro.y) / rd.y;
        if (abs(rd.z) > 1e-6) tt.z = (sign(rd.z) * H - ro.z) / rd.z;
        float tw; int ax;
        if (tt.x < tt.y && tt.x < tt.z) { tw = tt.x; ax = 0; }
        else if (tt.y < tt.z)           { tw = tt.y; ax = 1; }
        else                            { tw = tt.z; ax = 2; }

        // 2. LEDs along this straight segment
        for (int i = 0; i < ${MAX_LIGHTS}; i++) {
          if (i >= uCount) break;
          float u = (float(i) + 0.5) / ${MAX_LIGHTS}.0;
          vec3 L = texture2D(uLights, vec2(u, 0.25)).xyz;
          vec3 c = texture2D(uLights, vec2(u, 0.75)).xyz;
          float tc = clamp(dot(L - ro, rd), 0.0, tw);
          float h = length(ro + rd * tc - L);
          float d = max(path + tc, 0.05);
          float ang  = h / d;                 // angle from LED centre (rad)
          float angR = uLedR / d;             // angular radius of LED
          float w = max(angR, pixAng);
          float core = 1.0 - smoothstep(w * 0.55, w, ang);
          float x = ang / (w * 2.5);
          float halo = uGlow * (0.45 * exp(-x * x) + 0.02 / (1.0 + x * x * x * x));
          float energy = sqrt(angR / w);      // sub-pixel LEDs get a bit dimmer
          col += thr * c * uBright * energy * (core + halo);
        }

        vec3 p = ro + rd * tw;
        path += tw;

        // 3. What did we hit?
        if (ax == 2 && rd.z > 0.0 && length(p.xy - uHole) < uHoleR) {
          break;                                         // the peephole (your own eye): black
        }
        if (ax == 1 && rd.y > 0.0 && uLid > 0.5) {
          col += thr * vec3(0.05, 0.055, 0.07);          // lid removed: dim room
          break;
        }
        vec2 o2 = ax == 0 ? p.yz : (ax == 1 ? p.xz : p.xy);
        if (max(abs(o2.x), abs(o2.y)) > H - uSeam) {
          col += thr * vec3(0.015);                      // seam between mirrors
          break;
        }
        col += thr * uAmb * vec3(0.75, 0.8, 0.9); // dust / stray light on the glass

        if (b >= uBounces) break;                        // no more reflections allowed

        // 4. Reflect
        thr *= uAtten;
        if (ax == 0) rd.x = -rd.x;
        else if (ax == 1) rd.y = -rd.y;
        else rd.z = -rd.z;
        ro = p;
      }
      return col;
    }

    void main() {
      float pixAng = 2.0 * uTanHalf / uRes.y;
      vec3 sum = vec3(0.0);
      float n = float(uAA);
      for (int sy = 0; sy < 2; sy++) {
        if (sy >= uAA) break;
        for (int sx = 0; sx < 2; sx++) {
          if (sx >= uAA) break;
          vec2 off = (vec2(float(sx), float(sy)) + 0.5) / n;
          vec2 uv = (gl_FragCoord.xy - 0.5 + off - 0.5 * uRes) / uRes.y;
          vec3 rd = normalize(uRight * uv.x * 2.0 * uTanHalf + uUp * uv.y * 2.0 * uTanHalf + uFwd);
          sum += trace(uEye, rd, pixAng);
        }
      }
      vec3 c = sum / (n * n);
      c = 1.0 - exp(-c);                 // tone map (bright LEDs saturate to white)
      c = pow(c, vec3(1.0 / 2.2));
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s));
    }
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  ['uRes', 'uEye', 'uRight', 'uUp', 'uFwd', 'uTanHalf', 'uHole', 'uHoleR', 'uLedR', 'uBright',
    'uGlow', 'uAtten', 'uBounces', 'uLights', 'uCount', 'uAA', 'uLid', 'uSeam', 'uAmb']
    .forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });

  // Light data lives in a float texture (MAX_LIGHTS x 2) so we can have many LEDs.
  const lightTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lightTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(U.uLights, 0);
  const lightData = new Float32Array(MAX_LIGHTS * 2 * 4);

  // ---------- State ----------
  function state() {
    const v = (id) => parseFloat(ui[id].value);
    return {
      bounces: v('bounces'),
      atten: 1 - v('atten') / 100,
      bright: v('bright'),
      glow: v('glow'),
      ledR: v('led') / 2,
      inset: v('inset'),
      perEdge: Math.min(MAX_PER_EDGE, v('perEdge')),
      spacing: $('spacing').value,
      layout: $('layout').value,
      spreadCount: $('spreadCount').value,
      stripCount: v('stripCount'),
      stripGap: v('stripGap'),
      lidGap: v('lidGap'),
      faces: $('faces').checked,
      hole: [v('holeX'), v('holeY')],
      holeR: v('holeD') / 2,
      eye: v('eye'),
      fov: v('fov'),
      seam: v('seam'),
      amb: v('amb'),
      holeFace: $('holeFace').value,
      lid: $('holeFace').value === 'front' && $('lid').checked,
    };
  }

  // ---------- Render ----------
  let dirty = true;
  let lowQuality = false;     // 1 sample per pixel while dragging, 4 when idle
  const requestRender = () => { dirty = true; };

  function resize() {
    // While an effect animates, render at a lower resolution so it stays smooth;
    // the glow hides the upscaling. A paused/static view renders sharp again.
    const full = Math.min(window.devicePixelRatio || 1, 2);
    const dpr = animating() ? Math.min(full, 0.6) : full;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      requestRender();
    }
  }

  function render() {
    const s = state();
    const { fwd, right, up } = camBasis();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform3f(U.uEye, s.hole[0], s.hole[1], H + s.eye);
    gl.uniform3fv(U.uRight, right);
    gl.uniform3fv(U.uUp, up);
    gl.uniform3fv(U.uFwd, fwd);
    // FOV applies to the widest side of the screen
    gl.uniform1f(U.uTanHalf, Math.tan((s.fov * Math.PI / 180) / 2) * Math.min(1, canvas.height / canvas.width));
    gl.uniform2f(U.uHole, s.hole[0], s.hole[1]);
    gl.uniform1f(U.uHoleR, s.holeR);
    gl.uniform1f(U.uLedR, s.ledR);
    gl.uniform1f(U.uBright, s.bright);
    gl.uniform1f(U.uGlow, s.glow);
    gl.uniform1f(U.uAtten, s.atten);
    gl.uniform1i(U.uBounces, s.bounces);
    gl.uniform1f(U.uLid, s.lid ? 1 : 0);
    gl.uniform1f(U.uSeam, s.seam);
    gl.uniform1f(U.uAmb, s.amb);

    const lights = buildLights(s);
    applyEffect(lights, fxTime);
    const active = lights.filter((l) => l.on).slice(0, MAX_LIGHTS);
    lightData.fill(0);
    active.forEach((l, i) => {
      lightData.set([...toView(l.p, s), 1], i * 4);           // row 0 (view frame)
      lightData.set([...l.c, 1], (MAX_LIGHTS + i) * 4);        // row 1
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, lightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAX_LIGHTS, 2, 0, gl.RGBA, gl.FLOAT, lightData);
    gl.uniform1i(U.uCount, active.length);
    gl.uniform1i(U.uAA, lowQuality || animating() ? 1 : 2);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawOverview(s, fwd, lights);
    drawSpacingPreview(s);
  }

  // One edge drawn flat, showing where the LEDs go for the chosen spacing.
  function drawSpacingPreview(s) {
    const c = $('spacingPreview');
    const ctx = c.getContext('2d');
    const W = c.width, Hh = c.height, pad = 14;
    ctx.clearRect(0, 0, W, Hh);
    const x = (t) => pad + ((t + H) / (2 * H)) * (W - 2 * pad);
    ctx.strokeStyle = 'rgba(200,210,230,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x(-H), Hh / 2); ctx.lineTo(x(H), Hh / 2); ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,230,.55)';
    [x(-H), x(H)].forEach((px) => ctx.fillRect(px - 1, Hh / 2 - 7, 2, 14));
    spacingPositions(s.perEdge, s.spacing, s.inset).forEach((t, i) => {
      const col = lightColor(i, s.perEdge).map((v) => Math.round(v * 255));
      ctx.fillStyle = `rgb(${col})`;
      ctx.shadowColor = `rgb(${col})`;
      ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(x(t), Hh / 2, 4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#9a97a8';
    ctx.font = '10px system-ui';
    ctx.fillText('hoek', 2, 10);
    ctx.fillText('hoek', W - 24, 10);
  }

  // Effect time advances with the speed slider (changing speed never makes the effect jump).
  let fxTime = 0, lastFrame = performance.now();
  const animating = () => $('effect').value !== 'static' && parseFloat(ui.speed.value) > 0;

  function loop(now = performance.now()) {
    // rAF timestamps can be slightly older than performance.now(), so never step backwards
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    resize();
    if (animating()) {
      fxTime += dt * parseFloat(ui.speed.value);
      dirty = true;
    }
    if (dirty) { dirty = false; render(); }
    requestAnimationFrame(loop);
  }

  // ---------- Overview (small 3D sketch) ----------
  function drawOverview(s, fwd, lights) {
    const W = overview.width, Hh = overview.height;
    octx.clearRect(0, 0, W, Hh);
    const ay = -0.6, ax = 0.45, sc = 6.2;
    const proj = ([x, y, z]) => {
      const x1 = x * Math.cos(ay) + z * Math.sin(ay);
      const z1 = -x * Math.sin(ay) + z * Math.cos(ay);
      const y1 = y * Math.cos(ax) - z1 * Math.sin(ax);
      const z2 = y * Math.sin(ax) + z1 * Math.cos(ax);
      return [W / 2 + x1 * sc, Hh / 2 + 6 - y1 * sc, z2];
    };
    // cube edges
    EDGES.forEach((e, i) => {
      const axis = ['x', 'y', 'z'].find((k) => e.dir[k] === 0);
      const a = [e.dir.x * H, e.dir.y * H, e.dir.z * H];
      const b = a.slice();
      const k = { x: 0, y: 1, z: 2 }[axis];
      a[k] = -H; b[k] = H;
      const pa = proj(a), pb = proj(b);
      octx.strokeStyle = e.dir.y > 0 && s.lid ? 'rgba(255,255,255,.18)' : 'rgba(200,210,230,.55)';
      octx.setLineDash(e.dir.y > 0 && s.lid ? [4, 4] : []);
      octx.lineWidth = 1.2;
      octx.beginPath(); octx.moveTo(pa[0], pa[1]); octx.lineTo(pb[0], pb[1]); octx.stroke();
    });
    octx.setLineDash([]);
    // peephole face tint
    const fc = [[-H, -H, H], [H, -H, H], [H, H, H], [-H, H, H]].map((p) => proj(fromView(p, s)));
    octx.fillStyle = 'rgba(120,160,255,.07)';
    octx.beginPath(); fc.forEach((p, i) => (i ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1])));
    octx.closePath(); octx.fill();
    // LED strip wire (in strip order)
    if (lights.length && lights[0].strip) {
      octx.strokeStyle = 'rgba(255,255,255,.22)';
      octx.lineWidth = 1;
      octx.beginPath();
      lights.forEach((l, i) => {
        const q = proj(l.p);
        if (i) octx.lineTo(q[0], q[1]); else octx.moveTo(q[0], q[1]);
      });
      octx.stroke();
      const a = proj(lights[0].p);
      octx.fillStyle = '#9a97a8'; octx.font = '10px system-ui';
      octx.fillText('start', a[0] + 5, a[1] + 10);
    }
    // LEDs
    const r = lights.length > 40 ? 2.5 : 4;
    lights.map((l) => ({ l, q: proj(l.p) }))
      .sort((a, b) => a.q[2] - b.q[2])
      .forEach(({ l, q }) => {
        // live colour * intensity of this LED (dark = dimmed by the effect)
        const c = l.c.map((v) => Math.round(Math.min(1, v) * 255));
        octx.fillStyle = l.on ? `rgb(${c})` : '#222';
        octx.shadowColor = l.on ? `rgb(${c})` : 'transparent';
        octx.shadowBlur = l.on ? 8 : 0;
        octx.beginPath(); octx.arc(q[0], q[1], r, 0, Math.PI * 2); octx.fill();
        octx.shadowBlur = 0;
        octx.strokeStyle = 'rgba(255,255,255,.18)';
        octx.lineWidth = 0.8;
        octx.stroke();
      });
    octx.shadowBlur = 0;
    // peephole + view direction
    const hp = proj(holeWorld(s));
    const tip = proj(fromView([s.hole[0] + fwd[0] * 8, s.hole[1] + fwd[1] * 8, H + fwd[2] * 8], s));
    octx.strokeStyle = '#7fd4ff'; octx.lineWidth = 2;
    octx.beginPath(); octx.moveTo(hp[0], hp[1]); octx.lineTo(tip[0], tip[1]); octx.stroke();
    octx.fillStyle = '#000'; octx.strokeStyle = '#7fd4ff';
    octx.beginPath(); octx.arc(hp[0], hp[1], 4, 0, Math.PI * 2); octx.fill(); octx.stroke();
    octx.fillStyle = '#9a97a8'; octx.font = '11px system-ui';
    octx.fillText(holeInLid(s) ? 'kijkgat (deksel)' : 'kijkgat (voorkant)', 8, Hh - 10);
    if (!holeInLid(s)) octx.fillText(s.lid ? 'deksel eraf' : 'deksel = spiegel', W - 100, 16);
  }

  // ---------- Visibility score ----------
  // All mirror images of all LEDs up to the chosen number of reflections, seen from the eye at
  // the peephole. Image in mirror cell (i,j,k): x' = 20 i + (-1)^i x (same for y, z) and it
  // takes |i|+|j|+|k| reflections. An image counts as overlapping when a nearer image sits
  // within the sum of both apparent radii (x 1.5 for glow) plus about a pixel.
  function visibilityStats(s, lights) {
    const eye = [s.hole[0], s.hole[1], H];
    const B = s.bounces, cosMax = Math.cos((50 * Math.PI) / 180);   // 100° field of view
    const ims = [];
    lights.forEach((l) => {
      if (!l.on) return;
      const c = toView(l.p, s);                   // view frame: peephole face is +z
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
    ims.sort((p, q) => p.D - q.D);
    const cell = 0.03, grid = new Map();
    let overlapped = 0;
    for (const m of ims) {
      const gx = Math.floor(m.x / cell), gy = Math.floor(m.y / cell);
      let hit = false;
      for (let ox = -1; ox <= 1 && !hit; ox++) for (let oy = -1; oy <= 1 && !hit; oy++) {
        for (const o of grid.get(`${gx + ox},${gy + oy}`) || []) {
          const ang = Math.acos(Math.min(1, m.x * o.x + m.y * o.y + m.z * o.z));
          if (ang < 1.5 * (s.ledR / m.D + s.ledR / o.D) + 0.004) { hit = true; break; }
        }
      }
      if (hit) overlapped++;
      const kk = `${gx},${gy}`;
      if (!grid.has(kk)) grid.set(kk, []);
      grid.get(kk).push(m);
    }
    return { images: ims.length, overlapped, distinct: ims.length - overlapped };
  }

  // ---------- Net (uitslag) ----------
  // Inside view: the mirrors lie reflective side up, as if the cube is opened out flat.
  // Walls sit in one row (voor, links, achter, rechts) so a strip running around the walls
  // is one continuous line across the fold lines; the floor hangs under "voor", the lid sits
  // above it. Units are cm; panel size = 2H = 20 cm.
  const S = 2 * H;
  const WALLS = ['voor', 'links', 'achter', 'rechts'];
  const NET_W = 4 * S, NET_H = 3 * S;

  // panels: normal axis + sign of each face
  const PANELS = [
    { name: 'voor', a: 2, s: 1 }, { name: 'links', a: 0, s: -1 }, { name: 'achter', a: 2, s: -1 },
    { name: 'rechts', a: 0, s: 1 }, { name: 'bodem', a: 1, s: -1 }, { name: 'deksel', a: 1, s: 1 },
  ];

  function panelOf([x, y, z]) {
    if (Math.max(Math.abs(x), Math.abs(z)) >= Math.abs(y) - 1e-6) {   // walls win at corners
      if (Math.abs(z) >= Math.abs(x)) return z > 0 ? 0 : 2;
      return x < 0 ? 1 : 3;
    }
    return y < 0 ? 4 : 5;
  }

  // Position of a point when drawn on a given panel (inside view). u/v are the measures
  // for the table: walls = from left edge / from the floor; floor = from left / from front wall.
  function mapToPanel([x, y, z], panel) {
    switch (panel) {
      case 0: { const u = H - x; return { u, v: H + y, X: u, Y: S + (H - y) }; }
      case 1: { const u = H - z; return { u, v: H + y, X: S + u, Y: S + (H - y) }; }
      case 2: { const u = H + x; return { u, v: H + y, X: 2 * S + u, Y: S + (H - y) }; }
      case 3: { const u = H + z; return { u, v: H + y, X: 3 * S + u, Y: S + (H - y) }; }
      case 4: { const u = H - x, w = H - z; return { u, v: w, X: u, Y: 2 * S + w }; }
      default: { const u = H - x, w = H - z; return { u, v: w, X: u, Y: S - w }; }
    }
  }

  function netPos(p) {
    const panel = panelOf(p);
    return { face: PANELS[panel].name, panel, ...mapToPanel(p, panel) };
  }

  // Where the strip crosses the edge between two adjacent faces (3D point on the edge),
  // following the straight line of the strip on the unfolded mirrors.
  function foldPoint(pa, pb, A, B) {
    const a = A.a, b = B.a, c = 3 - a - b;
    const dA = Math.abs(B.s * H - pa[b]), dB = Math.abs(A.s * H - pb[a]);
    const t = dA / Math.max(1e-9, dA + dB);
    const e = [0, 0, 0];
    e[a] = A.s * H; e[b] = B.s * H; e[c] = pa[c] + (pb[c] - pa[c]) * t;
    return e;
  }

  function buildNetSVG(s, lights) {
    const fmt1 = (n) => +n.toFixed(2);
    const out = [];
    const pts = lights.filter((l) => l.on).map((l, n) => ({ ...netPos(l.p), n: n + 1, strip: l.strip, p: l.p }));
    const lidHasLeds = pts.some((q) => q.face === 'deksel');

    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -3 ${NET_W + 2} ${NET_H + 4}"
      width="${NET_W + 2}cm" height="${NET_H + 4}cm" font-family="Arial, sans-serif">`);
    out.push(`<rect x="-1" y="-3" width="${NET_W + 2}" height="${NET_H + 4}" fill="#fff"/>`);

    // panels: 4 walls in a row, floor below "voor", lid above "voor"
    const panel = (x, y, label, extra = '') => {
      out.push(`<rect x="${x}" y="${y}" width="${S}" height="${S}" fill="#f4f7fb" stroke="#333" stroke-width="0.06" ${extra}/>`);
      for (let g = 5; g < S; g += 5) {                  // 5 cm grid
        out.push(`<line x1="${x + g}" y1="${y}" x2="${x + g}" y2="${y + S}" stroke="#dde3ea" stroke-width="0.03"/>`);
        out.push(`<line x1="${x}" y1="${y + g}" x2="${x + S}" y2="${y + g}" stroke="#dde3ea" stroke-width="0.03"/>`);
      }
      out.push(`<text x="${x + S / 2}" y="${y + 1.3}" font-size="0.9" text-anchor="middle" fill="#666" font-weight="bold">${label}</text>`);
    };
    const lidHole = holeInLid(s);
    WALLS.forEach((w, i) => panel(i * S, S, w.toUpperCase() + (i === 0 && !lidHole ? ' (kijkgat)' : '')));
    panel(0, 2 * S, 'BODEM');
    panel(0, 0, (lidHole ? 'DEKSEL (kijkgat)' : 'DEKSEL') + (lidHasLeds ? '' : ' – geen lampjes'),
      'stroke-dasharray="0.4 0.3" fill="#fafafa"');
    // fold lines between walls
    for (let i = 1; i < 4; i++) {
      out.push(`<line x1="${i * S}" y1="${S}" x2="${i * S}" y2="${2 * S}" stroke="#333" stroke-width="0.06" stroke-dasharray="0.5 0.3"/>`);
    }
    out.push(`<text x="${2 * S}" y="${2 * S + 1.5}" font-size="0.7" fill="#888" text-anchor="middle">--- = vouwlijn (hoek van de kubus) · raster 5 cm · binnenaanzicht</text>`);

    // peephole (lid or "voor")
    const hp = netPos(holeWorld(s));
    out.push(`<circle cx="${fmt1(hp.X)}" cy="${fmt1(hp.Y)}" r="${fmt1(s.holeR)}" fill="#000"/>`);
    out.push(`<text x="${fmt1(hp.X + s.holeR + 0.3)}" y="${fmt1(hp.Y + 0.25)}" font-size="0.6" fill="#000">kijkgat</text>`);

    // strip wire: one line. Across a fold it continues where both sides touch in the net;
    // where they don't (e.g. row ends, floor -> side wall) a letter pair marks the jump.
    const strip = pts.filter((q) => q.strip && q.panel <= 4);
    if (strip.length > 1) {
      let d = `M${fmt1(strip[0].X)} ${fmt1(strip[0].Y)}`;
      let jumpNo = 0;
      const letter = (pt, txt) => out.push(`<text x="${fmt1(pt.X + 0.15)}" y="${fmt1(pt.Y - 0.15)}" font-size="0.6" fill="#c00" font-weight="bold">${txt}</text>`);
      for (let k = 1; k < strip.length; k++) {
        const a = strip[k - 1], b = strip[k];
        if (a.panel === b.panel) { d += ` L${fmt1(b.X)} ${fmt1(b.Y)}`; continue; }
        const A = PANELS[a.panel], B = PANELS[b.panel];
        if (A.a === B.a) { d += ` M${fmt1(b.X)} ${fmt1(b.Y)}`; continue; }   // opposite faces: no fold
        const e = foldPoint(a.p, b.p, A, B);
        const ea = mapToPanel(e, a.panel), eb = mapToPanel(e, b.panel);
        if (Math.abs(ea.X - eb.X) < 1e-6 && Math.abs(ea.Y - eb.Y) < 1e-6) {
          d += ` L${fmt1(ea.X)} ${fmt1(ea.Y)} L${fmt1(b.X)} ${fmt1(b.Y)}`;
        } else {
          const txt = jumpNo < 26 ? String.fromCharCode(65 + jumpNo) : `${jumpNo + 1}`;
          jumpNo++;
          d += ` L${fmt1(ea.X)} ${fmt1(ea.Y)} M${fmt1(eb.X)} ${fmt1(eb.Y)} L${fmt1(b.X)} ${fmt1(b.Y)}`;
          letter(ea, txt); letter(eb, txt);
        }
      }
      out.push(`<path d="${d}" fill="none" stroke="#c00" stroke-width="0.12" stroke-linejoin="round"/>`);
      const st = strip[0], en = strip[strip.length - 1];
      out.push(`<text x="${fmt1(st.X)}" y="${fmt1(st.Y + 1.1)}" font-size="0.6" fill="#c00" text-anchor="middle">▲ start (data in)</text>`);
      out.push(`<text x="${fmt1(en.X)}" y="${fmt1(en.Y - 0.7)}" font-size="0.6" fill="#c00" text-anchor="middle">einde</text>`);
    }

    // LEDs with their number
    pts.forEach((q) => {
      out.push(`<circle cx="${fmt1(q.X)}" cy="${fmt1(q.Y)}" r="0.35" fill="#111" stroke="#fff" stroke-width="0.06"/>`);
      out.push(`<text x="${fmt1(q.X + 0.45)}" y="${fmt1(q.Y - 0.35)}" font-size="0.55" fill="#111">${q.n}</text>`);
    });
    // ---- spread check: all faces on top of each other in one 20 x 20 square ----
    // Left square: every LED at its own (u, v) on its face, coloured per face.
    // Right square: the same plus the copies the mirrors make (flipped left/right and
    // up/down). In the mirrors every pattern also shows up flipped, so points that come
    // close together here can line up or overlap in the reflections.
    const FACE_COL = { voor: '#d62728', links: '#1f77b4', achter: '#2ca02c', rechts: '#ff7f0e', bodem: '#9467bd', deksel: '#8c564b' };
    const overlay = pts.filter((q) => q.panel <= 5);
    const box = (x0, title) => {
      out.push(`<rect x="${x0}" y="0" width="${S}" height="${S}" fill="#fff" stroke="#333" stroke-width="0.06"/>`);
      for (let g = 5; g < S; g += 5) {
        out.push(`<line x1="${x0 + g}" y1="0" x2="${x0 + g}" y2="${S}" stroke="#e3e7ec" stroke-width="0.03"/>`);
        out.push(`<line x1="${x0}" y1="${g}" x2="${x0 + S}" y2="${g}" stroke="#e3e7ec" stroke-width="0.03"/>`);
      }
      out.push(`<text x="${x0}" y="-1" font-size="0.75" fill="#333" font-weight="bold">${title}</text>`);
    };
    // (u, v) inside the square; v measured from the bottom edge for walls
    const sq = (x0, u, v) => [x0 + u, S - v];
    const A0 = 26, B0 = 54;
    box(A0, 'Spreidingscontrole: alle vlakken over elkaar');
    box(B0, '… inclusief spiegelingen (zo herhalen de spiegels ze)');

    // closest pair (between different LEDs) for both squares
    const copies = [];
    overlay.forEach((q, i) => {
      [[q.u, q.v], [S - q.u, q.v], [q.u, S - q.v], [S - q.u, S - q.v]].forEach(([u, v], c) => copies.push({ i, u, v, own: c === 0 }));
    });
    // Only LEDs on the same face or on opposite faces end up in the same planes in the
    // mirrors, so only those pairs can really line up; adjacent faces never do.
    const OPP = { voor: 'achter', achter: 'voor', links: 'rechts', rechts: 'links' };
    const related = (fa, fb) => fa === fb || OPP[fa] === fb;
    const closest = (list) => {
      let best = { d: Infinity };
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        if (list[a].i === list[b].i) continue;
        if (!related(overlay[list[a].i].face, overlay[list[b].i].face)) continue;
        const d = Math.hypot(list[a].u - list[b].u, list[a].v - list[b].v);
        if (d < best.d) best = { d, a: list[a], b: list[b] };
      }
      return best;
    };
    const cA = closest(copies.filter((c) => c.own));
    const cB = closest(copies);

    copies.forEach((c) => {
      const q = overlay[c.i], col = FACE_COL[q.face];
      if (c.own) {
        const [x, y] = sq(A0, c.u, c.v);
        out.push(`<circle cx="${fmt1(x)}" cy="${fmt1(y)}" r="0.32" fill="${col}"/>`);
        out.push(`<text x="${fmt1(x + 0.38)}" y="${fmt1(y - 0.3)}" font-size="0.45" fill="${col}">${q.n}</text>`);
      }
      const [x, y] = sq(B0, c.u, c.v);
      out.push(c.own
        ? `<circle cx="${fmt1(x)}" cy="${fmt1(y)}" r="0.32" fill="${col}"/>`
        : `<circle cx="${fmt1(x)}" cy="${fmt1(y)}" r="0.28" fill="none" stroke="${col}" stroke-width="0.08"/>`);
    });
    // ring the closest pair in each square
    const ring = (x0, pair) => {
      if (!Number.isFinite(pair.d)) return;
      [pair.a, pair.b].forEach((c) => {
        const [x, y] = sq(x0, c.u, c.v);
        out.push(`<circle cx="${fmt1(x)}" cy="${fmt1(y)}" r="0.75" fill="none" stroke="#000" stroke-width="0.07" stroke-dasharray="0.2 0.15"/>`);
      });
    };
    ring(A0, cA); ring(B0, cB);

    // legend + numbers, to the right of the floor
    let ly = 2 * S + 3;
    const lx = 26;
    out.push(`<text x="${lx}" y="${ly}" font-size="0.75" fill="#333" font-weight="bold">Spreidingscontrole (vierkanten rechtsboven)</text>`);
    ly += 1.2;
    Object.entries(FACE_COL).forEach(([f, col], i) => {
      if (!overlay.some((q) => q.face === f)) return;
      out.push(`<circle cx="${lx + 0.3}" cy="${ly - 0.2}" r="0.3" fill="${col}"/>`);
      out.push(`<text x="${lx + 0.9}" y="${ly}" font-size="0.6" fill="#333">${f} (${overlay.filter((q) => q.face === f).length})</text>`);
      ly += 0.9;
    });
    const pairTxt = (p) => (Number.isFinite(p.d)
      ? `${p.d.toFixed(1)} cm (LED ${overlay[p.a.i].n} en ${overlay[p.b.i].n})` : '–');
    ly += 0.4;
    out.push(`<text x="${lx}" y="${ly}" font-size="0.6" fill="#333">Kleinste afstand, zonder spiegelingen: ${pairTxt(cA)}</text>`);
    ly += 0.9;
    out.push(`<text x="${lx}" y="${ly}" font-size="0.6" fill="#333">Kleinste afstand, inclusief spiegelingen (open rondjes): ${pairTxt(cB)}</text>`);
    ly += 0.9;
    const note = [
      'Gemeten tussen LEDs op hetzelfde vlak of op tegenover elkaar liggende vlakken (voor–achter, links–rechts):',
      'alleen die komen in de spiegels in hetzelfde vlak terecht en kunnen daar op één lijn vallen. Punten van',
      'naburige vlakken mogen in het vierkant gerust samenvallen. Gestippelde ring = dichtstbijzijnde paar.',
      'Positie per vlak in binnenaanzicht (vanaf linkerrand, hoogte). De echte overlap staat in de zichtbaarheidsscore.',
    ];
    note.forEach((t) => { out.push(`<text x="${lx}" y="${ly}" font-size="0.55" fill="#666">${t}</text>`); ly += 0.75; });

    out.push('</svg>');
    return { svg: out.join('\n'), pts, lidHasLeds };
  }

  let lastNetSVG = '';
  function openNet() {
    const s = state();
    const lights = buildLights(s);
    const { svg, pts, lidHasLeds } = buildNetSVG(s, lights);
    lastNetSVG = svg;
    $('netWrap').innerHTML = svg;
    const isStrip = lights.some((l) => l.strip);
    $('netNote').textContent = (isStrip
      ? `De rode lijn is de LED-strip (${pts.length} LEDs). Over de vouwlijnen loopt hij gewoon door. `
        + 'Waar twee randen in de tekening niet tegen elkaar liggen maar in de kubus wel (bijvoorbeeld de buitenste '
        + 'randen van de rij, of bodem naar een zijwand), springt de lijn naar dezelfde letter. '
      : 'Deze indeling is geen doorlopende strip; de lampjes staan als losse punten getekend. ')
      + (lidHasLeds ? 'Let op: in deze indeling zitten er lampjes op het deksel.' : 'Het deksel heeft geen lampjes.');
    // distance to the previous LED along the mirrors (same face, or over one fold)
    const surf = (a, b) => {
      if (a.panel === b.panel) return mapDist(a, b);
      const A = PANELS[a.panel], B = PANELS[b.panel];
      if (A.a === B.a) return NaN;
      const e = foldPoint(a.p, b.p, A, B);
      const ea = mapToPanel(e, a.panel), eb = mapToPanel(e, b.panel);
      return Math.hypot(ea.X - a.X, ea.Y - a.Y) + Math.hypot(eb.X - b.X, eb.Y - b.Y);
    };
    const mapDist = (a, b) => Math.hypot(a.X - b.X, a.Y - b.Y);
    const rows = pts.map((q, i) => {
      const gap = isStrip && i > 0 ? surf(pts[i - 1], q) : NaN;
      const slack = Number.isFinite(gap) ? s.stripGap - gap : 0;
      const gapTxt = Number.isFinite(gap) ? gap.toFixed(1) + (slack > 0.3 ? ` <span class="slack">(+${slack.toFixed(1)} bocht)</span>` : '') : '';
      return `<tr><td>${q.n}</td><td>${q.face}</td><td>${q.u.toFixed(1)}</td><td>${q.v.toFixed(1)}</td><td>${gapTxt}</td></tr>`;
    });
    $('netTable').innerHTML = '<thead><tr><th>LED</th><th>Vlak</th><th>Vanaf linkerrand (cm)</th>'
      + '<th>Hoogte / vanaf voorwand (cm)</th><th>Afstand tot vorige LED (cm)</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
    $('netModal').hidden = false;
    $('netClose').focus();
  }
  const closeNet = () => { $('netModal').hidden = true; $('openNet').focus(); };

  // ---------- UI wiring ----------
  function updateLabels() {
    Object.keys(ui).forEach((id) => {
      const out = $(id + 'Out');
      if (out) out.textContent = fmt[id](ui[id].value);
    });
    const s = state();
    const rows = [];
    for (let b = 0; b <= MAX_BOUNCES; b++) {
      const pct = Math.pow(s.atten, b) * 100;
      const label = b === 0 ? 'Direct' : `${b}e reflectie`;
      rows.push(`<tr class="${b > s.bounces ? 'off' : ''}">
        <td>${label}</td>
        <td style="width:40%"><div class="bar" style="width:${pct}%"></div></td>
        <td>${pct.toFixed(0)}%</td></tr>`);
    }
    $('levels').innerHTML = rows.join('');
    $('customWrap').hidden = $('colorMode').value !== 'custom';
    $('faceList').hidden = !$('faces').checked;
    const layout = $('layout').value;
    $('freeLayout').hidden = layout !== 'free';
    $('helixLayout').hidden = layout !== 'helix';
    $('spreadLayout').hidden = layout !== 'spread';
    $('lidWrap').hidden = holeInLid(s);
    $('subTitle').textContent = 'Spiegelkubus 20 × 20 × 20 cm, gezien door een kijkgat in '
      + (holeInLid(s) ? 'het deksel.' : 'de voorkant.');
    if (layout === 'spread') {
      $('layoutDesc').textContent =
        `Eén strip van ${$('spreadCount').value} LEDs over bodem en wanden`
        + (holeInLid(s) ? ', beginnend in het midden van een vlak (LED 1)' : '')
        + ', bewust onregelmatig: de posities zijn door een '
        + 'optimalisatie zo gekozen dat de spiegelbeelden elkaar zo min mogelijk bedekken of op één lijn vallen. '
        + 'Elke wand heeft een eigen patroon. Afstand tussen LEDs 6,5–10 cm langs de spiegel; deksel en kijkgat blijven vrij.';
    } else if (layout === 'grid') {
      $('layoutDesc').textContent =
        'Eén strip van 20 LEDs, 10 cm uit elkaar: een vierkant van 4 op de bodem, dan twee ringen van 8 rond de wanden '
        + '(op 5 en 15 cm hoogte). Elke LED zit 5 cm van iedere spiegelrand, zodat de spiegelbeelden het raster naadloos '
        + 'voortzetten. Deksel vrij; de draad blijft 5 cm van het kijkgat.';
    } else if (layout === 'helix') {
      const h = helixInfo(s, H - s.inset);
      $('layoutDesc').textContent =
        `De strip loopt als spiraal langs voor, rechts, achter en links, van de bodem tot net onder het deksel. `
        + `${h.turns.toFixed(1)} rondes, ${(h.pitch * 10).toFixed(0)} mm tussen de rondes, `
        + `${(h.len / 100).toFixed(2)} m strip. Bij het kijkgat loopt de strip precies tussen twee rondes door.`;
    } else if (layout === 'fixed') {
      $('layoutDesc').textContent =
        'Achter, links en onder: een lampje in elke hoek en één in het midden (7 hoeken + 3 midden). '
        + 'Voor, rechts en boven: 4 lampjes per vlak in een 2 × 2 raster, space-around (12). Totaal 22.';
    } else {
      $('layoutDesc').textContent =
        'Stel zelf het aantal lampjes per ribbe, de verdeling en de lampjes in het midden van de vlakken in.';
    }
    $('effectDesc').textContent = (EFFECTS[$('effect').value] || EFFECTS.static).desc;
    const lightsNow = buildLights(s);
    const vs = visibilityStats(s, lightsNow);
    const nOn = lightsNow.filter((l) => l.on).length;
    $('visScore').innerHTML = `Zichtbaarheid (${nOn} LEDs, t/m ${s.bounces} reflecties): `
      + `<b>${vs.distinct}</b> losse lichtpunten in beeld, `
      + `<b>${vs.images ? Math.round((100 * vs.overlapped) / vs.images) : 0}%</b> van de spiegelbeelden overlapt.`;
  }

  function buildEffectList() {
    const sel = $('effect');
    Object.entries(EFFECTS).forEach(([key, fx]) => sel.add(new Option(fx.name, key)));
    sel.value = 'showreel';
  }

  function buildFaceList() {
    const box = $('faceList');
    FACES.forEach((f) => {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = f.on;
      cb.addEventListener('change', () => { f.on = cb.checked; requestRender(); });
      l.append(cb, f.name);
      box.appendChild(l);
    });
  }

  function buildEdgeList() {
    const box = $('edges');
    const groups = ['Deksel (boven)', 'Staande ribben', 'Bodem (onder)'];
    groups.forEach((g) => {
      const h = document.createElement('h4');
      h.textContent = g;
      box.appendChild(h);
      EDGES.forEach((e) => {
        if (e.group !== g) return;
        const l = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = e.on;
        cb.addEventListener('change', () => { e.on = cb.checked; requestRender(); });
        l.append(cb, e.name);
        box.appendChild(l);
      });
    });
  }

  document.querySelectorAll('.panel input, .panel select').forEach((el) => {
    el.addEventListener('input', () => { updateLabels(); requestRender(); });
  });

  // Look around by dragging
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    lowQuality = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const fov = parseFloat(ui.fov.value) * Math.PI / 180;
    const k = fov / canvas.clientHeight;
    yaw += (e.clientX - drag.x) * k;
    pitch -= (e.clientY - drag.y) * k;
    const lim = 85 * Math.PI / 180;
    yaw = Math.max(-lim, Math.min(lim, yaw));
    pitch = Math.max(-lim, Math.min(lim, pitch));
    drag = { x: e.clientX, y: e.clientY };
    requestRender();
  });
  const endDrag = () => { drag = null; lowQuality = false; requestRender(); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = Math.max(40, Math.min(140, parseFloat(ui.fov.value) + Math.sign(e.deltaY) * 4));
    ui.fov.value = f;
    updateLabels(); requestRender();
  }, { passive: false });

  $('resetView').addEventListener('click', () => { yaw = 0; pitch = 0; requestRender(); });
  $('openNet').addEventListener('click', openNet);
  $('netClose').addEventListener('click', closeNet);
  $('netModal').addEventListener('click', (e) => { if (e.target === $('netModal')) closeNet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('netModal').hidden) closeNet(); });
  $('netPrint').addEventListener('click', () => window.print());
  $('netDownload').addEventListener('click', () => {
    const blob = new Blob([lastNetSVG], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.download = 'infinity-cube-uitslag.svg';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('shot').addEventListener('click', () => {
    render();
    const a = document.createElement('a');
    a.download = 'infinity-cube.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  });
  window.addEventListener('resize', requestRender);

  buildEffectList();
  buildEdgeList();
  buildFaceList();
  updateLabels();
  loop();
})();
