// The settings panel: reads all controls into one snapshot and keeps the value labels current.

import { MAX_PER_EDGE, ViewFrame } from './geometry.js';
import { Palette } from './color.js';

const $ = (id) => document.getElementById(id);

export class SettingsPanel {
  // slider id -> how its value is shown next to the label (element `${id}Out`)
  static SLIDERS = {
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

  constructor(root) {
    this.root = root;
    this.sliders = Object.fromEntries(Object.keys(SettingsPanel.SLIDERS).map((id) => [id, $(id)]));
  }

  num(id) { return parseFloat(this.sliders[id].value); }

  /** Calls `fn` whenever any control in the panel changes. */
  onChange(fn) {
    this.root.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', fn));
  }

  /** Field of view (degrees); the mouse wheel changes it too. */
  get fov() { return this.num('fov'); }

  set fov(v) { this.sliders.fov.value = v; }

  get speed() { return this.num('speed'); }

  get effect() { return $('effect').value; }

  /** All settings as one plain object (plus a ViewFrame and a Palette). */
  read() {
    const v = (id) => this.num(id);
    const holeFace = $('holeFace').value;
    const hole = [v('holeX'), v('holeY')];
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
      hole,
      holeR: v('holeD') / 2,
      eye: v('eye'),
      fov: v('fov'),
      seam: v('seam'),
      amb: v('amb'),
      holeFace,
      frame: new ViewFrame(holeFace, hole),
      lid: holeFace === 'front' && $('lid').checked,     // "lid off" only makes sense when looking in from the front
      effect: this.effect,
      speed: v('speed'),
      frontDim: v('frontDim') / 100,
      palette: new Palette($('colorMode').value, $('customColor').value),
    };
  }

  /** Value labels next to the sliders + which sub-panels are visible. */
  refresh(s) {
    Object.entries(SettingsPanel.SLIDERS).forEach(([id, fmt]) => {
      const out = $(`${id}Out`);
      if (out) out.textContent = fmt(this.sliders[id].value);
    });
    $('customWrap').hidden = $('colorMode').value !== 'custom';
    $('faceList').hidden = !s.faces;
    $('freeLayout').hidden = s.layout !== 'free';
    $('helixLayout').hidden = s.layout !== 'helix';
    $('spreadLayout').hidden = s.layout !== 'spread';
    $('lidWrap').hidden = s.frame.inLid;
    $('subTitle').textContent = 'Spiegelkubus 20 × 20 × 20 cm, gezien door een kijkgat in '
      + (s.frame.inLid ? 'het deksel.' : 'de voorkant.');
  }
}
