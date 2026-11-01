// Loads the pipeline's published files (see README "Data contract") with caching.
import { WindField, type Grid, type TrajParams } from "./traj.ts";

export interface City {
  id: string; name: string; lat: number; lon: number; stations: number[];
  summary: {
    days_measured: number; spearman_fires_vs_pm_obs?: number; spearman_detrended?: number;
    pm_obs_low_fire_days?: number; pm_obs_high_fire_days?: number; n_low_days?: number; n_high_days?: number;
    regions?: { code: string; name: string; share: number }[];
  };
}

export interface Manifest {
  generated_at: string;
  wind: { days: string[]; grid: Grid; levels: string[]; scale: number; nodata: number };
  fire_days: string[];
  latest_measured: string | null;
  trajectory: TrajParams;
  cities: City[];
  sources: { name: string; via: string; url: string; license?: string }[];
}

export interface Exposure {
  t: number[]; fires: (number | null)[]; frp: (number | null)[];
  pm_obs: (number | null)[]; pm_model: (number | null)[];
  stats: City["summary"] & {
    daily: { t: string[]; fires: (number | null)[]; pm_obs: (number | null)[]; pm_model: (number | null)[] };
    leaderboard: { i: number; name: string; region: string; share: number }[];
  };
}

export interface Fires {
  lat: Float32Array; lon: Float32Array; frp: Float32Array; t: Float64Array; n: Uint8Array; d: Int32Array;
}

export interface Stations {
  t0: number; hours: number;
  stations: { id: number; name: string; lat: number; lon: number }[];
  pm25: (number | null)[][];
}

export interface Towns { name: string[]; country: string[]; region: string[]; lat: number[]; lon: number[]; pop: number[] }

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

function getJSON<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path) as Promise<T>;
}

function getBin(path: string): Promise<ArrayBuffer> {
  if (!cache.has(path)) {
    cache.set(path, fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.arrayBuffer();
    }));
  }
  return cache.get(path) as Promise<ArrayBuffer>;
}

export const loadManifest = () => getJSON<Manifest>("manifest.json");
export const loadExposure = (city: string) => getJSON<Exposure>(`exposure/${city}.json`);
export const loadStations = () => getJSON<Stations>("stations.json");
export const loadTowns = () => getJSON<Towns>("towns.json");
export const loadDistricts = () => getJSON<GeoJSON.FeatureCollection>("districts.geojson");

const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

function daysCovering(t0: number, t1: number): string[] {
  const out: string[] = [];
  for (let t = dayStart(day(t0)); t <= t1; t += 86400) out.push(day(t));
  return out;
}

/**
 * Wind field covering [t0, t1] (unix s), stitched from daily files and clipped to
 * the published days (trajectories simply stop where the wind record ends).
 */
export async function windFor(m: Manifest, t0: number, t1: number): Promise<WindField | null> {
  const first = dayStart(m.wind.days[0]);
  const last = dayStart(m.wind.days[m.wind.days.length - 1]) + 86400 - 1;
  const days = daysCovering(Math.max(t0, first), Math.min(t1, last));
  if (!days.length || days.some((d) => !m.wind.days.includes(d))) return null;
  const bufs = await Promise.all(days.map((d) => getBin(`wind/${d}.bin`)));
  const per = bufs[0].byteLength / 2;
  const data = new Float32Array(per * bufs.length);
  bufs.forEach((b, k) => {
    const src = new Int16Array(b);
    const off = k * per;
    for (let i = 0; i < src.length; i++) {
      data[off + i] = src[i] === m.wind.nodata ? NaN : src[i] / m.wind.scale;
    }
  });
  return new WindField(m.wind.grid, m.wind.levels.length, dayStart(days[0]), data);
}

interface RawFires { lat: number[]; lon: number[]; frp: number[]; m: number[]; n: number[]; d: number[] }

/** All fires detected in [t0, t1], concatenated across daily files. */
export async function firesFor(m: Manifest, t0: number, t1: number): Promise<Fires> {
  const days = daysCovering(t0, t1).filter((d) => m.fire_days.includes(d));
  const parts = await Promise.all(days.map((d) => getJSON<RawFires>(`fires/${d}.json`).then((f) => ({ d, f }))));
  const n = parts.reduce((s, p) => s + p.f.lat.length, 0);
  const out: Fires = {
    lat: new Float32Array(n), lon: new Float32Array(n), frp: new Float32Array(n),
    t: new Float64Array(n), n: new Uint8Array(n), d: new Int32Array(n),
  };
  let k = 0;
  for (const { d, f } of parts) {
    const base = dayStart(d);
    for (let i = 0; i < f.lat.length; i++, k++) {
      out.lat[k] = f.lat[i]; out.lon[k] = f.lon[i]; out.frp[k] = f.frp[i];
      out.t[k] = base + f.m[i] * 60; out.n[k] = f.n[i]; out.d[k] = f.d[i];
    }
  }
  return out;
}

export function stationValueAt(s: Stations, idx: number, t: number): number | null {
  const h = Math.round((t - s.t0) / 3600);
  if (h < 0 || h >= s.hours) return null;
  return s.pm25[idx][h] ?? null;
}

export interface RuntimeConfig { region: string; apiKey: string; repoUrl?: string }

export async function loadConfig(): Promise<RuntimeConfig | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" });
    if (!r.ok) return null;
    const c = (await r.json()) as RuntimeConfig;
    return c.apiKey ? c : null;
  } catch {
    return null;
  }
}
