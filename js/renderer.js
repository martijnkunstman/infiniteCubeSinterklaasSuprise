// WebGL ray tracer for the mirror cube, seen through the peephole.
// Works in the view frame (peephole face = +z); light positions are converted on upload.

import { H, MAX_BOUNCES, MAX_LIGHTS } from './geometry.js';

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

export class WebGLUnavailableError extends Error {}

export class MirrorRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new WebGLUnavailableError('WebGL is niet beschikbaar in deze browser.');
    if (!gl.getExtension('OES_texture_float')) {
      throw new WebGLUnavailableError('Deze browser ondersteunt geen float-textures (OES_texture_float).');
    }
    this.gl = gl;
    this.#setupProgram();
    this.#setupLightTexture();
  }

  #compile(type, src) {
    const { gl } = this;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  #setupProgram() {
    const { gl } = this;
    const prog = gl.createProgram();
    gl.attachShader(prog, this.#compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, this.#compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    // one big triangle covering the screen
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    ['uRes', 'uEye', 'uRight', 'uUp', 'uFwd', 'uTanHalf', 'uHole', 'uHoleR', 'uLedR', 'uBright',
      'uGlow', 'uAtten', 'uBounces', 'uLights', 'uCount', 'uAA', 'uLid', 'uSeam', 'uAmb']
      .forEach((n) => { this.u[n] = gl.getUniformLocation(prog, n); });
  }

  // Light data lives in a float texture (MAX_LIGHTS x 2) so we can have many LEDs.
  #setupLightTexture() {
    const { gl } = this;
    this.lightTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.uLights, 0);
    this.lightData = new Float32Array(MAX_LIGHTS * 2 * 4);
  }

  /** Match the canvas to its CSS size times `dpr`; returns true when it changed. */
  resize(dpr) {
    const c = this.canvas;
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width === w && c.height === h) return false;
    c.width = w; c.height = h;
    return true;
  }

  /** Draw one frame. `aa` = samples per pixel side (1 or 2). */
  render(s, lights, camera, aa) {
    const { gl, u, canvas } = this;
    const { fwd, right, up } = camera.basis();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform3f(u.uEye, s.hole[0], s.hole[1], H + s.eye);
    gl.uniform3fv(u.uRight, right);
    gl.uniform3fv(u.uUp, up);
    gl.uniform3fv(u.uFwd, fwd);
    // FOV applies to the widest side of the screen
    gl.uniform1f(u.uTanHalf, Math.tan((s.fov * Math.PI / 180) / 2) * Math.min(1, canvas.height / canvas.width));
    gl.uniform2f(u.uHole, s.hole[0], s.hole[1]);
    gl.uniform1f(u.uHoleR, s.holeR);
    gl.uniform1f(u.uLedR, s.ledR);
    gl.uniform1f(u.uBright, s.bright);
    gl.uniform1f(u.uGlow, s.glow);
    gl.uniform1f(u.uAtten, s.atten);
    gl.uniform1i(u.uBounces, s.bounces);
    gl.uniform1f(u.uLid, s.lid ? 1 : 0);
    gl.uniform1f(u.uSeam, s.seam);
    gl.uniform1f(u.uAmb, s.amb);

    const active = lights.filter((l) => l.on).slice(0, MAX_LIGHTS);
    const data = this.lightData;
    data.fill(0);
    active.forEach((l, i) => {
      data.set([...s.frame.toView(l.p), 1], i * 4);          // row 0: position (view frame)
      data.set([...l.c, 1], (MAX_LIGHTS + i) * 4);            // row 1: colour
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MAX_LIGHTS, 2, 0, gl.RGBA, gl.FLOAT, data);
    gl.uniform1i(u.uCount, active.length);
    gl.uniform1i(u.uAA, aa);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  toDataURL() { return this.canvas.toDataURL('image/png'); }
}
