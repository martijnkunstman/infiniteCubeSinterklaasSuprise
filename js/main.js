// Infinity Cube Viewer: visualises a 20 cm mirror cube with LEDs, seen through a peephole.
// This module wires the parts together; see the other modules for the details.

import { Camera } from './camera.js';
import { EffectLibrary } from './effects.js';
import { LayoutRegistry, FreeLayout } from './layouts.js';
import { MirrorRenderer, WebGLUnavailableError } from './renderer.js';
import { OverviewSketch, SpacingPreview } from './overview.js';
import { SettingsPanel } from './settings.js';
import { VisibilityAnalyzer } from './visibility.js';
import { CubeNet, NetDialog } from './net.js';

const $ = (id) => document.getElementById(id);

class InfinityCubeApp {
  constructor() {
    this.canvas = $('view');
    this.settings = new SettingsPanel(document.querySelector('.panel'));
    this.layouts = new LayoutRegistry();
    this.effects = new EffectLibrary();
    this.camera = new Camera();
    this.renderer = new MirrorRenderer(this.canvas);
    this.overview = new OverviewSketch($('overview'));
    this.spacingPreview = new SpacingPreview($('spacingPreview'));
    this.netDialog = new NetDialog({
      modal: $('netModal'), wrap: $('netWrap'), note: $('netNote'), table: $('netTable'),
      open: $('openNet'), close: $('netClose'), download: $('netDownload'), print: $('netPrint'),
    });

    this.dirty = true;
    this.dragging = null;          // last pointer position while looking around
    this.fxTime = 0;               // effect time; advances with the speed slider, so it never jumps
    this.lastFrame = performance.now();
  }

  start() {
    this.#buildEffectList();
    this.#buildFaceList(this.layouts.free);
    this.#buildEdgeList(this.layouts.free);
    this.#bindEvents();
    this.updatePanel();
    requestAnimationFrame((t) => this.#loop(t));
  }

  requestRender() { this.dirty = true; }

  get animating() { return this.settings.effect !== 'static' && this.settings.speed > 0; }

  // ---------- panel ----------
  updatePanel() {
    const s = this.settings.read();
    this.settings.refresh(s);
    this.#updateLevels(s);
    $('layoutDesc').textContent = this.layouts.describe(s);
    $('effectDesc').textContent = this.effects.get(s.effect).desc;

    const lights = this.layouts.buildLights(s);
    const vs = VisibilityAnalyzer.analyse(s, lights);
    const nOn = lights.filter((l) => l.on).length;
    $('visScore').innerHTML = `Zichtbaarheid (${nOn} LEDs, t/m ${s.bounces} reflecties): `
      + `<b>${vs.distinct}</b> losse lichtpunten in beeld, `
      + `<b>${vs.images ? Math.round((100 * vs.overlapped) / vs.images) : 0}%</b> van de spiegelbeelden overlapt.`;
  }

  // brightness left after each reflection
  #updateLevels(s) {
    const rows = [];
    for (let b = 0; b <= 8; b++) {
      const pct = Math.pow(s.atten, b) * 100;
      const label = b === 0 ? 'Direct' : `${b}e reflectie`;
      rows.push(`<tr class="${b > s.bounces ? 'off' : ''}">
        <td>${label}</td>
        <td style="width:40%"><div class="bar" style="width:${pct}%"></div></td>
        <td>${pct.toFixed(0)}%</td></tr>`);
    }
    $('levels').innerHTML = rows.join('');
  }

  #buildEffectList() {
    const sel = $('effect');
    for (const fx of this.effects) sel.add(new Option(fx.name, fx.key));
    sel.value = this.effects.defaultKey;
  }

  #checkbox(box, item) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = item.on;
    cb.addEventListener('change', () => { item.on = cb.checked; this.requestRender(); });
    l.append(cb, item.name);
    box.appendChild(l);
  }

  #buildFaceList(free) {
    const box = $('faceList');
    free.faces.forEach((f) => this.#checkbox(box, f));
  }

  #buildEdgeList(free) {
    const box = $('edges');
    FreeLayout.EDGE_GROUPS.forEach((g) => {
      const h = document.createElement('h4');
      h.textContent = g;
      box.appendChild(h);
      free.edges.filter((e) => e.group === g).forEach((e) => this.#checkbox(box, e));
    });
  }

  // ---------- events ----------
  #bindEvents() {
    this.settings.onChange(() => { this.updatePanel(); this.requestRender(); });

    // look around by dragging
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const k = (this.settings.fov * Math.PI / 180) / c.clientHeight;
      this.camera.rotate((e.clientX - this.dragging.x) * k, -(e.clientY - this.dragging.y) * k);
      this.dragging = { x: e.clientX, y: e.clientY };
      this.requestRender();
    });
    const endDrag = () => { this.dragging = null; this.requestRender(); };
    c.addEventListener('pointerup', endDrag);
    c.addEventListener('pointercancel', endDrag);
    // zoom = change the field of view
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.settings.fov = Math.max(40, Math.min(140, this.settings.fov + Math.sign(e.deltaY) * 4));
      this.updatePanel();
      this.requestRender();
    }, { passive: false });

    $('resetView').addEventListener('click', () => { this.camera.reset(); this.requestRender(); });
    $('shot').addEventListener('click', () => {
      this.#render();
      const a = document.createElement('a');
      a.download = 'infinity-cube.png';
      a.href = this.renderer.toDataURL();
      a.click();
    });
    $('openNet').addEventListener('click', () => {
      const s = this.settings.read();
      this.netDialog.show(new CubeNet(s, this.layouts.buildLights(s)));
    });
    window.addEventListener('resize', () => this.requestRender());
  }

  // ---------- frame loop ----------
  #loop(now) {
    // rAF timestamps can be slightly older than performance.now(), so never step backwards
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.#resize();
    if (this.animating) {
      this.fxTime += dt * this.settings.speed;
      this.dirty = true;
    }
    if (this.dirty) { this.dirty = false; this.#render(); }
    requestAnimationFrame((t) => this.#loop(t));
  }

  // While an effect animates, render at a lower resolution so it stays smooth; the glow hides
  // the upscaling. A paused/static view renders sharp again.
  #resize() {
    const full = Math.min(window.devicePixelRatio || 1, 2);
    if (this.renderer.resize(this.animating ? Math.min(full, 0.6) : full)) this.requestRender();
  }

  #render() {
    const s = this.settings.read();
    const lights = this.layouts.buildLights(s);
    this.effects.apply(lights, this.fxTime, s);
    // 1 sample per pixel while dragging or animating, 2 x 2 when idle
    this.renderer.render(s, lights, this.camera, this.dragging || this.animating ? 1 : 2);
    this.overview.draw(s, this.camera.basis().fwd, lights);
    this.spacingPreview.draw(s);
  }
}

try {
  new InfinityCubeApp().start();
} catch (err) {
  if (!(err instanceof WebGLUnavailableError)) throw err;
  document.querySelector('.stage').innerHTML = `<p style="padding:24px">${err.message}</p>`;
}
