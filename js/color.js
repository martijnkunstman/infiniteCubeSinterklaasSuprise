// Colour helpers and the "Basiskleur" palette.

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/** Base colour of LED i out of `total`, for a colour mode from the settings. */
export class Palette {
  constructor(mode, custom) {
    this.mode = mode;
    this.custom = custom;
  }

  colorOf(i, total) {
    switch (this.mode) {
      case 'warm': return hexToRgb('#ffb066');
      case 'cool': return hexToRgb('#d6e6ff');
      case 'rainbow': return hslToRgb((i * 360) / total, 1, 0.55);
      case 'custom': return hexToRgb(this.custom);
      case 'sint':
      default: return i % 2 ? hexToRgb('#ffc23a') : hexToRgb('#ff2424');
    }
  }
}
