// The phulkari cloth: re-dye Amazon Location's Monochrome basemap as madder-maroon
// khaddar with indigo-black water, and author the stitch images used on the map.
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

export const C = {
  ground: "#5a1521",
  groundDeep: "#3e0c17",
  groundLift: "#6d1f2c",
  indigo: "#191632",
  indigoSoft: "#2a2448",
  gold: "#f2b632",
  goldLight: "#ffd977",
  goldDeep: "#a86c0c",
  white: "#f6eedb",
  peacock: "#4fc3c9",
  cream: "#e9d7b8",
};

/**
 * Re-dye Amazon Location's Monochrome (Dark) style in place: keep its geometry,
 * India-view boundaries and place labels, drop the clutter, change the cloth.
 * Layer ids are the vendor's (land, water_*, admin_*, road_*, place_label_*).
 * `ownLabels` are place names we draw ourselves (preset city pins), hidden from the vendor labels.
 */
export function dyeStyle(style: StyleSpecification, ownLabels: string[] = []): StyleSpecification {
  const layers: LayerSpecification[] = [];
  const keepRoads = new Set(["road_motorway-trunk", "road_primary"]);
  for (const layer of style.layers) {
    const id = layer.id;
    const l = structuredClone(layer) as LayerSpecification & { paint?: Record<string, unknown>; layout?: Record<string, unknown> };
    l.paint = l.paint ?? {};
    l.layout = l.layout ?? {};
    if (/^(rail|tunnel|bridge|building|airport|poi)_/.test(id) || id.startsWith("water_pier") || id === "landuse_runway") continue;
    if (id.startsWith("road_") && !keepRoads.has(id)) continue;
    if (l.type === "background") {
      l.paint = { "background-color": C.ground };
    } else if (l.type === "fill") {
      if (id.startsWith("water_")) {
        l.paint = { "fill-color": C.indigo, "fill-antialias": true };
      } else if (id === "landuse_greenspace") {
        l.paint = { "fill-color": C.groundDeep, "fill-opacity": 0.4 };
      } else if (id === "landuse_glacier") {
        l.paint = { "fill-color": "#86505a", "fill-opacity": 0.45 };
      } else {
        l.paint = { "fill-color": "#6a2430", "fill-opacity": 0.45 };
      }
    } else if (l.type === "line") {
      if (id === "water_waterway") {
        l.paint["line-color"] = C.indigoSoft;
      } else if (id.endsWith("-disputed-mask")) {
        // masks hide the default line where India's view differs; they must match the cloth
        l.paint["line-color"] = C.ground;
      } else if (id.startsWith("admin_country")) {
        l.paint["line-color"] = C.cream;
        l.paint["line-opacity"] = 0.62;
      } else if (id.startsWith("admin_region")) {
        l.paint["line-color"] = C.cream;
        l.paint["line-opacity"] = 0.24;
      } else if (id.startsWith("road_")) {
        l.paint["line-color"] = "#80303d";
        l.paint["line-opacity"] = 0.7;
      }
    } else if (l.type === "symbol") {
      if (/^(road_label|building_label|poi_|airport_label)/.test(id)) continue;
      const water = id.startsWith("water_label");
      l.paint["text-color"] = water ? "#8f8ab8" : id === "admin_label_country" ? "#f0dcc0" : C.cream;
      l.paint["text-halo-color"] = C.groundDeep;
      l.paint["text-halo-width"] = 1.4;
      l.paint["text-halo-blur"] = 0.4;
      if (l.layout["icon-image"] !== undefined) l.paint["icon-opacity"] = 0.35;
      if (id.startsWith("place_label") && ownLabels.length) {
        const notOurs = ["!", ["in", ["coalesce", ["get", "name:en"], ["get", "name"]], ["literal", ownLabels]]];
        const f = (l as { filter?: unknown }).filter;
        (l as { filter?: unknown }).filter = f ? ["all", f, notOurs] : notOurs;
      }
    }
    layers.push(l);
  }
  return { ...style, layers };
}

