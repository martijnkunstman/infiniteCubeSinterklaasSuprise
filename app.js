// Infinity Cube Viewer
// Ray tracer (WebGL fragment shader) for a 20 cm mirror cube seen through a peephole.
// Coordinates in cm. Cube interior spans -10..10 on every axis.
//   +x = right, +y = up (lid), +z = front (the face with the peephole).

(() => {
  'use strict';

  const H = 10;               // half the cube size (cm)
  const MAX_BOUNCES = 8;

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
  function buildLights(s) {
    const lights = [];
    const ts = spacingPositions(s.perEdge, s.spacing, s.inset);
    const d = H - s.inset;
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
    lights.forEach((l, i) => { l.c = lightColor(i, lights.length); });
    return lights;
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  const overview = $('overview');
  const octx = overview.getContext('2d');

  const ui = {};
  ['bounces', 'atten', 'bright', 'glow', 'led', 'inset', 'perEdge', 'holeX', 'holeY', 'holeD',
    'eye', 'fov', 'seam', 'amb'].forEach((id) => { ui[id] = $(id); });

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
      faces: $('faces').checked,
      hole: [v('holeX'), v('holeY')],
      holeR: v('holeD') / 2,
      eye: v('eye'),
      fov: v('fov'),
      seam: v('seam'),
      amb: v('amb'),
      lid: $('lid').checked,    };
  }

  // ---------- Render ----------
  let dirty = true;
  let lowQuality = false;     // 1 sample per pixel while dragging, 4 when idle
  const requestRender = () => { dirty = true; };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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
    const active = lights.filter((l) => l.on).slice(0, MAX_LIGHTS);
    lightData.fill(0);
    active.forEach((l, i) => {
      lightData.set([...l.p, 1], i * 4);                       // row 0
      lightData.set([...l.c, 1], (MAX_LIGHTS + i) * 4);        // row 1
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, lightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAX_LIGHTS, 2, 0, gl.RGBA, gl.FLOAT, lightData);
    gl.uniform1i(U.uCount, active.length);
    gl.uniform1i(U.uAA, lowQuality ? 1 : 2);

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

  function loop() {
    resize();
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
    // front face tint
    const fc = [[-H, -H, H], [H, -H, H], [H, H, H], [-H, H, H]].map(proj);
    octx.fillStyle = 'rgba(120,160,255,.07)';
    octx.beginPath(); fc.forEach((p, i) => (i ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1])));
    octx.closePath(); octx.fill();
    // LEDs
    const r = lights.length > 40 ? 2.5 : 4;
    lights.map((l) => ({ l, q: proj(l.p) }))
      .sort((a, b) => a.q[2] - b.q[2])
      .forEach(({ l, q }) => {
        const c = l.c.map((v) => Math.round(v * 255));
        octx.fillStyle = l.on ? `rgb(${c})` : '#333';
        octx.shadowColor = l.on ? `rgb(${c})` : 'transparent';
        octx.shadowBlur = l.on ? 8 : 0;
        octx.beginPath(); octx.arc(q[0], q[1], r, 0, Math.PI * 2); octx.fill();
      });
    octx.shadowBlur = 0;
    // peephole + view direction
    const hp = proj([s.hole[0], s.hole[1], H]);
    const tip = proj([s.hole[0] + fwd[0] * 8, s.hole[1] + fwd[1] * 8, H + fwd[2] * 8]);
    octx.strokeStyle = '#7fd4ff'; octx.lineWidth = 2;
    octx.beginPath(); octx.moveTo(hp[0], hp[1]); octx.lineTo(tip[0], tip[1]); octx.stroke();
    octx.fillStyle = '#000'; octx.strokeStyle = '#7fd4ff';
    octx.beginPath(); octx.arc(hp[0], hp[1], 4, 0, Math.PI * 2); octx.fill(); octx.stroke();
    octx.fillStyle = '#9a97a8'; octx.font = '11px system-ui';
    octx.fillText('kijkgat (voorkant)', 8, Hh - 10);
    octx.fillText(s.lid ? 'deksel eraf' : 'deksel = spiegel', W - 100, 16);
  }

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
  $('shot').addEventListener('click', () => {
    render();
    const a = document.createElement('a');
    a.download = 'infinity-cube.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  });
  window.addEventListener('resize', requestRender);

  buildEdgeList();
  buildFaceList();
  updateLabels();
  loop();
})();
