import "@fontsource/khand/500.css";
import "@fontsource/khand/600.css";
import "@fontsource/khand/700.css";
import "@fontsource/mukta/400.css";
import "@fontsource/mukta/600.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { C, crossStitch, dyeStyle, needle, satinDiamond, textFont } from "./cloth.ts";
import {
  firesFor, loadConfig, loadDistricts, loadExposure, loadManifest, loadStations, loadTowns, stationValueAt, windFor,
  type City, type Exposure, type Fires, type Manifest, type RuntimeConfig, type Stations, type Towns,
} from "./data.ts";
import {
  bearingWord, fmtHours, fmtInt, fmtPeopleIntl, fmtWhen, kmBetween, pct, plural, pmBand,
} from "./format.ts";
import { autocomplete, placePosition, reverseGeocode, roadTrip, styleUrl, type Suggestion } from "./location.ts";
import { Timeline } from "./timeline.ts";
import { fireWeights, integrate, nearPathWeights, pathLengthKm, type Trajectory } from "./traj.ts";
import { Tour } from "./tour.ts";

export type Mode = "back" | "fwd";

export interface Origin { lat: number; lon: number; name: string; cityId: string | null }

export interface TraceResult {
  traj: Trajectory;
  origin: Origin;
  t: number;
  mode: Mode;
  fires: Fires;
  weights: Float32Array;
  firesOnPath: number;
  regionShares: { name: string; share: number }[];
  topDistrict: { name: string; region: string } | null;
  overAt: { hoursAgo: number; district: string | null; lat: number; lon: number } | null;
  towns: { name: string; pop: number; w: number }[];
  people: number;
  pathKm: number;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const REGION_NAMES: Record<string, string> = {
  "IN-PB": "Punjab (India)", "PK-PB": "Punjab (Pakistan)", "IN-HR": "Haryana", "IN-UP": "Uttar Pradesh",
  "IN-RJ": "Rajasthan", "IN-MP": "Madhya Pradesh", "IN-DL": "Delhi", "IN-UK": "Uttarakhand",
  "IN-HP": "Himachal Pradesh", "IN-JK": "Jammu and Kashmir", "IN-CH": "Chandigarh", "PK-KP": "Khyber Pakhtunkhwa",
  "PK-SD": "Sindh", "PK-BA": "Balochistan", "IN-GJ": "Gujarat", "IN-BR": "Bihar",
};

class App {
  /** The query string the page was opened with (writeUrl rewrites location as the visitor explores). */
  readonly boot = new URLSearchParams(location.search);
  map!: maplibregl.Map;
  m!: Manifest;
  cfg: RuntimeConfig | null = null;
  stations!: Stations;
  towns!: Towns;
  districts!: GeoJSON.FeatureCollection;
  exposure = new Map<string, Exposure>();
  timeline!: Timeline;
  tour!: Tour;

  origin!: Origin;
  t = 0;
  mode: Mode = "back";
  last: TraceResult | null = null;
  private seq = 0;
  private sewing = 0;
  private markers = new Map<string, maplibregl.Marker>();
  private pin: maplibregl.Marker | null = null;
  private popup: maplibregl.Popup | null = null;

  async start() {
    const [m, cfg] = await Promise.all([loadManifest(), loadConfig()]);
    this.m = m;
    this.cfg = cfg;
    const [stations, towns, districts] = await Promise.all([loadStations(), loadTowns(), loadDistricts()]);
    this.stations = stations; this.towns = towns; this.districts = districts;
    await Promise.all(m.cities.map(async (c) => this.exposure.set(c.id, await loadExposure(c.id))));

    const params = new URLSearchParams(location.search);
    const city = m.cities.find((c) => c.id === params.get("c")) ?? m.cities[0];
    this.origin = { lat: city.lat, lon: city.lon, name: city.name, cityId: city.id };
    if (params.has("lat") && params.has("lon")) {
      const lat = Number(params.get("lat")), lon = Number(params.get("lon"));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        this.origin = { lat, lon, name: params.get("n") ?? "Your pin", cityId: null };
      }
    }
    this.mode = params.get("mode") === "fwd" ? "fwd" : "back";
    const exp = this.exposure.get(city.id)!;
    this.t = Number(params.get("t")) || this.defaultTime(exp);

    this.timeline = new Timeline($("#border"), (t, commit) => this.setTime(t, commit));
    this.timeline.setRange(exp.t[0], exp.t[exp.t.length - 1]);
    this.buildChrome();
    await this.buildMap();
    this.tour = new Tour(this);
    if (params.get("tour") === "1") this.tour.play(params.get("autoplay") === "1");
  }

