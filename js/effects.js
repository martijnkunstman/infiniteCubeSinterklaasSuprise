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
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const RED = [1, 0.06, 0.05], GOLD = [1, 0.7, 0.12], WHITE = [1, 0.92, 0.8], ICE = [0.6, 0.8, 1];
const VIOLET = [0.55, 0.3, 1];

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
  ['warp', 8], ['vortex', 10], ['beatDrop', 15], ['lightning', 8.4],
  ['tunnelRush', 10], ['candyCane', 10], ['supernova', 9], ['kaleidoscope', 10], ['twinkle', 8],
];
const SHOW_FADE = 1.5;
const SHOW_TOTAL = SHOW.reduce((s, [, d]) => s + d, 0);

const EFFECT_DEFS = {
  showreel: {
    name: '★ Show (alle hoogtepunten achter elkaar)',
    desc: 'Warpsprong → draaikolk → beat drop → bliksem → tunnel → zuurstok → supernova → caleidoscoop → sterren. '
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
  rainbowRise: {
    name: '🌈 Regenboogschacht',
    desc: 'Kleurbanden schuiven langzaam vanuit de diepte naar je toe: een eindeloze schacht vol kleur.',
    fn: (l, t) => hue(depth(l) * 14 - t * 80),
  },
  rain: {
    name: '☄ Vallende sterren in de diepte',
    desc: 'Lichtdruppels met een staart vallen van jou weg de diepte in, elk in een eigen tempo.',
    fn: (l, t) => {
      const speed = 8 + hash(l.i) * 8;
      const y = 22 - (((t * speed + hash(l.i + 3) * 40) % 40) + 40) % 40;   // drop depth
      const dy = depth(l) - y;
      const k = dy >= 0 ? Math.exp(-dy / 2.5) : Math.exp(-(dy * dy) / 0.8);   // tail behind the drop
      return mul(ICE, 0.02 + k);
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
  lighthouse: {
    name: '🔦 Zoeklicht',
    desc: 'Een smalle bundel draait om je kijkrichting en veegt als een radar door de hele spiegelwereld.',
    fn: (l, t) => {
      const d = wrapPi(spin(l) - t * 1.8);
      return mul(mix(GOLD, WHITE, 0.4), 0.02 + Math.exp(-(d * d) / 0.12));
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
  fill: {
    name: '▮ Vullen en leeglopen',
    desc: 'De strip vult zich LED voor LED in regenboogkleuren en loopt daarna weer leeg.',
    fn: (l, t, all) => {
      const n = all.length;
      const c = (t * 10) % (2 * n);
      const k = c < n ? Math.min(1, Math.max(0, c - l.i)) : 1 - Math.min(1, Math.max(0, c - n - l.i));
      return mul(hue((l.i * 300) / n), 0.02 + k);
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
  heartbeat: {
    name: '❤ Hartslag',
    desc: 'Een dubbele rode klop die van het midden van de kubus naar buiten golft.',
    fn: (l, t) => {
      const r = Math.hypot(l.p[0], l.p[1], l.p[2]);
      const ph = ((t - r * 0.035) % 1.3 + 1.3) % 1.3;
      const beat = Math.exp(-Math.pow((ph - 0.1) / 0.06, 2)) + 0.6 * Math.exp(-Math.pow((ph - 0.32) / 0.06, 2));
      return mul(RED, 0.04 + beat);
    },
  },
  fire: {
    name: '🔥 Haardvuur',
    desc: 'Onrustig flakkerend oranje-rood, onderin het felst. Warm en gezellig voor pakjesavond.',
    fn: (l, t) => {
      const a = hash(l.i), b = hash(l.i + 9);
      const n = 0.5 + 0.25 * Math.sin(t * (7 + a * 5) + a * 20) + 0.25 * Math.sin(t * (13 + b * 7) + b * 30);
      const height = 1 - (l.p[1] + 10) / 20;          // 1 at the bottom, 0 at the top
      const k = Math.max(0, n * (0.35 + 0.65 * height));
      return mul(mix([1, 0.12, 0.02], [1, 0.62, 0.12], n), 0.1 + k);
    },
  },
  sint: {
    name: '🎁 Sint & Piet (rood / goud)',
    desc: 'Rood en goud wisselen elkaar zacht af, met af en toe een witte schittering.',
    fn: (l, t) => {
      const k = 0.5 + 0.5 * Math.sin(t * 1.5);
      const c = l.i % 2 ? mix(RED, GOLD, k) : mix(GOLD, RED, k);
      const slot = Math.floor(t * 5);
      const sparkle = hash(l.i * 13 + slot) > 0.94 ? 1 - (t * 5 - slot) : 0;
      return mix(c, WHITE, sparkle);
    },
  },
  breathe: {
    name: 'Ademen',
    desc: 'Alle LEDs zwellen langzaam samen aan en uit in de basiskleur. De hele tunnel ademt mee.',
    fn: (l, t) => mul(l.base, 0.08 + 0.92 * Math.pow(0.5 - 0.5 * Math.cos(t * 1.4), 2)),
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
