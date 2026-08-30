/**
 * ZARA V2 — Living Layer.
 *
 * A 2D canvas rendered BEHIND the 3D avatar that makes the stage feel alive:
 *   - a soft containment glow that breathes with ZARA's speech energy
 *   - a rotating reticle ring with tick marks under the avatar
 *   - orbiting "data motes" that accelerate while ZARA speaks
 *   - rising side-streams (left/right data columns)
 *   - pulse rings that fire on speech beats
 *
 * Everything is driven by the REAL runtime: theme colors come from the
 * deterministic emotion themes, energy comes from the speech envelope (§9).
 * Original ZARA visual language — not lifted from any reference app.
 *
 * Performance: 30fps cap on touch devices / 60 on pointer:fine, pauses when
 * the page is hidden, disposes cleanly on stop().
 */
import { StageTheme, themeFor, hexToRgbTriple } from "./themes";
import { AvatarEmotion } from "../emotion/EmotionController";

const TAU = Math.PI * 2;

interface Mote {
  angle: number;
  radius: number;   // 0..1 relative
  speed: number;
  size: number;
  alpha: number;
  band: number;     // orbit band index
}

interface Stream {
  x: number;        // 0..1 relative
  y: number;        // px
  speed: number;
  size: number;
  alpha: number;
}

interface Pulse {
  r: number;
  alpha: number;
}

