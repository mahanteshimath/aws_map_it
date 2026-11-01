// "Play the story": a guided walk through the season, every moment chosen from
// the data at load time (nothing hard-coded), driving the same map controls a
// visitor uses. ?tour=1&autoplay=1 runs it hands-free for the demo video.
import type { App } from "./main.ts";
import { fmtDate, fmtInt, fmtPeopleIntl, fmtTime, pct, plural } from "./format.ts";

interface Chapter { caption: () => string; run: () => Promise<void>; hold: number }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Tour {
  active = false;
  private i = 0;
  private paused = false;
  private skip: (() => void) | null = null;
  private token = 0;

  constructor(private readonly app: App) {
    $("#tour-next").addEventListener("click", () => this.skip?.());
    $("#tour-pause").addEventListener("click", () => this.togglePause());
    $("#tour-exit").addEventListener("click", () => this.stop());
  }

  private moments() {
    const a = this.app;
    const delhi = a.m.cities.find((c) => c.id === "delhi") ?? a.m.cities[0];
    const e = a.exposure.get(delhi.id)!;
    const daily = e.stats.daily;
    const measured = daily.t.map((t, k) => ({ t, k, f: daily.fires[k] ?? 0, pm: daily.pm_obs[k] }))
      .filter((d) => d.pm != null) as { t: string; k: number; f: number; pm: number }[];
    const bad = measured.reduce((x, y) => (y.f > x.f ? y : x));
    const medPm = [...measured].sort((x, y) => x.pm - y.pm)[Math.floor(measured.length / 2)].pm;
    const clean = measured.filter((d) => d.pm <= medPm).reduce((x, y) => (y.f < x.f ? y : x));
    const runIn = (day: string, pick: (f: number) => number) => {
      let best = -1, score = -Infinity;
      e.t.forEach((t, i) => {
        if (new Date(t * 1000).toISOString().slice(0, 10) !== day || e.pm_obs[i] == null) return;
        const s = pick(e.fires[i] ?? 0);
        if (s > score) { score = s; best = i; }
      });
      return best;
    };
    const iBad = runIn(bad.t, (f) => f);
    const iClean = runIn(clean.t, (f) => -f);
    const lahore = a.m.cities.find((c) => c.id === "lahore");
    const le = lahore ? a.exposure.get(lahore.id)! : null;
    let iLahore = -1;
    if (le) le.fires.forEach((f, i) => { if (le.pm_obs[i] != null && (iLahore < 0 || (f ?? 0) > (le.fires[iLahore] ?? 0))) iLahore = i; });
    return { delhi, e, iBad, iClean, lahore, le, iLahore };
  }