  /**
   * A recent smoky moment: the latest 3-hourly trace in the top fifth of fire activity,
   * preferring one with measured PM2.5 so the first number on screen is a reading, not a model.
   */
  defaultTime(exp: Exposure): number {
    const vals = exp.fires.map((v) => v ?? 0);
    const sorted = [...vals].sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)];
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] >= p80 && vals[i] > 0 && exp.pm_obs[i] != null) return exp.t[i];
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] >= p80 && vals[i] > 0) return exp.t[i];
    return exp.t[exp.t.length - 1];
  }

  // ---------- map ----------
  private async buildMap() {
    const style: StyleSpecification | string = this.cfg ? styleUrl(this.cfg) : {
      version: 8, sources: {}, glyphs: undefined as unknown as string,
      layers: [{ id: "bg", type: "background", paint: { "background-color": C.ground } }],
    };
    this.map = new maplibregl.Map({
      container: "map",
      style,
      center: [75.6, 29.6],
      zoom: innerWidth < 700 ? 4.6 : 5.5,
      minZoom: 3.5,
      maxZoom: 11,
      maxBounds: [[60, 18], [92, 38]],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      transformStyle: (_prev, next) => dyeStyle(next, [...this.m.cities.map((c) => c.name), "New Delhi"]),
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.AttributionControl({
      compact: true,
      customAttribution: "Fires: NOAA JPSS VIIRS · PM2.5: OpenAQ · Districts: Overture Maps (ODbL) · Wind: Open-Meteo (CC BY 4.0)",
    }), "bottom-right");
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    await new Promise<void>((res) => this.map.once("load", () => res()));
    document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    this.addLayers();
    this.placeCityMarkers();
    this.map.on("click", (e) => this.onMapClick(e));
    await this.trace(true);
    // the whole plain fits on a desktop; on a phone, open on the thread itself
    if (innerWidth < 760) this.fitTrace(40, 0);
    document.body.classList.add("ready");
  }

  private addLayers() {
    const map = this.map;
    const font = textFont(map.getStyle());
    map.addImage("fire-lit", satinDiamond(true), { pixelRatio: 2 });
    map.addImage("fire-dim", satinDiamond(false), { pixelRatio: 2 });
    map.addImage("cross-white", crossStitch(C.white), { pixelRatio: 2 });
    map.addImage("cross-peacock", crossStitch(C.peacock), { pixelRatio: 2 });
    map.addImage("needle-white", needle(C.white), { pixelRatio: 2 });
    map.addImage("needle-peacock", needle(C.peacock), { pixelRatio: 2 });

    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource("districts", { type: "geojson", data: this.districts });
    map.addSource("fires", { type: "geojson", data: empty });
    map.addSource("stations", { type: "geojson", data: empty });
    map.addSource("towns-hit", { type: "geojson", data: empty });
    map.addSource("siblings", { type: "geojson", data: empty });
    map.addSource("thread", { type: "geojson", data: empty, lineMetrics: true });
    map.addSource("ticks", { type: "geojson", data: empty });
    map.addSource("head", { type: "geojson", data: empty });

    map.addLayer({
      id: "district-tint", type: "fill", source: "districts",
      paint: {
        "fill-color": C.gold,
        "fill-opacity": ["*", 0.13, ["coalesce", ["feature-state", "share"], 0]],
      },
    });
    map.addLayer({
      id: "district-line", type: "line", source: "districts", minzoom: 5.2,
      paint: { "line-color": C.indigo, "line-width": 0.7, "line-opacity": 0.65 },
    });
    map.addLayer({
      id: "stations", type: "circle", source: "stations", minzoom: 5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.4, 9, 5.5],
        "circle-color": ["step", ["get", "pm"], "#cfe8c4", 30, "#ece39b", 60, "#f3b562", 90, "#ec7a5b", 120, "#d6457a", 250, "#a32a86"],
        "circle-stroke-color": C.groundDeep,
        "circle-stroke-width": 1.2,
      },
    });
    map.addLayer({
      id: "fires-dim", type: "symbol", source: "fires", filter: ["==", ["get", "w"], 0],
      layout: {
        "icon-image": "fire-dim", "icon-allow-overlap": true, "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.24, 8, 0.6, 11, 1],
      },
      paint: { "icon-opacity": 0.38 },
    });
    map.addLayer({
      id: "siblings", type: "line", source: "siblings",
      layout: { "line-cap": "butt" },
      paint: {
        "line-color": ["case", ["==", ["get", "mode"], "fwd"], C.peacock, C.white],
        "line-width": 1.1, "line-opacity": 0.32, "line-dasharray": [1.4, 1.6],
      },
    });
    map.addLayer({
      id: "thread-shadow", type: "line", source: "thread",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#14040a", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 5.6, 9, 8], "line-opacity": 0.5, "line-translate": [0.9, 1.6], "line-blur": 1 },
    });
    map.addLayer({
      id: "thread", type: "line", source: "thread",
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": ["case", ["==", ["get", "mode"], "fwd"], C.peacock, C.white],
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 3.4, 9, 5.5],
        "line-dasharray": [1.8, 1.1],
      },
    });
    const byFrp: maplibregl.ExpressionSpecification = ["interpolate", ["linear"], ["sqrt", ["get", "frp"]], 1, 0.75, 6, 1.15, 14, 1.6];
    map.addLayer({
      id: "fires-lit", type: "symbol", source: "fires", filter: [">", ["get", "w"], 0],
      layout: {
        "icon-image": "fire-lit", "icon-allow-overlap": true, "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "frp"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 4, ["*", 0.6, byFrp], 8, ["*", 1.15, byFrp], 11, ["*", 1.6, byFrp]],
      },
      // each diamond lights as the needle passes it (feature-state "lit", set while sewing)
      paint: {
        "icon-opacity": ["case", ["boolean", ["feature-state", "lit"], false],
          ["interpolate", ["linear"], ["get", "w"], 0, 0.6, 1, 1], 0.14],
        "icon-opacity-transition": { duration: 260 },
      },
    });
    map.addLayer({
      id: "towns-hit", type: "circle", source: "towns-hit",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "pop"]], 140, 3, 4000, 11],
        "circle-color": "rgba(79,195,201,0.18)", "circle-stroke-color": C.peacock, "circle-stroke-width": 1.4,
      },
    });
    map.addLayer({
      id: "towns-hit-label", type: "symbol", source: "towns-hit", minzoom: 4.5,
      filter: [">=", ["get", "pop"], 150000],
      layout: {
        "text-field": ["get", "name"], "text-font": font, "text-size": 12, "text-offset": [0, 1.1],
        "text-anchor": "top", "text-optional": true,
      },
      paint: { "text-color": "#c9f1f3", "text-halo-color": C.groundDeep, "text-halo-width": 1.5 },
    });
    map.addLayer({
      id: "ticks", type: "symbol", source: "ticks",
      layout: {
        "icon-image": ["case", ["==", ["get", "mode"], "fwd"], "cross-peacock", "cross-white"],
        "icon-allow-overlap": true, "icon-size": 0.9,
        "text-field": ["get", "label"], "text-font": font, "text-size": 11.5, "text-offset": [0, 1.15],
        "text-anchor": "top", "text-optional": true,
      },
      paint: { "text-color": C.white, "text-halo-color": C.groundDeep, "text-halo-width": 1.6 },
    });
    map.addLayer({
      id: "head", type: "symbol", source: "head",
      layout: { "icon-image": ["case", ["==", ["get", "mode"], "fwd"], "needle-peacock", "needle-white"], "icon-allow-overlap": true },
    });

    for (const id of ["fires-lit", "fires-dim", "stations"]) {
      map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
    }
  }

  private placeCityMarkers() {
    for (const c of this.m.cities) {
      const el = document.createElement("button");
      el.className = "city-pin";
      el.type = "button";
      el.innerHTML = `<span class="knot" aria-hidden="true"></span><span class="nm">${esc(c.name)}</span>`;
      el.setAttribute("aria-label", `Trace the air arriving in ${c.name}`);
      el.addEventListener("click", (e) => { e.stopPropagation(); this.setCity(c.id); });
      this.markers.set(c.id, new maplibregl.Marker({ element: el, anchor: "left", offset: [-7, 0] })
        .setLngLat([c.lon, c.lat]).addTo(this.map));
    }
  }

  private onMapClick(e: maplibregl.MapMouseEvent) {
    const hit = this.map.queryRenderedFeatures(e.point, { layers: ["fires-lit", "fires-dim", "stations"] });
    const f = hit[0];
    if (f && f.layer.id.startsWith("fires")) return this.firePopup(f as unknown as GeoJSON.Feature<GeoJSON.Point>);
    if (f && f.layer.id === "stations") return this.stationPopup(f as unknown as GeoJSON.Feature<GeoJSON.Point>);
    this.setOrigin({ lat: e.lngLat.lat, lon: e.lngLat.lng, name: "Your pin", cityId: null }, true);
  }

  // ---------- state changes ----------
  setCity(id: string) {
    const c = this.m.cities.find((x) => x.id === id)!;
    this.setOrigin({ lat: c.lat, lon: c.lon, name: c.name, cityId: c.id }, false);
  }

  async setOrigin(o: Origin, lookup: boolean) {
    this.origin = o;
    this.popup?.remove();
    if (o.cityId) {
      this.pin?.remove(); this.pin = null;
    } else {
      if (!this.pin) {
        const el = document.createElement("div");
        el.className = "pin-knot";
        this.pin = new maplibregl.Marker({ element: el }).setLngLat([o.lon, o.lat]).addTo(this.map);
      }
      this.pin.setLngLat([o.lon, o.lat]);
    }
    this.syncChrome();
    await this.trace(true);
    if (lookup && this.cfg && !o.cityId) {
      const where = await reverseGeocode(this.cfg, o.lon, o.lat).catch(() => null);
      if (where && this.origin === o) {
        o.name = where.locality ?? where.district ?? where.region ?? "Your pin";
        this.syncChrome();
        this.renderPlaque();
        this.writeUrl();
      }
    }
  }

  setTime(t: number, commit: boolean) {
    this.t = t;
    this.timeline.setTime(t);
    this.trace(commit);
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.syncChrome();
    this.trace(true);
  }

  // ---------- the core: sew the thread ----------
  async trace(animate: boolean): Promise<TraceResult | null> {
    const seq = ++this.seq;
    const { m, origin, t, mode } = this;
    const p = m.trajectory;
    const span = p.hours * 3600;
    const field = mode === "back" ? await windFor(m, t - span, t) : await windFor(m, t, t + span);
    if (seq !== this.seq) return null;
    if (!field) { this.status("No wind record for this time yet."); return null; }
    const traj = integrate(field, origin.lat, origin.lon, t, p, mode === "back" ? -1 : 1);

    const fireT0 = mode === "back" ? t - span - p.pass_after_fire_h * 3600 : t - 24 * 3600;
    const fireT1 = mode === "back" ? t + p.pass_before_fire_h * 3600 : t + 3 * 3600;
    const fires = await firesFor(m, fireT0, fireT1);
    if (seq !== this.seq) return null;
    const weights = mode === "back" ? fireWeights(traj, fires, p) : new Float32Array(fires.lat.length);

    // tally by region and district (districts.geojson carries the names)
    const feats = this.districts.features;
    const byRegion = new Map<string, number>();
    const byDistrict = new Map<number, number>();
    let firesOnPath = 0, frpTotal = 0;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i];
      if (!w) continue;
      firesOnPath += w;
      const frp = w * fires.frp[i];
      frpTotal += frp;
      const d = fires.d[i];
      if (d >= 0) {
        const reg = String(feats[d].properties!.region);
        byRegion.set(reg, (byRegion.get(reg) ?? 0) + frp);
        byDistrict.set(d, (byDistrict.get(d) ?? 0) + frp);
      }
    }
    const regionShares = [...byRegion.entries()].sort((a, b) => b[1] - a[1])
      .map(([code, v]) => ({ name: REGION_NAMES[code] ?? code, share: frpTotal ? v / frpTotal : 0 }));
    let topDistrict: TraceResult["topDistrict"] = null;
    let best = 0;
    for (const [d, v] of byDistrict) if (v > best) { best = v; topDistrict = { name: String(feats[d].properties!.name), region: REGION_NAMES[String(feats[d].properties!.region)] ?? "" }; }

    // where was the air 24 h before it arrived (or will be 24 h after)?
    const main = traj.members[0];
    let overAt: TraceResult["overAt"] = null;
    for (const h of [24, 36, 12]) {
      if (Number.isFinite(main.lat[h])) {
        overAt = { hoursAgo: h, lat: main.lat[h], lon: main.lon[h], district: this.districtAt(main.lat[h], main.lon[h]) };
        break;
      }
    }

    let towns: TraceResult["towns"] = [];
    let people = 0;
    if (mode === "fwd") {
      const tw = nearPathWeights(traj, this.towns.lat, this.towns.lon, null, 15, null);
      for (let i = 0; i < tw.length; i++) {
        if (tw[i] > 0 && kmBetween(origin.lat, origin.lon, this.towns.lat[i], this.towns.lon[i]) > 8) {
          towns.push({ name: this.towns.name[i], pop: this.towns.pop[i], w: tw[i] });
          people += this.towns.pop[i];
        }
      }
      towns.sort((a, b) => b.pop - a.pop);
    }

    const res: TraceResult = {
      traj, origin, t, mode, fires, weights, firesOnPath, regionShares, topDistrict, overAt, towns, people,
      pathKm: pathLengthKm(main),
    };
    this.last = res;
    this.render(res, byDistrict, frpTotal, animate && !reducedMotion);
    return res;
  }

  private districtAt(lat: number, lon: number): string | null {
    for (const f of this.districts.features) {
      const g = f.geometry;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) {
        if (inRing(poly[0] as number[][], lon, lat) && !poly.slice(1).some((h) => inRing(h as number[][], lon, lat))) {
          return `${f.properties!.name}, ${REGION_NAMES[String(f.properties!.region)] ?? ""}`.replace(/, $/, "");
        }
      }
    }
    return null;
  }

  private render(r: TraceResult, byDistrict: Map<number, number>, frpTotal: number, animate: boolean) {
    const map = this.map;
    const lineOf = (k: number) => {
      const mbr = r.traj.members[k];
      const coords: [number, number][] = [];
      for (let h = 0; h < mbr.lat.length && Number.isFinite(mbr.lat[h]); h++) coords.push([mbr.lon[h], mbr.lat[h]]);
      return coords;
    };
    const mainCoords = lineOf(0);
    (map.getSource("siblings") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: r.traj.members.slice(1).map((_, k): GeoJSON.Feature<GeoJSON.LineString> => ({
        type: "Feature", properties: { mode: r.mode },
        geometry: { type: "LineString", coordinates: lineOf(k + 1) },
      })).filter((f) => f.geometry.coordinates.length > 1),
    });
    const ticks: GeoJSON.Feature[] = [];
    for (let h = 6; h < mainCoords.length; h += 6) {
      ticks.push({ type: "Feature", properties: { mode: r.mode, label: `${r.mode === "back" ? "−" : "+"}${h} h` },
        geometry: { type: "Point", coordinates: mainCoords[h] } });
    }

    // fires in view window, lit by the share of ensemble threads that crossed them
    const ff: GeoJSON.Feature[] = [];
    for (let i = 0; i < r.fires.lat.length; i++) {
      ff.push({ type: "Feature", id: i, properties: { w: r.weights[i], frp: r.fires.frp[i], t: r.fires.t[i], n: r.fires.n[i], d: r.fires.d[i] },
        geometry: { type: "Point", coordinates: [r.fires.lon[i], r.fires.lat[i]] } });
    }
    (map.getSource("fires") as GeoJSONSource).setData({ type: "FeatureCollection", features: ff });

    map.removeFeatureState({ source: "districts" });
    if (frpTotal > 0) {
      const max = Math.max(...byDistrict.values());
      for (const [d, v] of byDistrict) map.setFeatureState({ source: "districts", id: d }, { share: Math.sqrt(v / max) });
    }

    const st = this.stations;
    (map.getSource("stations") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: st.stations.flatMap((s, i) => {
        const v = stationValueAt(st, i, r.t);
        return v == null ? [] : [{ type: "Feature" as const, properties: { pm: v, i },
          geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } }];
      }),
    });

    (map.getSource("towns-hit") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: r.mode === "fwd" ? r.towns.map((tw) => {
        const i = this.towns.name.indexOf(tw.name);
        return { type: "Feature" as const, properties: { name: tw.name, pop: tw.pop },
          geometry: { type: "Point" as const, coordinates: [this.towns.lon[i], this.towns.lat[i]] } };
      }) : [],
    });

    const sew = ++this.sewing;
    // the hour along the centre thread nearest each crossed fire, so it lights as the needle passes
    const litAt: [number, number][] = [];
    for (let i = 0; i < r.weights.length; i++) {
      if (!r.weights[i]) continue;
      let best = 0, bd = Infinity;
      for (let h = 0; h < mainCoords.length; h++) {
        const d = (mainCoords[h][0] - r.fires.lon[i]) ** 2 + (mainCoords[h][1] - r.fires.lat[i]) ** 2;
        if (d < bd) { bd = d; best = h; }
      }
      litAt.push([best, i]);
    }
    litAt.sort((a, b) => a[0] - b[0]);
    map.removeFeatureState({ source: "fires" });
    let litUpTo = 0;
    const setThread = (n: number) => {
      const c = mainCoords.slice(0, Math.max(2, n));
      (map.getSource("thread") as GeoJSONSource).setData({ type: "Feature", properties: { mode: r.mode }, geometry: { type: "LineString", coordinates: c } });
      (map.getSource("head") as GeoJSONSource).setData({ type: "Feature", properties: { mode: r.mode }, geometry: { type: "Point", coordinates: c[c.length - 1] } });
      (map.getSource("ticks") as GeoJSONSource).setData({ type: "FeatureCollection", features: ticks.slice(0, Math.floor(n / 6)) });
      const reach = n >= mainCoords.length ? Infinity : n;
      while (litUpTo < litAt.length && litAt[litUpTo][0] < reach) {
        map.setFeatureState({ source: "fires", id: litAt[litUpTo][1] }, { lit: true });
        litUpTo++;
      }
    };
    if (mainCoords.length < 2) {
      setThread(0);
    } else if (!animate) {
      setThread(mainCoords.length);
    } else {
      const start = performance.now(), dur = 2200;
      const step = (now: number) => {
        if (sew !== this.sewing) return;
        const k = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        setThread(Math.ceil(eased * mainCoords.length));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    this.renderPlaque();
    this.timeline.setTime(r.t);
    this.writeUrl();
  }

  // ---------- chrome ----------
  private buildChrome() {
    const tags = $("#cities");
    tags.innerHTML = this.m.cities.map((c) =>
      `<button type="button" class="tag" data-city="${c.id}" aria-pressed="false">${esc(c.name)}</button>`).join("");
    tags.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-city]");
      if (b) this.setCity(b.dataset.city!);
    });
    $("#mode").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-mode]");
      if (b) this.setMode(b.dataset.mode as Mode);
    });
    $("#play").addEventListener("click", () => this.tour.play(false));
    $("#method-open").addEventListener("click", () => this.toggleMethod(true));
    $("#method-close").addEventListener("click", () => this.toggleMethod(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") this.toggleMethod(false); });
    $("#border-play").addEventListener("click", () => this.playSeason());
    this.buildSearch();
    this.fillMethod();
    this.syncChrome();
  }

  private syncChrome() {
    document.querySelectorAll<HTMLButtonElement>("#cities [data-city]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.city === this.origin.cityId)));
    document.querySelectorAll<HTMLButtonElement>("#mode [data-mode]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === this.mode)));
    for (const [id, mk] of this.markers) mk.getElement().classList.toggle("active", id === this.origin.cityId);
    const city = this.seriesCity();
    this.timeline?.setSeries(this.exposure.get(city.id) ?? null,
      this.origin.cityId ? `${city.name}: fires on the air's path, every 3 h` : `Season shown for ${city.name}, the nearest preset`);
  }

  seriesCity(): City {
    const o = this.origin;
    if (o.cityId) return this.m.cities.find((c) => c.id === o.cityId)!;
    return [...this.m.cities].sort((a, b) => kmBetween(o.lat, o.lon, a.lat, a.lon) - kmBetween(o.lat, o.lon, b.lat, b.lon))[0];
  }

  /** PM2.5 for the origin at time t: city median of measured stations, else model, else nearest station. */
  pmFor(t: number): { v: number; kind: "measured" | "model"; note: string } | null {
    const o = this.origin;
    if (o.cityId) {
      const e = this.exposure.get(o.cityId)!;
      let i = 0, bestD = Infinity;
      e.t.forEach((x, k) => { const d = Math.abs(x - t); if (d < bestD) { bestD = d; i = k; } });
      const city = this.m.cities.find((c) => c.id === o.cityId)!;
      if (e.pm_obs[i] != null) return { v: e.pm_obs[i]!, kind: "measured", note: `median of ${city.stations.length} stations` };
      if (e.pm_model[i] != null) return { v: e.pm_model[i]!, kind: "model", note: "model estimate (CAMS); stations not yet published" };
      return null;
    }
    let best = -1, bd = 25;
    this.stations.stations.forEach((s, i) => {
      const d = kmBetween(o.lat, o.lon, s.lat, s.lon);
      if (d < bd && stationValueAt(this.stations, i, t) != null) { bd = d; best = i; }
    });
    if (best < 0) return null;
    return { v: stationValueAt(this.stations, best, t)!, kind: "measured", note: `${this.stations.stations[best].name.split(" - ")[0]}, ${Math.round(bd)} km away` };
  }

  renderPlaque() {
    const r = this.last;
    $("#place").textContent = this.origin.name;
    $("#when").textContent = fmtWhen(this.t);
    const pm = this.pmFor(this.t);
    const num = $("#pm");
    if (pm) {
      tick(num, Math.round(pm.v));
      const band = pmBand(pm.v);
      $("#band").textContent = band.name;
      $("#band").style.setProperty("--band", band.color);
      $("#pm-note").textContent = `PM2.5 µg/m³ · ${pm.kind === "model" ? "" : "measured, "}${pm.note}`;
      $("#plaque").classList.toggle("is-model", pm.kind === "model");
    } else {
      num.textContent = "–";
      $("#band").textContent = "No station";
      $("#band").style.setProperty("--band", "rgba(233,215,184,0.4)");
      $("#pm-note").textContent = "No PM2.5 station within 25 km at this hour";
    }
    if (!r) return;
    const lines: string[] = [];
    if (r.mode === "back") {
      const n = Math.round(r.firesOnPath);
      lines.push(n > 0
        ? `In the 48 hours before it arrived, this air crossed <b class="num">${fmtInt(n)}</b> fire ${plural(n, "detection")}.`
        : "In the 48 hours before it arrived, this air crossed no detected fires.");
      if (n > 0 && r.regionShares.length) {
        lines.push(`Fire activity on its path: ${r.regionShares.slice(0, 3).filter((x) => x.share >= 0.03)
          .map((x) => `${esc(x.name)} <b class="num">${pct(x.share)}</b>`).join(", ")}.`);
      }
      if (r.overAt) {
        const where = r.overAt.district ? esc(r.overAt.district)
          : `${Math.round(kmBetween(this.origin.lat, this.origin.lon, r.overAt.lat, r.overAt.lon))} km ${bearingWord(this.origin.lat, this.origin.lon, r.overAt.lat, r.overAt.lon)}`;
        lines.push(`${r.overAt.hoursAgo} hours earlier it was over ${where}.`);
      }
    } else {
      lines.push(r.towns.length
        ? `Over the next 48 hours, air from here passes over <b class="num">${fmtInt(r.towns.length)}</b> ${plural(r.towns.length, "town")} where <b class="num">${fmtPeopleIntl(r.people)}</b> people live.`
        : "Over the next 48 hours, air from here passes over no large towns.");
      if (r.towns.length) lines.push(`Largest: ${r.towns.slice(0, 4).map((x) => esc(x.name)).join(", ")}.`);
      lines.push(`It travels about <b class="num">${fmtInt(r.pathKm)}</b> km.`);
    }
    $("#finding").innerHTML = lines.map((l) => `<p>${l}</p>`).join("");
    const s = this.seriesCity().summary;
    $("#season").innerHTML = this.origin.cityId && s.pm_obs_high_fire_days != null
      ? `This season in ${esc(this.seriesCity().name)}: days whose air crossed the most fires averaged <b class="num">${Math.round(s.pm_obs_high_fire_days)}</b> µg/m³, the fewest <b class="num">${Math.round(s.pm_obs_low_fire_days!)}</b> (measured, ${s.days_measured} days).`
      : "";
  }

  private status(msg: string) { $("#finding").innerHTML = `<p>${esc(msg)}</p>`; }

  private writeUrl() {
    if (this.tour?.active) return;
    const q = new URLSearchParams();
    if (this.origin.cityId) q.set("c", this.origin.cityId);
    else { q.set("lat", this.origin.lat.toFixed(3)); q.set("lon", this.origin.lon.toFixed(3)); q.set("n", this.origin.name); }
    q.set("t", String(this.t));
    if (this.mode === "fwd") q.set("mode", "fwd");
    history.replaceState(null, "", `?${q}`);
  }

  private toggleMethod(open: boolean) {
    const d = $("#method");
    if (open === !d.hidden) return;
    d.hidden = !open;
    $("#method-open").setAttribute("aria-expanded", String(open));
    if (open) $("#method-close").focus(); else $("#method-open").focus();
  }

  private fillMethod() {
    const rows = this.m.cities.map((c) => {
      const s = c.summary;
      return `<tr><th scope="row">${esc(c.name)}</th><td>${s.days_measured}</td><td>${s.pm_obs_high_fire_days != null ? Math.round(s.pm_obs_high_fire_days) : "–"}</td><td>${s.pm_obs_low_fire_days != null ? Math.round(s.pm_obs_low_fire_days) : "–"}</td><td>${s.spearman_fires_vs_pm_obs ?? "–"}</td><td>${s.spearman_detrended ?? "–"}</td></tr>`;
    }).join("");
    $("#stats-body").innerHTML = rows;
    $("#sources").innerHTML = this.m.sources.map((s) =>
      `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.name)}</a> <span>${esc(s.via)}${s.license ? ` · ${esc(s.license)}` : ""}</span></li>`).join("");
    $("#updated").textContent = `Data rebuilt ${this.m.generated_at.replace("T", " ").replace("Z", " UTC")}; measured PM2.5 published to ${this.m.latest_measured?.slice(0, 10) ?? "–"}.`;
    if (this.cfg?.repoUrl) ($("#repo") as HTMLAnchorElement).href = this.cfg.repoUrl;
  }

  private buildSearch() {
    const input = $("#q") as HTMLInputElement;
    const list = $("#q-list");
    let items: Suggestion[] = [];
    let active = -1;
    let ctl: AbortController | null = null;
    let timer = 0;
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
    const show = () => {
      list.innerHTML = items.map((s, i) =>
        `<li role="option" id="q-opt-${i}" aria-selected="${i === active}" data-i="${i}"><b>${esc(s.title)}</b><span>${esc(s.subtitle)}</span></li>`).join("");
      list.hidden = items.length === 0;
      input.setAttribute("aria-expanded", String(items.length > 0));
      input.setAttribute("aria-activedescendant", active >= 0 ? `q-opt-${active}` : "");
    };
    const choose = async (i: number) => {
      const s = items[i];
      if (!s || !this.cfg) return;
      close();
      input.value = s.title;
      const pos = await placePosition(this.cfg, s.id).catch(() => null);
      if (!pos) return;
      this.map.flyTo({ center: pos, zoom: Math.max(this.map.getZoom(), 6), duration: reducedMotion ? 0 : 1200 });
      this.setOrigin({ lon: pos[0], lat: pos[1], name: s.title, cityId: null }, false);
    };
    if (!this.cfg) { input.disabled = true; input.placeholder = "Search needs the Location key"; return; }
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { items = []; close(); return; }
      timer = window.setTimeout(async () => {
        ctl?.abort(); ctl = new AbortController();
        try {
          items = await autocomplete(this.cfg!, q, [this.origin.lon, this.origin.lat], ctl.signal);
          active = -1; show();
        } catch (err) {
          if ((err as Error).name !== "AbortError") { items = []; list.innerHTML = `<li class="err">Search is unavailable right now.</li>`; list.hidden = false; }
        }
      }, 220);
    });
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); show(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); show(); e.preventDefault(); }
      else if (e.key === "Enter" && active >= 0) { choose(active); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    list.addEventListener("mousedown", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (li) { e.preventDefault(); choose(Number(li.dataset.i)); }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
  }

  // ---------- popups ----------
  async firePopup(f: GeoJSON.Feature<GeoJSON.Point>) {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties as { w: number; frp: number; t: number; n: number; d: number };
    const d = p.d >= 0 ? this.districts.features[p.d].properties! : null;
    const html = (extra: string) => `
      <div class="pop">
        <h3>Fire detected ${esc(fmtWhen(p.t))}</h3>
        <p>${d ? `${esc(String(d.name))}, ${esc(REGION_NAMES[String(d.region)] ?? String(d.region))}` : "Outside mapped districts"} · ${p.frp.toFixed(1)} MW · seen by ${p.n} satellite${p.n > 1 ? "s" : ""}</p>
        ${p.w > 0 ? `<p class="hit">${pct(p.w)} of the traced threads passed within 25 km while it burned.</p>` : ""}
        ${extra}
        <button type="button" class="tag satin" data-fwd>Where did this smoke go?</button>
      </div>`;
    this.popup?.remove();
    this.popup = new maplibregl.Popup({ closeButton: true, maxWidth: "300px", className: "cloth-pop" })
      .setLngLat([lon, lat]).setHTML(html(this.cfg ? `<p class="muted">Looking up the nearest place…</p>` : "")).addTo(this.map);
    const bind = () => this.popup?.getElement()?.querySelector("[data-fwd]")?.addEventListener("click", () => {
      this.mode = "fwd";
      this.t = Math.round(p.t / 3600) * 3600;
      this.setOrigin({ lat, lon, name: d ? `A fire in ${String(d.name)}` : "A fire", cityId: null }, false);
    });
    bind();
    if (!this.cfg) return;
    const popup = this.popup;
    const city = this.seriesCity();
    const [where, trip] = await Promise.all([
      reverseGeocode(this.cfg, lon, lat).catch(() => null),
      p.w > 0 && this.mode === "back" ? roadTrip(this.cfg, [lon, lat], [this.origin.lon, this.origin.lat]).catch(() => null) : Promise.resolve(null),
    ]);
    if (popup !== this.popup) return;
    const airH = p.w > 0 && this.last ? Math.max(0, (this.last.t - p.t) / 3600) : null;
    const extra = [
      where ? `<p>Near ${esc(where.label)}</p>` : "",
      trip ? `<p class="trip">By road it is <b class="num">${fmtInt(trip.km)}</b> km to ${esc(this.origin.cityId ? city.name : this.origin.name)}, about ${fmtHours(trip.hours)} of driving.${airH != null ? ` The air covered it in roughly ${fmtHours(airH)}.` : ""}</p>` : "",
    ].join("");
    popup.setHTML(html(extra));
    bind();
  }

  stationPopup(f: GeoJSON.Feature<GeoJSON.Point>) {
    const p = f.properties as { pm: number; i: number };
    const s = this.stations.stations[p.i];
    this.popup?.remove();
    this.popup = new maplibregl.Popup({ maxWidth: "280px", className: "cloth-pop" })
      .setLngLat(f.geometry.coordinates as [number, number])
      .setHTML(`<div class="pop"><h3>${esc(s.name.split(" - ")[0])}</h3><p><b class="num">${p.pm}</b> µg/m³ PM2.5 at ${esc(fmtWhen(this.t))} · ${esc(pmBand(p.pm).name)}</p><p class="muted">Measured station via OpenAQ</p></div>`)
      .addTo(this.map);
  }

  // ---------- season playback ----------
  private playing = 0;
  playSeason() {
    const btn = $("#border-play");
    if (this.playing) { cancelAnimationFrame(this.playing); this.playing = 0; btn.setAttribute("aria-pressed", "false"); return; }
    const e = this.exposure.get(this.seriesCity().id)!;
    let i = e.t.findIndex((x) => x >= this.t);
    if (i < 0 || i >= e.t.length - 1) i = 0;
    btn.setAttribute("aria-pressed", "true");
    let lastStep = 0;
    const loop = (now: number) => {
      if (now - lastStep > 160) {
        lastStep = now;
        this.setTime(e.t[i], false);
        i++;
        if (i >= e.t.length) { this.playing = 0; btn.setAttribute("aria-pressed", "false"); return; }
      }
      this.playing = requestAnimationFrame(loop);
    };
    this.playing = requestAnimationFrame(loop);
  }

  fitTrace(padding = 90, duration = 1600) {
    const r = this.last;
    if (!r) return;
    const b = new maplibregl.LngLatBounds();
    for (const m of r.traj.members) for (let h = 0; h < m.lat.length; h++) if (Number.isFinite(m.lat[h])) b.extend([m.lon[h], m.lat[h]]);
    if (b.isEmpty()) return;
    const plaque = $("#plaque").getBoundingClientRect();
    const narrow = innerWidth < 760;
    this.map.fitBounds(b, {
      padding: narrow ? { top: 70, bottom: innerHeight - plaque.top + 16, left: 28, right: 28 }
        : { top: padding, bottom: 140, left: plaque.right + 40, right: padding },
      maxZoom: 7.2, duration: reducedMotion ? 0 : duration,
    });
  }
}

function inRing(ring: number[][], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Fixed-figure count that ticks to its new value, like a counter turning over. */
function tick(el: HTMLElement, to: number) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = String(to);
  if (reducedMotion || from === to) { el.textContent = String(to); return; }
  const start = performance.now(), dur = 520;
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / dur);
    el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1 && el.dataset.v === String(to)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const app = new App();
// MapLibre 6 runs its tile worker from a separate module file served from this site (CSP: worker-src 'self').
maplibregl.setWorkerUrl(workerUrl);
(window as unknown as { smoke: App }).smoke = app;
app.start().catch((err) => {
  console.error(err);
  document.body.classList.add("failed");
  $("#finding").innerHTML = `<p>The map could not load its data. Reload to try again.</p>`;
});

export type { App };
