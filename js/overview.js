// Small 2D canvas sketches in the settings panel.

import { H } from './geometry.js';
import { spacingPositions } from './layouts.js';

/** 3D sketch of the cube with the LEDs (live colours), the strip, the peephole and view direction. */
export class OverviewSketch {
  // the 12 cube edges as [from, to]
  static EDGES = (() => {
    const out = [];
    for (let along = 0; along < 3; along++) {
      const [a, b] = [0, 1, 2].filter((k) => k !== along);
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const p = [0, 0, 0], q = [0, 0, 0];
        p[a] = q[a] = sa * H; p[b] = q[b] = sb * H;
        p[along] = -H; q[along] = H;
        out.push({ p, q, top: p[1] > 0 && q[1] > 0 });
      }
    }
    return out;
  })();

  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  #project([x, y, z]) {
    const W = this.canvas.width, Hh = this.canvas.height;
    const ay = -0.6, ax = 0.45, sc = 6.2;
    const x1 = x * Math.cos(ay) + z * Math.sin(ay);
    const z1 = -x * Math.sin(ay) + z * Math.cos(ay);
    const y1 = y * Math.cos(ax) - z1 * Math.sin(ax);
    const z2 = y * Math.sin(ax) + z1 * Math.cos(ax);
    return [W / 2 + x1 * sc, Hh / 2 + 6 - y1 * sc, z2];
  }

  draw(s, fwd, lights) {
    const ctx = this.ctx, W = this.canvas.width, Hh = this.canvas.height;
    const proj = (p) => this.#project(p);
    ctx.clearRect(0, 0, W, Hh);

    // cube edges (lid edges dashed when the lid is off)
    OverviewSketch.EDGES.forEach((e) => {
      const pa = proj(e.p), pb = proj(e.q);
      const open = e.top && s.lid;
      ctx.strokeStyle = open ? 'rgba(255,255,255,.18)' : 'rgba(200,210,230,.55)';
      ctx.setLineDash(open ? [4, 4] : []);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    });
    ctx.setLineDash([]);

    // peephole face tint
    const fc = [[-H, -H, H], [H, -H, H], [H, H, H], [-H, H, H]].map((p) => proj(s.frame.fromView(p)));
    ctx.fillStyle = 'rgba(120,160,255,.07)';
    ctx.beginPath(); fc.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath(); ctx.fill();

    // LED strip wire (in strip order)
    if (lights.length && lights[0].strip) {
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      lights.forEach((l, i) => {
        const q = proj(l.p);
        if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
      });
      ctx.stroke();
      const a = proj(lights[0].p);
      ctx.fillStyle = '#9a97a8'; ctx.font = '10px system-ui';
      ctx.fillText('start', a[0] + 5, a[1] + 10);
    }

    // LEDs, back to front; live colour * intensity (dark = dimmed by the effect)
    const r = lights.length > 40 ? 2.5 : 4;
    lights.map((l) => ({ l, q: proj(l.p) }))
      .sort((a, b) => a.q[2] - b.q[2])
      .forEach(({ l, q }) => {
        const c = l.c.map((v) => Math.round(Math.min(1, v) * 255));
        ctx.fillStyle = l.on ? `rgb(${c})` : '#222';
        ctx.shadowColor = l.on ? `rgb(${c})` : 'transparent';
        ctx.shadowBlur = l.on ? 8 : 0;
        ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });
    ctx.shadowBlur = 0;

    // peephole + view direction
    const hp = proj(s.frame.holeWorld);
    const tip = proj(s.frame.fromView([s.hole[0] + fwd[0] * 8, s.hole[1] + fwd[1] * 8, H + fwd[2] * 8]));
    ctx.strokeStyle = '#7fd4ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hp[0], hp[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#7fd4ff';
    ctx.beginPath(); ctx.arc(hp[0], hp[1], 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9a97a8'; ctx.font = '11px system-ui';
    ctx.fillText(s.frame.inLid ? 'kijkgat (deksel)' : 'kijkgat (voorkant)', 8, Hh - 10);
    if (!s.frame.inLid) ctx.fillText(s.lid ? 'deksel eraf' : 'deksel = spiegel', W - 100, 16);
  }
}

/** One edge drawn flat, showing where the LEDs go for the chosen spacing (free layout). */
export class SpacingPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(s) {
    const ctx = this.ctx, W = this.canvas.width, Hh = this.canvas.height, pad = 14;
    ctx.clearRect(0, 0, W, Hh);
    const x = (t) => pad + ((t + H) / (2 * H)) * (W - 2 * pad);
    ctx.strokeStyle = 'rgba(200,210,230,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x(-H), Hh / 2); ctx.lineTo(x(H), Hh / 2); ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,230,.55)';
    [x(-H), x(H)].forEach((px) => ctx.fillRect(px - 1, Hh / 2 - 7, 2, 14));
    spacingPositions(s.perEdge, s.spacing, s.inset).forEach((t, i) => {
      const col = s.palette.colorOf(i, s.perEdge).map((v) => Math.round(v * 255));
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
}
