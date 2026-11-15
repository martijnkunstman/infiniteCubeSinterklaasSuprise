// Net (uitslag) of the cube: SVG drawing with the LED strip, a position table and the dialog.
// Inside view: the mirrors lie reflective side up, as if the cube is opened out flat.
// Walls sit in one row (voor, links, achter, rechts) so a strip running around the walls
// is one continuous line across the fold lines; the floor hangs under "voor", the lid sits
// above it. Units are cm; panel size = S = 2H = 20 cm.

import { H, S } from './geometry.js';

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
  const lidHole = s.frame.inLid;
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
  const hp = netPos(s.frame.holeWorld);
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

/** The net for a set of lights: SVG, explanation and position table. */
export class CubeNet {
  constructor(settings, lights) {
    this.s = settings;
    this.lights = lights;
    const { svg, pts, lidHasLeds } = buildNetSVG(settings, lights);
    this.svg = svg;
    this.pts = pts;
    this.lidHasLeds = lidHasLeds;
    this.isStrip = lights.some((l) => l.strip);
  }

  get note() {
    return (this.isStrip
      ? `De rode lijn is de LED-strip (${this.pts.length} LEDs). Over de vouwlijnen loopt hij gewoon door. `
        + 'Waar twee randen in de tekening niet tegen elkaar liggen maar in de kubus wel (bijvoorbeeld de buitenste '
        + 'randen van de rij, of bodem naar een zijwand), springt de lijn naar dezelfde letter. '
      : 'Deze indeling is geen doorlopende strip; de lampjes staan als losse punten getekend. ')
      + (this.lidHasLeds ? 'Let op: in deze indeling zitten er lampjes op het deksel.' : 'Het deksel heeft geen lampjes.');
  }

  /** Distance between two net points along the mirrors (same face, or over one fold). */
  static surfaceDistance(a, b) {
    if (a.panel === b.panel) return Math.hypot(a.X - b.X, a.Y - b.Y);
    const A = PANELS[a.panel], B = PANELS[b.panel];
    if (A.a === B.a) return NaN;
    const e = foldPoint(a.p, b.p, A, B);
    const ea = mapToPanel(e, a.panel), eb = mapToPanel(e, b.panel);
    return Math.hypot(ea.X - a.X, ea.Y - a.Y) + Math.hypot(eb.X - b.X, eb.Y - b.Y);
  }

  get tableHTML() {
    const rows = this.pts.map((q, i) => {
      const gap = this.isStrip && i > 0 ? CubeNet.surfaceDistance(this.pts[i - 1], q) : NaN;
      const slack = Number.isFinite(gap) ? this.s.stripGap - gap : 0;
      const gapTxt = Number.isFinite(gap)
        ? gap.toFixed(1) + (slack > 0.3 ? ` <span class="slack">(+${slack.toFixed(1)} bocht)</span>` : '') : '';
      return `<tr><td>${q.n}</td><td>${q.face}</td><td>${q.u.toFixed(1)}</td><td>${q.v.toFixed(1)}</td><td>${gapTxt}</td></tr>`;
    });
    return '<thead><tr><th>LED</th><th>Vlak</th><th>Vanaf linkerrand (cm)</th>'
      + '<th>Hoogte / vanaf voorwand (cm)</th><th>Afstand tot vorige LED (cm)</th></tr></thead><tbody>'
      + rows.join('') + '</tbody>';
  }
}

/** The modal that shows the net, with download and print. */
export class NetDialog {
  constructor(el) {
    this.el = el;                       // { modal, wrap, note, table, open, close, download, print }
    this.net = null;
    el.close.addEventListener('click', () => this.close());
    el.modal.addEventListener('click', (e) => { if (e.target === el.modal) this.close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen) this.close(); });
    el.print.addEventListener('click', () => window.print());
    el.download.addEventListener('click', () => this.download());
  }

  get isOpen() { return !this.el.modal.hidden; }

  show(net) {
    this.net = net;
    this.el.wrap.innerHTML = net.svg;
    this.el.note.textContent = net.note;
    this.el.table.innerHTML = net.tableHTML;
    this.el.modal.hidden = false;
    this.el.close.focus();
  }

  close() {
    this.el.modal.hidden = true;
    this.el.open.focus();
  }

  download() {
    if (!this.net) return;
    const blob = new Blob([this.net.svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.download = 'infinity-cube-uitslag.svg';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