  async play(autoplay: boolean) {
    if (this.active) return;
    const a = this.app;
    const mo = this.moments();
    const share = (city: typeof mo.delhi | undefined, name: string) =>
      city?.summary.regions?.find((r) => r.name === name)?.share ?? 0;
    const s = mo.delhi.summary;
    let fireFwd: { lat: number; lon: number; t: number; district: string } | null = null;

    const chapters: Chapter[] = [
      {
        hold: 6500,
        caption: () => {
          const pm = a.pmFor(mo.e.t[mo.iBad]);
          return `${fmtDate(mo.e.t[mo.iBad])}, ${fmtTime(mo.e.t[mo.iBad])}. Delhi is breathing <b class="num">${pm ? Math.round(pm.v) : "–"}</b> µg/m³ of PM2.5, measured across ${mo.delhi.stations.length} stations. Where did this air come from?`;
        },
        run: async () => {
          a.mode = "back";
          a.setCity(mo.delhi.id);
          a.setTime(mo.e.t[mo.iBad], false);
          a.map.flyTo({ center: [mo.delhi.lon, mo.delhi.lat], zoom: 6.4, duration: 2200 });
          await wait(2300);
        },
      },
      {
        hold: 9000,
        caption: () => {
          const r = a.last!;
          const top = r.regionShares.filter((x) => x.share >= 0.05).slice(0, 2).map((x) => `${x.name}, ${pct(x.share)}`).join("; ");
          return `Sewn back 48 hours along the real wind, the air crossed <b class="num">${fmtInt(r.firesOnPath)}</b> satellite fire ${plural(r.firesOnPath, "detection")}${top ? ` (${top})` : ""}. Each gold diamond is one burning field.`;
        },
        run: async () => {
          await a.trace(true);
          a.fitTrace(80, 2400);
          await wait(2500);
        },
      },
      {
        hold: 8000,
        caption: () => {
          const pm = a.pmFor(mo.e.t[mo.iClean]);
          const r = a.last!;
          return `Now ${fmtDate(mo.e.t[mo.iClean])}. The air took another road and crossed <b class="num">${fmtInt(r.firesOnPath)}</b> ${plural(r.firesOnPath, "fire")}. PM2.5: <b class="num">${pm ? Math.round(pm.v) : "–"}</b> µg/m³.`;
        },
        run: async () => {
          a.setTime(mo.e.t[mo.iClean], true);
          await wait(1900);
          a.fitTrace(80, 2000);
          await wait(2100);
        },
      },
      {
        hold: 9500,
        caption: () => `Across ${s.days_measured} measured days, when Delhi's air crossed the most fires, PM2.5 averaged <b class="num">${Math.round(s.pm_obs_high_fire_days ?? 0)}</b>; the fewest, <b class="num">${Math.round(s.pm_obs_low_fire_days ?? 0)}</b>. Still air, traffic and festivals matter too. This map shows one piece of the story.`,
        run: async () => {
          const d = mo.e.stats.daily;
          a.timeline.setHighlight([Date.parse(`${d.t[0]}T00:00:00Z`) / 1000, Date.parse(`${d.t[d.t.length - 1]}T23:59:59Z`) / 1000]);
          a.map.flyTo({ center: [75.4, 29.8], zoom: innerWidth < 700 ? 4.6 : 5.4, duration: 1800 });
          await wait(1800);
        },
      },
      {
        hold: 9000,
        caption: () => `Smoke ignores borders. This season <b class="num">${pct(share(mo.delhi, "Punjab (Pakistan)"))}</b> of the fire activity on Delhi's air paths was in Pakistan's Punjab, and <b class="num">${pct(share(mo.lahore, "Punjab (India)"))}</b> of Lahore's was in India's. One plain, one sky.`,
        run: async () => {
          a.timeline.setHighlight(null);
          if (mo.lahore && mo.le && mo.iLahore >= 0) {
            a.setCity(mo.lahore.id);
            a.setTime(mo.le.t[mo.iLahore], true);
            await wait(1900);
            a.fitTrace(80, 2000);
            await wait(2100);
          }
        },
      },
      {
        hold: 9500,
        caption: () => {
          const r = a.last!;
          return fireFwd
            ? `Follow one fire forward. From a field in ${fireFwd.district}, the next 48 hours of wind carry its smoke over <b class="num">${fmtInt(r.towns.length)}</b> ${plural(r.towns.length, "town")} where <b class="num">${fmtPeopleIntl(r.people)}</b> people live.`
            : "Follow a fire forward to see which towns its smoke drifts over.";
        },
        run: async () => {
          a.mode = "back";
          a.setCity(mo.delhi.id);
          a.setTime(mo.e.t[mo.iBad], false);
          const r = await a.trace(false);
          if (r) {
            let best = -1, score = 0;
            r.weights.forEach((w, i) => { const sc = w * r.fires.frp[i]; if (sc > score) { score = sc; best = i; } });
            if (best >= 0) {
              const d = r.fires.d[best];
              const props = d >= 0 ? a.districts.features[d].properties! : null;
              fireFwd = { lat: r.fires.lat[best], lon: r.fires.lon[best], t: Math.round(r.fires.t[best] / 3600) * 3600,
                district: props ? String(props.name) : "the plain" };
              a.mode = "fwd";
              a.t = fireFwd.t;
              await a.setOrigin({ lat: fireFwd.lat, lon: fireFwd.lon, name: `A fire in ${fireFwd.district}`, cityId: null }, false);
              a.fitTrace(80, 2200);
              await wait(2300);
            }
          }
        },
      },
      {
        hold: 7000,
        caption: () => `Your turn. Search your town, click anywhere on the cloth, or drag the border to any hour since 1 October. Built on open data from the Registry of Open Data on AWS, with Amazon Location Service.`,
        run: async () => {
          a.mode = "back";
          a.setCity(mo.delhi.id);
          a.setTime(a.defaultTime(mo.e), true);
          await wait(1900);
          a.fitTrace(80, 2000);
          await wait(1800);
        },
      },
    ];

    this.active = true;
    const token = ++this.token;
    document.body.classList.add("touring");
    if (autoplay) document.body.classList.add("autoplay");
    // Video mode: ?holds=ms,ms,... sets each chapter's hold (to fit narration); ?upto=N stops early.
    const q = this.app.boot;
    const holds = (q.get("holds") ?? "").split(",").map(Number).filter((x) => x > 0);
    const upto = Math.min(chapters.length, Number(q.get("upto")) || chapters.length);
    const cap = $("#caption");
    cap.hidden = false;
    for (this.i = 0; this.i < upto; this.i++) {
      if (token !== this.token) return;
      const ch = chapters[this.i];
      $("#caption-text").innerHTML = "";
      cap.dataset.step = `${this.i + 1} / ${chapters.length}`;
      await ch.run();
      if (token !== this.token) return;
      $("#caption-text").innerHTML = ch.caption();
      cap.classList.remove("in"); void cap.offsetWidth; cap.classList.add("in");
      if (autoplay) console.info(`TOUR_CAPTION ${this.i} ${$("#caption-text").textContent}`);
      await this.hold(holds[this.i] ?? ch.hold, token);
    }
    if (autoplay) console.info("TOUR_END");
    if (token === this.token) this.stop();
  }

  private async hold(ms: number, token: number) {
    let left = ms;
    await new Promise<void>((done) => {
      this.skip = () => { left = 0; };
      const loop = () => {
        if (token !== this.token) return done();
        if (!this.paused) left -= 100;
        if (left <= 0) return done();
        setTimeout(loop, 100);
      };
      loop();
    });
    this.skip = null;
  }

  private togglePause() {
    this.paused = !this.paused;
    $("#tour-pause").setAttribute("aria-pressed", String(this.paused));
    $("#tour-pause").textContent = this.paused ? "Resume" : "Pause";
  }

  stop() {
    this.token++;
    this.active = false;
    this.paused = false;
    this.app.timeline.setHighlight(null);
    document.body.classList.remove("touring", "autoplay");
    $("#caption").hidden = true;
    $("#tour-pause").textContent = "Pause";
  }
}