/** A plain font stack from the style, so our own labels reuse the vendor glyphs. */
export function textFont(style: StyleSpecification): string[] {
  for (const l of style.layers) {
    const f = (l as { layout?: { "text-font"?: unknown } }).layout?.["text-font"];
    if (Array.isArray(f) && f.length === 1 && typeof f[0] === "string" && /Regular/.test(f[0])) return f as string[];
  }
  return ["Amazon Ember Regular,Noto Sans Regular"];
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!] as const;
}

/**
 * A satin-stitch diamond: parallel silk floats laid across a lozenge, the way
 * a phulkari bagh is filled. `lit` fires shine; `dim` ones are dull floss.
 */
export function satinDiamond(lit: boolean, size = 44): ImageData {
  const [, g] = canvas(size, size);
  const m = size / 2;
  const r = size * 0.44;
  const lozenge = () => {
    g.beginPath();
    g.moveTo(m, m - r); g.lineTo(m + r * 0.72, m); g.lineTo(m, m + r); g.lineTo(m - r * 0.72, m); g.closePath();
  };
  // soft shadow where the thread sits proud of the cloth
  g.save();
  g.translate(0.8, 1.4);
  lozenge();
  g.fillStyle = "rgba(20,4,8,0.55)";
  g.fill();
  g.restore();
  lozenge();
  g.save();
  g.clip();
  g.fillStyle = lit ? C.goldDeep : "#6b4a16";
  g.fillRect(0, 0, size, size);
  // floats: diagonal strokes alternating sheen, like satin catching light
  g.lineWidth = size / 22;
  for (let k = -size; k < size * 2; k += size / 14) {
    const sheen = (Math.round(k / (size / 14)) % 3 === 0);
    g.strokeStyle = lit ? (sheen ? C.goldLight : C.gold) : (sheen ? "#a8862f" : "#8a6b22");
    g.beginPath();
    g.moveTo(k, 0); g.lineTo(k - size * 0.6, size);
    g.stroke();
  }
  g.restore();
  lozenge();
  g.lineWidth = size / 30;
  g.strokeStyle = lit ? "#fff1c2" : "#b7973f";
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

/** A cross-stitch: marks each six hours along the thread. */
export function crossStitch(color: string, size = 18): ImageData {
  const [c, g] = canvas(size, size);
  void c;
  const p = size * 0.22;
  g.lineCap = "round";
  g.lineWidth = size / 6.5;
  g.strokeStyle = "rgba(20,4,8,0.6)";
  for (const [dx, dy] of [[0.7, 1.2]]) {
    g.beginPath(); g.moveTo(p + dx, p + dy); g.lineTo(size - p + dx, size - p + dy);
    g.moveTo(size - p + dx, p + dy); g.lineTo(p + dx, size - p + dy); g.stroke();
  }
  g.strokeStyle = color;
  g.beginPath(); g.moveTo(p, p); g.lineTo(size - p, size - p);
  g.moveTo(size - p, p); g.lineTo(p, size - p); g.stroke();
  return g.getImageData(0, 0, size, size);
}

/** The needle at the head of the thread while it is being sewn. */
export function needle(color: string, size = 30): ImageData {
  const [c, g] = canvas(size, size);
  void c;
  const m = size / 2;
  g.fillStyle = "rgba(20,4,8,0.5)";
  g.beginPath(); g.arc(m + 0.8, m + 1.3, size * 0.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = color;
  g.beginPath(); g.arc(m, m, size * 0.2, 0, Math.PI * 2); g.fill();
  g.lineWidth = size / 14;
  g.strokeStyle = C.groundDeep;
  g.beginPath(); g.arc(m, m, size * 0.08, 0, Math.PI * 2); g.stroke();
  return g.getImageData(0, 0, size, size);
}