export class LivingLayer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private time = 0;
  private stopped = false;
  private hidden = false;

  /** Smoothed energy 0..1 (speech envelope). */
  private energy = 0;
  private energyTarget = 0;
  /** Beat detection: fires a pulse ring on rising energy. */
  private lastBeat = 0;

  /** Theme colors currently painted (eased toward target). */
  private cur = { ...this.triples(themeFor("neutral")) };
  private target = this.cur;

  private motes: Mote[] = [];
  private streams: Stream[] = [];
  private pulses: Pulse[] = [];

  private frameBudgetMs = 1000 / 60;

  private onResize = () => this.resize();
  private onVisibility = () => {
    this.hidden = typeof document !== "undefined" && document.hidden;
    if (this.hidden) this.pause();
    else this.resume();
  };

  start(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    if (!this.ctx) return;
    this.stopped = false;
    // Touch devices: 30fps is plenty for ambient motion and halves the cost.
    const coarse = typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent));
    this.frameBudgetMs = coarse ? 1000 / 30 : 1000 / 60;
    this.resize();
    this.seed();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.onResize);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.resume();
  }

  stop(): void {
    this.stopped = true;
    this.pause();
    if (typeof document !== "undefined") {
      window.removeEventListener("resize", this.onResize);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    this.canvas = null;
    this.ctx = null;
  }

  /** Speech/mic energy 0..1 — the layer breathes with it. */
  setEnergy(e: number): void {
    const v = Math.max(0, Math.min(1, e));
    this.energyTarget = v;
    // Rising edge → pulse ring (throttled).
    if (v > 0.55 && this.energy < 0.45 && this.time - this.lastBeat > 0.28) {
      this.lastBeat = this.time;
      this.pulses.push({ r: 0.16, alpha: 0.5 });
    }
  }

  /** New emotion → retarget all colors (eased in the paint loop). */
  setEmotion(emotion: AvatarEmotion): void {
    this.target = this.triples(themeFor(emotion));
  }

  /* ------------------------------ internals ------------------------------ */

  private triples(t: StageTheme): { p: [number, number, number]; s: [number, number, number] } {
    return { p: hexToRgbTriple(t.primary), s: hexToRgbTriple(t.secondary) };
  }

  private resize(): void {
    const c = this.canvas;
    if (!c) return;
    this.dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2);
    this.w = c.clientWidth || c.offsetWidth || 320;
    this.h = c.clientHeight || c.offsetHeight || 480;
    c.width = Math.max(1, Math.round(this.w * this.dpr));
    c.height = Math.max(1, Math.round(this.h * this.dpr));
    this.seed();
  }

  private seed(): void {
    // Orbiting motes in 3 elliptical bands around the avatar base.
    this.motes = Array.from({ length: 34 }, () => {
      const band = Math.floor(Math.random() * 3);
      return {
        angle: Math.random() * TAU,
        radius: 0.42 + band * 0.13 + Math.random() * 0.05,
        speed: (0.12 + Math.random() * 0.22) * (Math.random() < 0.5 ? 1 : -1),
        size: 0.6 + Math.random() * 1.6,
        alpha: 0.25 + Math.random() * 0.5,
        band
      };
    });
    // Rising side streams — two soft columns flanking the character.
    this.streams = Array.from({ length: 26 }, (_, i) => ({
      x: i % 2 === 0 ? 0.1 + Math.random() * 0.08 : 0.82 + Math.random() * 0.08,
      y: Math.random(),
      speed: 0.05 + Math.random() * 0.1,
      size: 0.8 + Math.random() * 1.4,
      alpha: 0.15 + Math.random() * 0.35
    }));
    this.pulses = [];
  }

  private pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resume(): void {
    if (this.raf || this.stopped || this.hidden || !this.ctx) return;
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.stopped) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      if (dt * 1000 >= this.frameBudgetMs * 0.75) {
        this.last = now;
        this.step(dt);
        this.paint();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private step(dt: number): void {
    this.time += dt;
    this.energy += (this.energyTarget - this.energy) * Math.min(1, dt * 9);
    // Ease theme colors (~1s transition).
    const k = Math.min(1, dt * 3.2);
    for (let i = 0; i < 3; i++) {
      this.cur.p[i] += (this.target.p[i] - this.cur.p[i]) * k;
      this.cur.s[i] += (this.target.s[i] - this.cur.s[i]) * k;
    }
    const spin = 1 + this.energy * 2.2;
    for (const m of this.motes) {
      m.angle += m.speed * dt * spin;
    }
    for (const s of this.streams) {
      s.y -= s.speed * dt * (1 + this.energy * 1.4);
      if (s.y < -0.05) s.y = 1.05;
    }
    for (const p of this.pulses) {
      p.r += dt * 0.55;
      p.alpha -= dt * 0.9;
    }
    this.pulses = this.pulses.filter(p => p.alpha > 0);
  }

  private paint(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    // The stage base sits in the lower third — avatar feet territory.
    const cy = h * 0.78;
    const R = Math.min(w * 0.42, h * 0.3);
    const [pr, pg, pb] = this.cur.p;
    const [sr, sg, sb] = this.cur.s;
    const P = (a: number) => `rgba(${pr | 0},${pg | 0},${pb | 0},${a})`;
    const S = (a: number) => `rgba(${sr | 0},${sg | 0},${sb | 0},${a})`;

    /* 1 — containment glow (breathes with energy) */
    const breathe = 0.75 + Math.sin(this.time * 1.1) * 0.06 + this.energy * 0.5;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.1);
    glow.addColorStop(0, P(0.10 * breathe));
    glow.addColorStop(0.45, P(0.045 * breathe));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    /* 2 — reticle ring + tick marks (slow rotation, ZARA's signature mark) */
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.time * 0.06);
    ctx.strokeStyle = P(0.22 + this.energy * 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, R, R * 0.28, 0, 0, TAU);
    ctx.stroke();
    // Tick marks
    ctx.strokeStyle = P(0.35 + this.energy * 0.25);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const long = i % 6 === 0;
      const r1 = R * (long ? 1.045 : 1.02);
      const r2 = R * (long ? 1.11 : 1.05);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.28);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2 * 0.28);
      ctx.lineWidth = long ? 1.5 : 1;
      ctx.stroke();
    }
    ctx.restore();

    /* 3 — orbiting data motes (elliptical bands) */
    for (const m of this.motes) {
      const x = cx + Math.cos(m.angle) * R * m.radius;
      const y = cy + Math.sin(m.angle) * R * m.radius * 0.28 - Math.abs(Math.sin(m.angle)) * R * 0.18;
      const depth = 0.55 + 0.45 * Math.sin(m.angle); // front = brighter
      const a = m.alpha * (0.3 + depth * 0.7) * (0.7 + this.energy * 0.8);
      ctx.fillStyle = m.band === 2 ? S(a) : P(a);
      ctx.beginPath();
      ctx.arc(x, y, m.size * (0.8 + depth * 0.5), 0, TAU);
      ctx.fill();
    }

    /* 4 — rising side streams */
    for (const s of this.streams) {
      const x = w * s.x + Math.sin(this.time * 0.8 + s.y * 6) * 6;
      const y = s.y * h;
      const fade = s.y * (1 - s.y) * 4; // fade near edges
      ctx.fillStyle = P(s.alpha * Math.max(0, fade) * (0.6 + this.energy * 0.7));
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, TAU);
      ctx.fill();
    }

    /* 5 — pulse rings on speech beats */
    for (const p of this.pulses) {
      ctx.strokeStyle = P(Math.max(0, p.alpha));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R * p.r * 1.6, R * p.r * 1.6 * 0.3, 0, 0, TAU);
      ctx.stroke();
    }

    /* 6 — horizon light line */
    const horizon = ctx.createLinearGradient(cx - w * 0.4, 0, cx + w * 0.4, 0);
    horizon.addColorStop(0, "rgba(0,0,0,0)");
    horizon.addColorStop(0.5, P(0.14 + this.energy * 0.2));
    horizon.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = horizon;
    ctx.fillRect(cx - w * 0.4, cy + R * 0.30, w * 0.8, 1);
  }
}
