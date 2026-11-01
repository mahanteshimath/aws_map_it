// Amazon Location Service (Maps, Places, Routes v2) over plain HTTPS with an API key.
// Place results are shown to the visitor and never stored (single-use).
import type { RuntimeConfig } from "./data.ts";

export function styleUrl(c: RuntimeConfig): string {
  const q = new URLSearchParams({ key: c.apiKey, "color-scheme": "Dark", "political-view": "IND" });
  return `https://maps.geo.${c.region}.amazonaws.com/v2/styles/Monochrome/descriptor?${q}`;
}

async function post<T>(c: RuntimeConfig, service: "places" | "routes", path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`https://${service}.geo.${c.region}.amazonaws.com/v2/${path}?key=${encodeURIComponent(c.apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!r.ok) throw new Error(`${service} ${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export interface Suggestion { id: string; title: string; subtitle: string }

export async function autocomplete(c: RuntimeConfig, text: string, near: [number, number], signal?: AbortSignal): Promise<Suggestion[]> {
  const res = await post<{ ResultItems?: { PlaceId: string; Title: string; Address?: { Label?: string } }[] }>(
    c, "places", "autocomplete", {
      QueryText: text, BiasPosition: near, MaxResults: 6,
      Filter: { IncludeCountries: ["IND", "PAK"] }, Language: "en",
    }, signal);
  // Titles can arrive as "India, 148001, Sangrur"; the address label reads naturally ("Sangrur, Punjab, India").
  return (res.ResultItems ?? []).map((r) => {
    const parts = (r.Address?.Label ?? r.Title).split(",").map((s) => s.trim()).filter(Boolean);
    return { id: r.PlaceId, title: parts[0] ?? r.Title, subtitle: parts.slice(1).join(", ") };
  });
}

export async function placePosition(c: RuntimeConfig, placeId: string): Promise<[number, number] | null> {
  const r = await fetch(`https://places.geo.${c.region}.amazonaws.com/v2/place/${encodeURIComponent(placeId)}?key=${encodeURIComponent(c.apiKey)}&language=en`);
  if (!r.ok) return null;
  const j = (await r.json()) as { Position?: [number, number] };
  return j.Position ?? null;
}

export interface Where { label: string; locality?: string; district?: string; region?: string; country?: string }

export async function reverseGeocode(c: RuntimeConfig, lon: number, lat: number): Promise<Where | null> {
  const res = await post<{ ResultItems?: { Title?: string; Address?: {
    Label?: string; Locality?: string; District?: string; SubRegion?: { Name?: string };
    Region?: { Name?: string }; Country?: { Name?: string };
  } }[] }>(c, "places", "reverse-geocode", { QueryPosition: [lon, lat], MaxResults: 1, Language: "en" });
  const a = res.ResultItems?.[0]?.Address;
  if (!a) return null;
  return {
    label: a.Label ?? res.ResultItems?.[0]?.Title ?? "",
    locality: a.Locality ?? a.District,
    district: a.SubRegion?.Name,
    region: a.Region?.Name,
    country: a.Country?.Name,
  };
}

export interface RoadTrip { km: number; hours: number }

export async function roadTrip(c: RuntimeConfig, from: [number, number], to: [number, number]): Promise<RoadTrip | null> {
  const res = await post<{ Routes?: { Summary?: { Distance?: number; Duration?: number } }[] }>(
    c, "routes", "routes", { Origin: from, Destination: to, TravelMode: "Car", LegGeometryFormat: "FlexiblePolyline" });
  const s = res.Routes?.[0]?.Summary;
  if (!s?.Distance || !s?.Duration) return null;
  return { km: s.Distance / 1000, hours: s.Duration / 3600 };
}
