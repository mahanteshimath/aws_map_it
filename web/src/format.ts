// Number, time and air-quality formatting shared by the plaque, popups and tour.

/** India's National AQI sub-index bands for 24 h PM2.5 (µg/m³), used as a familiar scale. */
export const PM_BANDS = [
  { max: 30, name: "Good", color: "#cfe8c4" },
  { max: 60, name: "Satisfactory", color: "#ece39b" },
  { max: 90, name: "Moderate", color: "#f3b562" },
  { max: 120, name: "Poor", color: "#ec7a5b" },
  { max: 250, name: "Very poor", color: "#d6457a" },
  { max: Infinity, name: "Severe", color: "#a32a86" },
] as const;

export function pmBand(v: number) {
  return PM_BANDS.find((b) => v <= b.max) ?? PM_BANDS[PM_BANDS.length - 1];
}

const IST = "Asia/Kolkata";

export function fmtDate(t: number, withYear = false): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST, day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
  }).format(t * 1000);
}

export function fmtTime(t: number): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", hour12: true })
    .format(t * 1000).replace(" ", "\u202f").toLowerCase();
}

export function fmtWhen(t: number): string {
  return `${fmtDate(t)}, ${fmtTime(t)} IST`;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

/** "1 fire", "162 fires" (rounded the same way the number is shown). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return Math.round(n) === 1 ? one : many;
}

export function fmtPeople(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)} crore`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} lakh`;
  return fmtInt(n);
}

export function fmtPeopleIntl(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  return fmtInt(n);
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  const whole = Math.floor(h);
  const m = Math.round((h - whole) * 60);
  return m ? `${whole} h ${m} min` : `${whole} h`;
}

/** Compass bearing word for the direction a point lies in, seen from an origin. */
export function bearingWord(fromLat: number, fromLon: number, toLat: number, toLon: number): string {
  const y = toLat - fromLat;
  const x = (toLon - fromLon) * Math.cos((fromLat * Math.PI) / 180);
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  const words = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return words[Math.round(deg / 45) % 8];
}

export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
