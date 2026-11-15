// Light effects: every LED gets its own colour + intensity per frame.
// Each effect maps (light, time, all lights) -> [r, g, b]; the length of the vector is the
// intensity (0 = off, 1 = full).
//
// Effects are designed for the view through the peephole. Each light carries `l.v`, its
// position in the view frame: v[2] is the depth along your line of sight (+10 = right at the
// peephole, -10 = the far mirror), v[0]/v[1] are across it. Two kinds of movement are
// multiplied endlessly by the mirrors and give the strongest effect:
//   - along the depth: rings / stars that rush towards you or fall away into the tunnel;
//   - around your line of sight: arms and bands that make the whole tunnel spin.

import { faceDist } from './geometry.js';
import { hslToRgb } from './color.js';

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hue = (h, l = 0.55) => hslToRgb(((h % 360) + 360) % 360, 1, l);
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const cap = (c) => c.map((v) => Math.min(1, v));
const frac = (x) => x - Math.floor(x);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const RED = [1, 0.06, 0.05], GOLD = [1, 0.7, 0.12], WHITE = [1, 0.92, 0.8], ICE = [0.6, 0.8, 1];
const VIOLET = [0.55, 0.3, 1], CYAN = [0.1, 0.85, 1], CORAL = [1, 0.35, 0.28], ORANGE = [1, 0.42, 0.05];
const MAGENTA = [1, 0.1, 0.65], TEAL = [0.05, 0.9, 0.75], AURORA_GREEN = [0.15, 1, 0.35];
const DEEP_BLUE = [0.02, 0.12, 0.6], FOAM = [0.85, 0.95, 1], FIREFLY = [0.7, 1, 0.15];

/** Depth of a light along your line of sight: 0 = far mirror, 20 = at the peephole. */
const depth = (l) => l.v[2] + 10;
/** Angle of a light around your line of sight (rad). */
const spin = (l) => Math.atan2(l.v[1], l.v[0]);

// Running light: `pos` is the LED's place on a closed path of `n` steps, `head` the moving
// head. The LED fades in just before the head arrives and leaves a fading tail, so the eye
// sees smooth movement instead of blinking (phi phenomenon).
function chase(pos, head, n, fadeIn = 0.6, tail = 1.1) {
  let a = (((head - pos) % n) + n) % n;
  if (a > n - fadeIn) a -= n;
  return a < 0 ? Math.pow(1 + a / fadeIn, 2) : Math.exp(-a * tail);
}

// Neighbour graph of the LEDs (each LED linked to its 3 nearest), for effects that spread
// from LED to LED. Cached per layout; hop distances cached per start LED.
const graphs = new Map();
function ledGraph(all) {
  const key = `${all.length}:${all.slice(0, 3).map((l) => l.p.join(',')).join(';')}`;
  let g = graphs.get(key);
  if (g) return g;
  const n = all.length, links = all.map(() => new Set());
  all.forEach((a, i) => {
    all.map((b, j) => ({ j, d: dist(a.p, b.p) })).filter((o) => o.j !== i)
      .sort((x, y) => x.d - y.d).slice(0, 3)
      .forEach(({ j }) => { links[i].add(j); links[j].add(i); });
  });
  const hopCache = new Map();
  g = {
    hops(seed) {
      if (hopCache.has(seed)) return hopCache.get(seed);
      const h = new Array(n).fill(Infinity), queue = [seed];
      h[seed] = 0;
      while (queue.length) {
        const i = queue.shift();
        links[i].forEach((j) => { if (h[j] === Infinity) { h[j] = h[i] + 1; queue.push(j); } });
      }
      hopCache.set(seed, h);
      return h;
    },
  };
  if (graphs.size > 20) graphs.clear();
  graphs.set(key, g);
  return g;
}

// Showreel: [effect, seconds]; each effect starts at its own time 0, with a soft crossfade.
const SHOW = [
  ['warp', 8], ['dnaHelix', 10], ['beatDrop', 15], ['sea', 12], ['orbits', 10], ['lightning', 8.4], ['aurora', 12],
  ['tunnelRush', 9], ['swarm', 12], ['supernova', 9], ['vortex', 10], ['bouncingBall', 12], ['meteors', 10],
  ['kaleidoscope', 10],
];
const SHOW_FADE = 1.5;
const SHOW_TOTAL = SHOW.reduce((s, [, d]) => s + d, 0);

