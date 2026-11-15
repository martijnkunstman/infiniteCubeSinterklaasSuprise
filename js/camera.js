// Look direction from the peephole (view frame: straight ahead = -z).

const LIMIT = 85 * Math.PI / 180;

export class Camera {
  constructor() {
    this.reset();
  }

  reset() {
    this.yaw = 0;
    this.pitch = 0;
  }

  /** Turn by an angle in radians (dragging); clamped so you can't look back out of the hole. */
  rotate(dYaw, dPitch) {
    this.yaw = Math.max(-LIMIT, Math.min(LIMIT, this.yaw + dYaw));
    this.pitch = Math.max(-LIMIT, Math.min(LIMIT, this.pitch + dPitch));
  }

  basis() {
    const cp = Math.cos(this.pitch);
    const fwd = [Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
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
}
