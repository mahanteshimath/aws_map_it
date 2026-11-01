// The season as an embroidered border: one satin column per 3-hourly trace
// (height = fire activity the air crossed) under a strip of PM2.5 thread.
import type { Exposure } from "./data.ts";
import { C } from "./cloth.ts";
import { fmtDate, fmtWhen, pmBand } from "./format.ts";

const STEP = 3 * 3600;

export class Timeline {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private exp: Exposure | null = null;
  private t0 = 0;
  private t1 = 1;
  private t = 0;
  private dragging = false;
  private highlight: [number, number] | null = null;
  private maxFires = 1;
  private pad = { l: 18, r: 18 };

  constructor(private readonly host: HTMLElement, private readonly onChange: (t: number, commit: boolean) => void) {
    this.canvas = host.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.draw()).observe(host);
    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.pick(e.clientX, false);
    });
    this.canvas.addEventListener("pointermove", (e) => { if (this.dragging) this.pick(e.clientX, false); });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.pick(e.clientX, true);
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 86400 : STEP;
      let t = this.t;
      if (e.key === "ArrowRight") t += step;
      else if (e.key === "ArrowLeft") t -= step;
      else if (e.key === "Home") t = this.t0;
      else if (e.key === "End") t = this.t1;
      else return;
      e.preventDefault();
      this.onChange(this.clamp(t), true);
    });
  }

  setRange(t0: number, t1: number) {
    this.t0 = t0; this.t1 = t1;
    this.canvas.setAttribute("aria-valuemin", String(t0));
    this.canvas.setAttribute("aria-valuemax", String(t1));
    this.draw();
  }

  setSeries(exp: Exposure | null, label: string) {
    this.exp = exp;
    this.maxFires = exp ? Math.max(1, ...exp.fires.map((v) => v ?? 0)) : 1;
    this.host.querySelector(".border-label")!.textContent = label;
    this.draw();
  }

  setTime(t: number) {
    this.t = t;
    this.canvas.setAttribute("aria-valuenow", String(t));
    this.canvas.setAttribute("aria-valuetext", fmtWhen(t));
    this.draw();
  }

  /** Lift a span of days for the tour, or clear with null. */
  setHighlight(span: [number, number] | null) { this.highlight = span; this.draw(); }

  private clamp(t: number) {
    return Math.min(this.t1, Math.max(this.t0, Math.round(t / STEP) * STEP));
  }

  private x(t: number, w: number) {
    return this.pad.l + ((t - this.t0) / (this.t1 - this.t0)) * (w - this.pad.l - this.pad.r);
  }

  private pick(clientX: number, commit: boolean) {
    const r = this.canvas.getBoundingClientRect();
    const f = (clientX - r.left - this.pad.l) / (r.width - this.pad.l - this.pad.r);
    this.onChange(this.clamp(this.t0 + f * (this.t1 - this.t0)), commit);
  }

  private draw() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * dpr)) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const pmY = 12, pmH = 7, base = h - 24, colTop = pmY + pmH + 8;
    // running-stitch hems
    g.strokeStyle = "rgba(246,238,219,0.5)";
    g.lineWidth = 1.2;
    g.setLineDash([5, 4]);
    for (const y of [4.5, h - 4.5]) { g.beginPath(); g.moveTo(6, y); g.lineTo(w - 6, y); g.stroke(); }
    g.setLineDash([]);

    if (this.highlight) {
      const a = this.x(this.highlight[0], w), b = this.x(this.highlight[1], w);
      g.fillStyle = "rgba(246,238,219,0.08)";
      g.fillRect(a, 8, Math.max(2, b - a), h - 16);
    }

    const e = this.exp;
    if (e) {
      const n = e.t.length;
      const cw = Math.max(1.5, ((w - this.pad.l - this.pad.r) / Math.max(1, n)) * 0.62);
      for (let i = 0; i < n; i++) {
        const x = this.x(e.t[i], w);
        const obs = e.pm_obs[i], mod = e.pm_model[i];
        const pm = obs ?? mod;
        if (pm != null) {
          g.globalAlpha = obs != null ? 1 : 0.45;
          g.fillStyle = pmBand(pm).color;
          g.fillRect(x - cw / 2, pmY, cw + 0.6, obs != null ? pmH : pmH * 0.6);
          g.globalAlpha = 1;
        }
        const f = e.fires[i] ?? 0;
        if (f > 0) {
          const ch = Math.max(1.5, Math.sqrt(f / this.maxFires) * (base - colTop));
          g.fillStyle = C.goldDeep;
          g.fillRect(x - cw / 2, base - ch, cw, ch);
          g.fillStyle = C.gold;
          g.fillRect(x - cw / 2, base - ch, Math.max(1, cw * 0.55), ch);
        }
      }
    }
    // day ticks and labels
    g.font = "600 11px Khand, system-ui, sans-serif";
    g.textBaseline = "alphabetic";
    const days = Math.round((this.t1 - this.t0) / 86400);
    const every = w < 560 ? 7 : w < 980 ? 4 : 2;
    for (let k = 0; k <= days; k++) {
      const t = this.t0 + k * 86400 - (this.t0 % 86400) + 18.5 * 3600; // midnight IST
      if (t < this.t0 || t > this.t1) continue;
      const x = this.x(t, w);
      g.fillStyle = "rgba(233,215,184,0.35)";
      g.fillRect(x, base + 2, 1, 4);
      if (k % every === 0) {
        g.fillStyle = "rgba(233,215,184,0.8)";
        g.fillText(fmtDate(t + 3600), x + 3, h - 9);
      }
    }
    // needle
    const nx = this.x(this.t, w);
    g.strokeStyle = C.white;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(nx, 8); g.lineTo(nx, base + 4); g.stroke();
    g.fillStyle = C.white;
    g.beginPath(); g.moveTo(nx, 4); g.lineTo(nx + 5, 10); g.lineTo(nx, 16); g.lineTo(nx - 5, 10); g.closePath(); g.fill();
  }
}