const EFFECT_DEFS = {
  showreel: {
    name: '★ Show (alle hoogtepunten achter elkaar)',
    desc: 'Warpsprong → dubbele helix → beat drop → klotsende zee → planeten → bliksem → noorderlicht → tunnel → '
      + 'zwerm → supernova → draaikolk → stuiterbal → meteoren → caleidoscoop. '
      + 'Elk effect begint vooraan en vloeit zacht over in het volgende.',
    fn: (l, t, all) => {
      let local = ((t % SHOW_TOTAL) + SHOW_TOTAL) % SHOW_TOTAL, i = 0;
      while (local >= SHOW[i][1]) { local -= SHOW[i][1]; i++; }
      const [key, dur] = SHOW[i];
      const cur = EFFECT_DEFS[key].fn(l, local + SHOW_FADE, all);
      if (local < dur - SHOW_FADE) return cur;
      const next = EFFECT_DEFS[SHOW[(i + 1) % SHOW.length][0]].fn(l, local - dur + SHOW_FADE, all);
      return mix(cur, next, smooth(dur - SHOW_FADE, dur, local));
    },
  },

  // ---------------- depth: towards you / away from you ----------------
  warp: {
    name: '🚀 Warpsprong',
    desc: 'Sterren schieten uit de diepte naar je toe, steeds sneller en met steeds langere strepen, '
      + 'tot een witte flits de sprong maakt. Door de spiegels vlieg je door een eindeloze tunnel.',
    fn: (l, t) => {
      const T = 8, ph = frac(t / T) * T, cycle = Math.floor(t / T);
      const speed = 10 + 70 * Math.pow(ph / T, 2.2);                   // cm/s, accelerating
      const travelled = 10 * ph + (70 * T * Math.pow(ph / T, 3.2)) / 3.2; // integral of speed
      const lane = hash(Math.round(spin(l) / (Math.PI / 6)) * 7.3 + cycle * 1.7);   // 12 lanes
      const star = frac(travelled / 20 + lane) * 20;                    // star height in its lane
      const behind = ((star - depth(l)) % 20 + 20) % 20;                // star passed this LED by ...
      const k = Math.exp(-behind / (0.8 + speed / 12));                 // longer streaks when faster
      const c = mul(mix(ICE, WHITE, ph / T), 0.03 + k);
      const flash = smooth(T - 0.7, T, ph) + (t >= T ? 1 - smooth(0, 0.6, ph) : 0);
      return mix(c, WHITE, Math.min(1, flash));
    },
  },
  tunnelRush: {
    name: '◎ Tunnel van ringen',
    desc: 'Ringen in steeds een andere kleur razen uit de diepte op je af. De spiegels herhalen ze '
      + 'tot een eindeloze tunnel waar je doorheen vliegt.',
    fn: (l, t) => {
      const pos = (depth(l) - t * 14) / 7;                    // a ring every 7 cm, moving towards you
      const k = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * pos), 10);
      return mul(hue(Math.round(pos) * 47), 0.02 + k);
    },
  },

  // ---------------- around your line of sight: the tunnel spins ----------------
  vortex: {
    name: '🌀 Draaikolk',
    desc: 'Drie gedraaide lichtarmen wervelen om je kijkrichting en draaien de diepte in. '
      + 'In de spiegels wordt het een eindeloze draaikolk.',
    fn: (l, t) => {
      const ph = 3 * spin(l) + depth(l) * 0.35 - t * 3;
      const arm = Math.pow(0.5 + 0.5 * Math.cos(ph), 5);
      return mul(hue(250 + 70 * Math.sin(t * 0.3) + depth(l) * 5), 0.02 + arm);
    },
  },
  candyCane: {
    name: '⚕ Zuurstok-tunnel',
    desc: 'Schuine rood-witte banden draaien om je kijkrichting, zoals de staf van de Sint. '
      + 'De spiegels maken er een eindeloze draaiende zuurstok van.',
    fn: (l, t) => {
      const f = Math.sin(2 * spin(l) + depth(l) * 0.35 - t * 2.2);
      return mix(mul(WHITE, 0.75), RED, smooth(-0.35, 0.35, f));
    },
  },
  kaleidoscope: {
    name: '❖ Caleidoscoop',
    desc: 'Zes taartpunten in twee kleuren draaien om je kijkrichting en wisselen langzaam van kleur. '
      + 'De spiegels vouwen ze tot een reusachtige caleidoscoop.',
    fn: (l, t) => {
      const a = spin(l) + t * 0.6 + Math.sin(t * 0.4) * depth(l) * 0.06;
      const s = Math.sin(3 * a);                                 // 6 sectors
      const edge = smooth(0, 0.25, Math.abs(s));                 // dark seams between the sectors
      const c = s > 0 ? hue(t * 25) : hue(t * 25 + 150);
      return mul(c, 0.03 + edge);
    },
  },

  // ---------------- events: big moments ----------------
  beatDrop: {
    name: '🔊 Beat drop (128 BPM)',
    desc: 'Als een dansvloer: een drop met kleurflitsen op elke tel, dan een groove met een looplicht, '
      + 'dan een roffel die steeds sneller flitst tot de volgende drop.',
    fn: (l, t, all) => {
      const n = all.length, b = (t * 128) / 60, ph = b % 32, f = frac(b), beat = Math.floor(b);
      if (ph < 8) {                                        // drop: every beat a new colour, halves alternate
        const side = (l.i + beat) % 2 ? 1 : 0.3;
        const k = Math.exp(-f * 4) * side;
        return mix(mul(hue(hash(beat) * 360), 0.03 + k), WHITE, Math.exp(-f * 25));
      }
      if (ph < 24) {                                       // groove: kick + running light along the strip
        const kick = Math.exp(-f * 6) * 0.35;
        const k = chase(l.i, b * (n / 8), n, 0.5, 0.45);
        return mul(hue(190 + (ph - 8) * 8), 0.02 + kick + k);
      }
      const rate = Math.pow(2, 1 + Math.floor((ph - 24) / 2));   // roll: 2, 4, 8, 16 flashes per beat
      const on = Math.exp(-frac(b * rate) * 7);
      return mul(mix(hue(330), WHITE, (ph - 24) / 8), 0.02 + on);
    },
  },
  lightning: {
    name: '⚡ Bliksem',
    desc: 'Een bliksemschicht slaat in op een willekeurige LED en vertakt zich razendsnel van lampje naar lampje. '
      + 'In de spiegels flitst een onweer door een eindeloze ruimte.',
    fn: (l, t, all) => {
      const P = 1.4, strike = Math.floor(t / P), age = t - strike * P;
      const seed = Math.floor(hash(strike * 1.37) * all.length);
      const h = ledGraph(all).hops(seed)[l.i];
      const front = age * 30;                                    // hops per second
      if (!(h <= front)) return mul(VIOLET, 0.015);
      const flicker = 0.55 + 0.45 * Math.sin(age * 90 + l.i * 2.3);
      const k = Math.exp(-(front - h) * 0.22) * Math.exp(-age * 2.2) * flicker;
      return mix(mul(VIOLET, 0.015 + k), WHITE, Math.min(1, k * 0.8));
    },
  },
  supernova: {
    name: '💥 Supernova',
    desc: 'Alles dooft, één ster gloeit steeds heter op… en ontploft: een witte flits en een '
      + 'regenbooggolf die door de hele kubus en alle spiegelbeelden rolt.',
    fn: (l, t, all) => {
      const T = 9, ph = frac(t / T) * T, cycle = Math.floor(t / T);
      const src = all[Math.floor(hash(cycle * 2.1 + 0.5) * all.length)];
      if (ph < 4) {                                              // collapse: the rest fades out
        if (l === src) return mul(mix(RED, WHITE, ph / 4), 0.15 + (ph / 4) * 1.3);
        return mul(l.base, 0.12 * (1 - ph / 4));
      }
      const age = ph - 4, d = dist(l.p, src.p);
      const shell = d - age * 16;
      const k = Math.exp(-(shell * shell) / 14) * Math.exp(-age * 0.45);
      return mix(mul(hue(d * 9 + age * 60), 0.02 + k), WHITE, Math.exp(-age * 4));
    },
  },
  fireworks: {
    name: '🎆 Vuurwerk',
    desc: 'Op willekeurige LEDs ontploft een kleur die als een schokgolf over de kubus uitdooft.',
    fn: (l, t, all) => {
      const period = 0.7;
      let c = [0, 0, 0];
      const now = Math.floor(t / period);
      for (let j = now - 3; j <= now; j++) {
        const age = t - j * period;
        if (age < 0) continue;
        const src = all[Math.floor(hash(j) * all.length)].p;
        const ring = dist(l.p, src) - age * 22;
        const k = Math.exp(-(ring * ring) / 10) * Math.exp(-age * 1.4);
        c = add(c, mul(hue(hash(j + 7) * 360), k));
      }
      return cap(c);
    },
  },

  // ---------------- objects that fly through the space ----------------
  dnaHelix: {
    name: '🧬 Dubbele helix',
    desc: 'Twee strengen, cyaan en koraal, draaien om je kijkrichting en schroeven zich naar je toe, '
      + 'met witte sporten ertussen. In de spiegels een eindeloze DNA-tunnel.',
    fn: (l, t) => {
      const z = depth(l) - t * 6;                                  // pattern moves towards you
      const a = z * 0.4 - t * 0.8;                                  // strand angle at this depth
      const dA = wrapPi(spin(l) - a), dB = wrapPi(spin(l) - a - Math.PI);
      const kA = Math.exp(-(dA * dA) / 0.18), kB = Math.exp(-(dB * dB) / 0.18);
      const rung = 0.6 * Math.pow(Math.max(0, Math.cos((Math.PI * z) / 2.5)), 24);
      return cap(add(add(mul(CYAN, kA), mul(CORAL, kB)), mul(WHITE, rung + 0.015)));
    },
  },
  orbits: {
    name: '🪐 Planetenbanen',
    desc: 'Drie gloeiende planeten (oranje, cyaan, magenta) cirkelen op verschillende diepte en snelheid '
      + 'om je kijkrichting, elk met een komeetstaart. De spiegels vullen de ruimte met hele zonnestelsels.',
    fn: (l, t) => {
      let c = [0.01, 0.01, 0.02];
      [[ORANGE, 1.6, 4, 0], [CYAN, -1.1, 10, 2.1], [MAGENTA, 2.3, 16, 4.2]].forEach(([col, w, d0, ph]) => {
        const ang = t * w + ph;
        const dz = depth(l) - (d0 + 3 * Math.sin(t * 0.5 + ph));     // planet bobs in depth
        const da = wrapPi(spin(l) - ang) * Math.sign(w);              // > 0: ahead of the planet
        const k = (da <= 0 ? Math.exp(da * 2.2) : Math.exp(-(da * da) / 0.03)) * Math.exp(-(dz * dz) / 14);
        c = add(c, mul(col, k));
      });
      return cap(c);
    },
  },
  bouncingBall: {
    name: '🏓 Stuiterbal',
    desc: 'Een lichtbal stuitert met een staart door de kubus tegen de spiegels; bij elke botsing een nieuwe kleur. '
      + 'Je ziet een heel leger ballen in perfecte formatie stuiteren.',
    fn: (l, t) => {
      const tri = (u) => 1 - 2 * Math.abs(frac(u) - 0.5);           // 0..1..0, bounces at the ends
      const at = (s) => [-9 + 18 * tri(s * 0.29 + 0.1), -9 + 18 * tri(s * 0.37 + 0.4), -9 + 18 * tri(s * 0.21 + 0.7)];
      const bounces = Math.floor(2 * (t * 0.29 + 0.1)) + Math.floor(2 * (t * 0.37 + 0.4)) + Math.floor(2 * (t * 0.21 + 0.7));
      const col = hue(bounces * 67 + 80);
      let k = 0;
      for (let j = 0; j < 10; j++) {                                // trail: where the ball was
        const r = dist(l.p, at(t - j * 0.08));
        k = Math.max(k, Math.exp(-(r * r) / 40) * Math.exp(-j * 0.3));
      }
      return mul(col, 0.02 + k);
    },
  },
  meteors: {
    name: '🌠 Meteorenregen',
    desc: 'Meteoren met een gouden kop en een blauwe staart schieten kriskras door de kubus, '
      + 'elk in een andere richting. De spiegels maken er een meteorenregen zonder einde van.',
    fn: (l, t) => {
      const period = 0.4, now = Math.floor(t / period);
      let c = [0.005, 0.007, 0.02];
      for (let j = now - 4; j <= now; j++) {
        const age = t - j * period;
        if (age < 0) continue;
        // random line through the cube: start outside, aim near the centre
        const th = hash(j * 1.3) * 2 * Math.PI, ph = Math.acos(2 * hash(j * 2.7) - 1);
        const start = [14 * Math.sin(ph) * Math.cos(th), 14 * Math.cos(ph), 14 * Math.sin(ph) * Math.sin(th)];
        const aim = [6 * hash(j + 0.1) - 3, 6 * hash(j + 0.2) - 3, 6 * hash(j + 0.3) - 3];
        const len = dist(aim, start), dir = [0, 1, 2].map((i) => (aim[i] - start[i]) / len);
        const rel = [0, 1, 2].map((i) => l.p[i] - start[i]);
        const s = dot(rel, dir), head = age * 32;
        const r2 = dot(rel, rel) - s * s;
        const behind = head - s;                                     // > 0: in the tail
        if (behind < -2 || behind > 18) continue;
        const along = behind >= 0 ? Math.exp(-behind / 5) : Math.exp(-(behind * behind) / 0.8);
        const k = along * Math.exp(-r2 / 22);
        c = add(c, mul(mix(GOLD, ICE, Math.min(1, Math.max(0, behind) / 6)), k));
      }
      return cap(c);
    },
  },

  // ---------------- flowing colour ----------------
  aurora: {
    name: '🌌 Noorderlicht',
    desc: 'Golvende gordijnen van groen, turquoise en violet licht bewegen langzaam om je heen en de diepte in, '
      + 'als het noorderlicht in een eindeloze zaal.',
    fn: (l, t) => {
      const a = spin(l), z = depth(l);
      const curtain = 0.5 + 0.5 * Math.sin(3 * a + 2 * Math.sin(t * 1.1 + z * 0.3) - t * 1.4);
      const ripple = 0.5 + 0.5 * Math.sin(z * 0.5 + t * 2 + a * 2);
      const k = Math.pow(curtain, 3) * (0.35 + 0.65 * ripple);
      const tint = 0.5 + 0.5 * Math.sin(z * 0.25 + t * 0.35 + a);
      return mul(tint < 0.5 ? mix(AURORA_GREEN, TEAL, tint * 2) : mix(TEAL, VIOLET, tint * 2 - 1), 0.02 + k);
    },
  },
  lavaLamp: {
    name: '🫧 Lavalamp',
    desc: 'Grote zachte blobs in magenta en oranje zweven langzaam op en neer door de kubus en smelten samen. '
      + 'Rustig, maar de hele spiegelruimte beweegt mee.',
    fn: (l, t) => {
      let field = 0;
      for (let k = 0; k < 4; k++) {
        const c = [6 * Math.sin(t * (0.21 + 0.06 * k) + k * 1.7), 9 * Math.sin(t * (0.34 + 0.08 * k) + k * 2.3),
          6 * Math.cos(t * (0.18 + 0.05 * k) + k)];
        const r = dist(l.p, c);
        field += 30 / (r * r + 4);
      }
      const k = smooth(0.8, 2.2, field);
      const h = (l.p[1] + 10) / 20;                                    // warmer at the bottom
      return mix([0.05, 0.0, 0.08], mix(ORANGE, MAGENTA, h), k);
    },
  },

  // ---------------- living things ----------------
  sea: {
    name: '🌊 Klotsende zee',
    desc: 'Een zee klotst heen en weer door de kubus: diepblauw onderin, turquoise met lichtschittering vlak onder '
      + 'het oppervlak en een witte schuimrand op de golven. In de spiegels rolt een eindeloze oceaan.',
    fn: (l, t) => {
      const [x, y, z] = l.p;                                       // gravity: world y is up
      const level = -1.5 + 2.5 * Math.sin(t * 0.23);               // the tide rises and falls slowly
      const tilt = 0.45 * Math.sin(t * 1.05) * x + 0.35 * Math.sin(t * 0.8 + 1) * z;   // sloshing
      const waves = 0.9 * Math.sin(0.6 * x + 0.4 * z - 2.1 * t) + 0.5 * Math.sin(-0.5 * x + 0.7 * z - 1.5 * t);
      const d = y - (level + tilt + waves);                        // < 0: under water
      const foam = Math.exp(-(d * d) / 0.9);
      if (d > 0) return add(mul(FOAM, foam), [0.004, 0.012, 0.03]);  // above: dark, foam at the edge
      const deep = Math.min(1, -d / 12);                           // 0 at the surface, 1 deep down
      const caustic = 0.25 * Math.pow(0.5 + 0.5 * Math.sin(1.3 * x - 0.9 * z + 3 * t + Math.sin(2.3 * t + y)), 3);
      const water = mix(TEAL, DEEP_BLUE, deep);
      return cap(add(mul(water, 0.18 + 0.55 * (1 - deep) + caustic * (1 - deep)), mul(FOAM, foam)));
    },
  },
  swarm: {
    name: '✨ Zwerm vuurvliegjes',
    desc: 'Zeven vuurvliegjes vliegen als een zwerm door de kubus: ze volgen een leider, slingeren om elkaar heen '
      + 'en knipperen elk in hun eigen ritme. Af en toe schrikt de zwerm uiteen en komt weer samen. '
      + 'De spiegels maken er een reusachtige zwerm van.',
    fn: (l, t) => {
      // leader: a smooth path that stays inside the cube
      const lead = (s) => [
        8 * Math.tanh(1.3 * Math.sin(s * 0.37) + 0.5 * Math.sin(s * 0.91 + 1)),
        8 * Math.tanh(1.3 * Math.sin(s * 0.29 + 2) + 0.5 * Math.sin(s * 0.77)),
        8 * Math.tanh(1.3 * Math.sin(s * 0.33 + 4) + 0.5 * Math.sin(s * 0.83 + 3)),
      ];
      const scatter = Math.pow(Math.max(0, Math.sin((t * 2 * Math.PI) / 13)), 6);   // every 13 s
      let c = [0.004, 0.006, 0.004];
      for (let k = 0; k < 7; k++) {
        const s = 1.8 * t - k * 0.45;                              // followers fly where the leader was
        const base = lead(s);
        const spread = 1.6 + 7 * scatter;
        const p = [
          base[0] + spread * Math.sin(s * (1.7 + 0.3 * k) + k * 2.1),
          base[1] + spread * Math.sin(s * (1.3 + 0.25 * k) + k * 1.3),
          base[2] + spread * Math.cos(s * (1.5 + 0.2 * k) + k * 0.7),
        ].map((v) => Math.max(-9, Math.min(9, v)));
        const blink = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * (2.2 + hash(k) * 2) + k * 4), 4);
        const r = dist(l.p, p);
        c = add(c, mul(mix(FIREFLY, GOLD, hash(k + 5)), Math.exp(-(r * r) / 16) * blink));
      }
      return cap(c);
    },
  },

  // ---------------- along the strip ----------------
  helixComets: {
    name: '☄ Kometen langs de strip',
    desc: 'Drie gekleurde kometen met een lange staart volgen de strip van lampje naar lampje. '
      + 'Omdat de strip kriskras door de kubus loopt, schieten ze alle kanten op door de spiegelwereld.',
    fn: (l, t, all) => {
      const n = all.length;
      let c = mul(l.base, 0.015);
      for (let j = 0; j < 3; j++) {
        c = add(c, mul(hue(j * 120 + t * 12), chase(l.i, t * 7 + (j * n) / 3, n, 0.7, 0.4)));
      }
      return cap(c);
    },
  },

  // ---------------- calm ----------------
  twinkle: {
    name: '✨ Sterrenhemel',
    desc: 'Elke LED fonkelt op zijn eigen moment, warm-wit. Door de spiegels lijkt het een sterrenhemel zonder einde.',
    fn: (l, t) => {
      const f = 0.6 + hash(l.i) * 1.6, ph = hash(l.i + 50) * 6.283;
      return mul(WHITE, 0.05 + Math.pow(Math.max(0, Math.sin(t * f + ph)), 16));
    },
  },
  static: {
    name: 'Vast (basiskleur)',
    desc: 'Alle LEDs branden constant in de basiskleur.',
    fn: (l) => l.base,
  },
};

/** One selectable effect. */
export class Effect {
  constructor(key, { name, desc, fn }) {
    this.key = key;
    this.name = name;
    this.desc = desc;
    this.colorOf = fn;
  }
}

/** All effects, by key, plus applying the chosen one to a set of lights. */
export class EffectLibrary {
  constructor() {
    this.effects = new Map(Object.entries(EFFECT_DEFS).map(([k, d]) => [k, new Effect(k, d)]));
  }

  get defaultKey() { return 'showreel'; }

  get(key) { return this.effects.get(key) || this.effects.get('static'); }

  [Symbol.iterator]() { return this.effects.values(); }

  /**
   * Sets l.c for every light at effect time t. LEDs on the face with the peephole sit right
   * next to your eye and look huge; settings.frontDim dims them.
   */
  apply(lights, t, settings) {
    const fx = this.get(settings.effect);
    lights.forEach((l) => { l.v = settings.frame.toView(l.p); });
    lights.forEach((l) => {
      const k = l.v[2] > 0.85 * faceDist(l.p) ? settings.frontDim : 1;
      l.c = fx.colorOf(l, t, lights).map((v) => Math.max(0, v) * k);
    });
  }
}
