// Browser twin of pipeline/smoke/trajectory.py. Same grid, same RK2 midpoint
// integration, same ensemble and same fire rule, so a click anywhere matches the
// pipeline's precomputed numbers (tests/traj.test.ts checks this on a fixture).

export interface Grid { lat0: number; lon0: number; dlat: number; dlon: number; nlat: number; nlon: number }

export interface TrajParams {
  hours: number;
  step_seconds: number;
  offsets: [number, number][];
  near_km: number;
  pass_before_fire_h: number;
  pass_after_fire_h: number;
}

export const M_PER_DEG = 111_195;

/** Hourly wind for a contiguous run of hours: data[hour][level][comp][lat][lon] in m/s. */
export class WindField {
  readonly t0: number;
  readonly nt: number;
  private readonly levelStride: number;
  private readonly hourStride: number;
  private readonly compStride: number;

  constructor(
    readonly grid: Grid,
    readonly levels: number,
    t0: number,
    readonly data: Float32Array,
  ) {
    this.t0 = t0;
    this.compStride = grid.nlat * grid.nlon;
    this.levelStride = 2 * this.compStride;
    this.hourStride = levels * this.levelStride;
    this.nt = Math.floor(data.length / this.hourStride);
  }

  /** Wind (u, v) m/s at a level, unix time and position; NaN outside the grid or time range. */
  sample(level: number, t: number, lat: number, lon: number): [number, number] {
    const g = this.grid;
    const fi = (lat - g.lat0) / g.dlat;
    const fj = (lon - g.lon0) / g.dlon;
    const ft = (t - this.t0) / 3600;
    if (!(fi >= 0 && fi <= g.nlat - 1 && fj >= 0 && fj <= g.nlon - 1 && ft >= 0 && ft <= this.nt - 1)) {
      return [NaN, NaN];
    }
    const i0 = Math.min(Math.floor(fi), g.nlat - 2);
    const j0 = Math.min(Math.floor(fj), g.nlon - 2);
    const k0 = Math.min(Math.floor(ft), this.nt - 2);
    const di = fi - i0, dj = fj - j0, dk = ft - k0;
    const out: [number, number] = [0, 0];
    for (let comp = 0; comp < 2; comp++) {
      const at = (k: number) => {
        const base = k * this.hourStride + level * this.levelStride + comp * this.compStride;
        const p = (i: number, j: number) => this.data[base + i * g.nlon + j];
        return p(i0, j0) * (1 - di) * (1 - dj) + p(i0 + 1, j0) * di * (1 - dj)
          + p(i0, j0 + 1) * (1 - di) * dj + p(i0 + 1, j0 + 1) * di * dj;
      };
      out[comp] = at(k0) * (1 - dk) + at(k0 + 1) * dk;
    }
    return out;
  }

  velocityDeg(level: number, t: number, lat: number, lon: number): [number, number] {
    const [u, v] = this.sample(level, t, lat, lon);
    return [v / M_PER_DEG, u / (M_PER_DEG * Math.cos((lat * Math.PI) / 180))];
  }
}

/** One ensemble member: hourly positions, NaN after leaving the grid. */
export interface Member { level: number; lat: Float64Array; lon: Float64Array }

export interface Trajectory {
  members: Member[];
  /** unix seconds per hourly point */
  times: Float64Array;
  direction: -1 | 1;
}

export function integrate(
  field: WindField, lat: number, lon: number, tStart: number, p: TrajParams, direction: -1 | 1,
): Trajectory {
  const steps = Math.round(3600 / p.step_seconds);
  const dt = direction * p.step_seconds;
  const members: Member[] = [];
  for (let level = 0; level < field.levels; level++) {
    for (const [dla, dlo] of p.offsets) {
      const la = new Float64Array(p.hours + 1).fill(NaN);
      const lo = new Float64Array(p.hours + 1).fill(NaN);
      let y = lat + dla, x = lon + dlo, t = tStart;
      la[0] = y; lo[0] = x;
      for (let h = 1; h <= p.hours; h++) {
        for (let s = 0; s < steps; s++) {
          const [a1, b1] = field.velocityDeg(level, t, y, x);
          const my = y + (a1 * dt) / 2, mx = x + (b1 * dt) / 2;
          const [a2, b2] = field.velocityDeg(level, t + dt / 2, my, mx);
          y += a2 * dt; x += b2 * dt; t += dt;
        }
        la[h] = y; lo[h] = x;
      }
      members.push({ level, lat: la, lon: lo });
    }
  }
  const times = new Float64Array(p.hours + 1);
  for (let h = 0; h <= p.hours; h++) times[h] = tStart + direction * 3600 * h;
  return { members, times, direction };
}

/**
 * Fraction of members passing within radiusKm of each object; with a window,
 * the air must pass from before_h hours before to after_h hours after tObj.
 */
export function nearPathWeights(
  traj: Trajectory, lat: ArrayLike<number>, lon: ArrayLike<number>, tObj: ArrayLike<number> | null,
  radiusKm: number, window: [number, number] | null,
): Float32Array {
  const n = lat.length;
  const w = new Float32Array(n);
  if (n === 0) return w;
  let sum = 0, cnt = 0;
  for (const m of traj.members) for (const v of m.lat) if (Number.isFinite(v)) { sum += v; cnt++; }
  const coslat = Math.cos(((cnt ? sum / cnt : 0) * Math.PI) / 180);
  const r2 = radiusKm * radiusKm;
  const hit = new Uint8Array(n);
  for (const m of traj.members) {
    hit.fill(0);
    for (let h = 0; h < m.lat.length; h++) {
      const py = m.lat[h], px = m.lon[h];
      if (!Number.isFinite(py)) continue;
      const tp = traj.times[h];
      for (let i = 0; i < n; i++) {
        if (hit[i]) continue;
        const dy = (lat[i] - py) * 111.195;
        const dx = (lon[i] - px) * 111.195 * coslat;
        if (dx * dx + dy * dy > r2) continue;
        if (window && tObj) {
          const dh = (tp - tObj[i]) / 3600;
          if (dh < -window[0] || dh > window[1]) continue;
        }
        hit[i] = 1;
      }
    }
    for (let i = 0; i < n; i++) w[i] += hit[i];
  }
  const k = traj.members.length;
  for (let i = 0; i < n; i++) w[i] /= k;
  return w;
}

export function fireWeights(traj: Trajectory, fires: { lat: Float32Array; lon: Float32Array; t: Float64Array }, p: TrajParams) {
  return nearPathWeights(traj, fires.lat, fires.lon, fires.t, p.near_km, [p.pass_before_fire_h, p.pass_after_fire_h]);
}

/** Great-circle-ish length of the central member, km. */
export function pathLengthKm(m: Member): number {
  let d = 0;
  for (let h = 1; h < m.lat.length; h++) {
    if (!Number.isFinite(m.lat[h])) break;
    const dy = (m.lat[h] - m.lat[h - 1]) * 111.195;
    const dx = (m.lon[h] - m.lon[h - 1]) * 111.195 * Math.cos((m.lat[h] * Math.PI) / 180);
    d += Math.hypot(dx, dy);
  }
  return d;
}
