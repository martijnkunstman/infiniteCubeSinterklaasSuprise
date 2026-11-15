// Light effects: every LED gets its own colour + intensity per frame.
// Each effect maps (light, time, all lights) -> [r, g, b]; the length of the vector is the
// intensity (0 = off, 1 = full). Most effects use the LED's 3D position so they work for
// any number of LEDs and any layout.

import { faceDist, isCorner, onFace, dot } from './geometry.js';
import { hslToRgb } from './color.js';

const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hue = (h, l = 0.55) => hslToRgb(((h % 360) + 360) % 360, 1, l);
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const RED = [1, 0.06, 0.05], GOLD = [1, 0.7, 0.12], WHITE = [1, 0.92, 0.8], ICE = [0.6, 0.8, 1];
const DIM = 0.03;

// Axis of the main diagonal (back-left-bottom -> front-right-top) and a basis around it.
const DIAG_E1 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
const DIAG_E2 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];

// Showreel: these effects play one after the other, with a soft crossfade.
const SHOW = ['helixComets', 'candyCane', 'risingRings', 'fill', 'twinkle'];
const SHOW_T = 10, SHOW_FADE = 1.5;

// Running light: `pos` is the LED's place on a closed path of `n` steps, `head` the moving
// head. The LED fades in just before the head arrives and leaves a fading tail, so the eye
// sees smooth movement instead of blinking (phi phenomenon).
function chase(pos, head, n, fadeIn = 0.6, tail = 1.1) {
  let a = (((head - pos) % n) + n) % n;
  if (a > n - fadeIn) a -= n;
  return a < 0 ? Math.pow(1 + a / fadeIn, 2) : Math.exp(-a * tail);
}

const EFFECT_DEFS = {
  showreel: {
    name: '★ Spiraal-show (wisselt elke 10 s)',
    desc: 'Speelt achter elkaar: kometen langs de spiraal → zuurstok → stijgende ringen → vullen en leeglopen → sterren. '
      + 'Elke overgang vloeit zacht over.',
    fn: (l, t, all) => {
      const i = Math.floor(t / SHOW_T);
      const local = t - i * SHOW_T;
      const at = (j) => SHOW[((j % SHOW.length) + SHOW.length) % SHOW.length];   // also safe for t < 0
      const cur = EFFECT_DEFS[at(i)].fn(l, t, all);
      if (local < SHOW_T - SHOW_FADE) return cur;
      const next = EFFECT_DEFS[at(i + 1)].fn(l, t, all);
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
    lights.forEach((l) => {
      const k = settings.frame.toView(l.p)[2] > 0.85 * faceDist(l.p) ? settings.frontDim : 1;
      l.c = fx.colorOf(l, t, lights).map((v) => Math.max(0, v) * k);
    });
  }
}
