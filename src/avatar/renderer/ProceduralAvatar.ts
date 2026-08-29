/**
 * ZARA V1.0 — Real-time procedural avatar renderer (Directive §29-31).
 *
 * The avatar IS ZARA's body and reflects the ACTUAL internal state:
 *   IDLE→breathing idle · LISTENING→attentive gaze · THINKING→focused
 *   SPEAKING→mouth animation + lip sync · QUIET→calm dim · SLEEPING→sleep
 *   ERROR→subtle error tint. Real-time canvas rendering at display refresh —
 * explicitly NOT prerecorded MP4s (§30). The AvatarRenderer interface is
 * sized so a Three.js/PMX renderer can replace this one later.
 */
import { EmotionController } from "../emotion/EmotionController";
import { ZaraState } from "../../core/state/states";

export interface AvatarRenderer {
  start(canvas: HTMLCanvasElement): void;
  stop(): void;
  setState(state: ZaraState): void;
  setEnergy(level: number): void;   // mic/speaker energy 0..1 for animation
  onTap(cb: () => void): void;
}

export class ProceduralAvatarRenderer implements AvatarRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private lastT = 0;
  private state: ZaraState = "IDLE";
  private energy = 0;
  private smoothEnergy = 0;
  private blinkT = 0;
  private blinkNext = 2 + Math.random() * 3;
  private breathingPhase = 0;
  private gazeX = 0;
  private gazeY = 0;
  private gazeTargetX = 0;
  private gazeTargetY = 0;
  private gazeNext = 0;
  private tapCb: (() => void) | null = null;
  private particles: { x: number; y: number; vx: number; vy: number; life: number; max: number }[] = [];

  constructor(private emotions: EmotionController) {}

  start(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    canvas.addEventListener("pointerdown", () => this.tapCb?.());
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.lastT) / 1000 || 0.016);
      this.lastT = t;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setState(state: ZaraState): void { this.state = state; }
  setEnergy(level: number): void { this.energy = Math.max(0, Math.min(1, level)); }
  onTap(cb: () => void): void { this.tapCb = cb; }

  private frame(dt: number): void {
    const ctx = this.ctx, canvas = this.canvas;
    if (!ctx || !canvas) return;
    const w = canvas.width, h = canvas.height;
    this.emotions.update(dt);
    this.smoothEnergy += (this.energy - this.smoothEnergy) * Math.min(1, dt * 12);

    // Breathing (always alive, §61 "quietly alive")
    this.breathingPhase += dt * (this.state === "SLEEPING" ? 1.1 : 2.2);
    const breathe = Math.sin(this.breathingPhase) * (this.state === "SLEEPING" ? 0.012 : 0.02);

    // Blinking
    this.blinkT += dt;
    let blink = 0;
    if (this.blinkT > this.blinkNext) {
      const since = this.blinkT - this.blinkNext;
      blink = since < 0.13 ? Math.sin((since / 0.13) * Math.PI) : 0;
      if (since > 0.13) { this.blinkT = 0; this.blinkNext = 1.5 + Math.random() * 4; }
    }

    // Gaze drift (natural eye movement)
    this.gazeNext -= dt;
    if (this.gazeNext <= 0) {
      this.gazeNext = 1.5 + Math.random() * 3;
      const r = this.state === "LISTENING" ? 0.06 : 0.12;
      this.gazeTargetX = (Math.random() * 2 - 1) * r;
      this.gazeTargetY = (Math.random() * 2 - 1) * r * 0.6;
    }
    this.gazeX += (this.gazeTargetX - this.gazeX) * Math.min(1, dt * 4);
    this.gazeY += (this.gazeTargetY - this.gazeY) * Math.min(1, dt * 4);

    const pose = this.emotions.pose;
    const cx = w / 2, cy = h * 0.44;
    const baseR = Math.min(w, h) * 0.30;

    ctx.clearRect(0, 0, w, h);

    // ---- Aura / background glow ----
    const auraPulse = 0.75 + 0.25 * Math.sin(this.breathingPhase * 0.8) + this.smoothEnergy * 0.5;
    const grad = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 2.4);
    grad.addColorStop(0, hexA(pose.auraColor, 0.34 * pose.glowIntensity * auraPulse));
    grad.addColorStop(0.55, hexA(pose.auraColor, 0.10 * pose.glowIntensity));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // ---- Floating particles (presence field) ----
    if (this.particles.length < 26 && Math.random() < 0.3) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x: cx + Math.cos(a) * baseR * (1.4 + Math.random()),
        y: cy + Math.sin(a) * baseR * (1.4 + Math.random()),
        vx: (Math.random() - 0.5) * 6, vy: -8 - Math.random() * 10,
        life: 0, max: 3 + Math.random() * 4
      });
    }
    ctx.save();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life > p.max) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const alpha = (1 - p.life / p.max) * 0.5 * (0.4 + pose.glowIntensity);
      ctx.fillStyle = hexA(pose.eyeColor, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6 + Math.random() * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // ---- Head (orb) ----
    ctx.save();
    ctx.translate(cx, cy);
    const tilt = (pose.tiltDeg * Math.PI) / 180;
    ctx.rotate(tilt * 0.6);
    const headR = baseR * (1 + breathe);

    // Core orb — layered
    const orbGrad = ctx.createRadialGradient(-headR * 0.3, -headR * 0.35, headR * 0.1, 0, 0, headR);
    orbGrad.addColorStop(0, "rgba(235, 245, 255, 0.98)");
    orbGrad.addColorStop(0.35, hexA(pose.auraColor, 0.85));
    orbGrad.addColorStop(1, hexA("#0a0e14", 0.92));
    ctx.fillStyle = orbGrad;
    ctx.beginPath();
    ctx.arc(0, 0, headR, 0, Math.PI * 2);
    ctx.fill();

    // Rim light
    ctx.strokeStyle = hexA(pose.eyeColor, 0.35 + pose.glowIntensity * 0.4);
    ctx.lineWidth = 2;
    ctx.stroke();

    // ---- Eyes ----
    const eyeY = -headR * 0.05;
    const eyeDX = headR * 0.38;
    const eyeR = headR * 0.16;
    const openness = Math.max(0.03, pose.eyeOpenness * (1 - blink));
    for (const side of [-1, 1]) {
      const ex = side * eyeDX;
      // Socket shadow
      ctx.fillStyle = "rgba(6, 10, 18, 0.55)";
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeR * 1.25, eyeR * 1.25 * openness + eyeR * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Iris
      if (openness > 0.06) {
        const ix = ex + this.gazeX * headR * 0.3;
        const iy = eyeY + this.gazeY * headR * 0.3;
        const irisGrad = ctx.createRadialGradient(ix, iy - eyeR * 0.2, eyeR * 0.1, ix, iy, eyeR * 0.62);
        irisGrad.addColorStop(0, "#ffffff");
        irisGrad.addColorStop(0.35, pose.eyeColor);
        irisGrad.addColorStop(1, hexA(pose.auraColor, 0.9));
        ctx.fillStyle = irisGrad;
        ctx.beginPath();
        ctx.ellipse(ix, iy, eyeR * 0.62, eyeR * 0.62 * openness, 0, 0, Math.PI * 2);
        ctx.fill();
        // Pupil
        ctx.fillStyle = "rgba(8, 12, 20, 0.9)";
        ctx.beginPath();
        ctx.ellipse(ix, iy, eyeR * 0.26, eyeR * 0.26 * openness, 0, 0, Math.PI * 2);
        ctx.fill();
        // Highlight
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(ix - eyeR * 0.2, iy - eyeR * 0.22 * openness, eyeR * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      // Brow
      const browY = eyeY - eyeR * 1.7 - pose.browRaise * eyeR * 0.7;
      ctx.strokeStyle = hexA(pose.eyeColor, 0.8);
      ctx.lineWidth = headR * 0.045;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ex - eyeR * 0.8, browY + side * pose.browRaise * 2);
      ctx.quadraticCurveTo(ex, browY - eyeR * 0.25, ex + eyeR * 0.8, browY + side * 2);
      ctx.stroke();
    }

    // ---- Mouth (pose smile + lip-sync amplitude) ----
    const mouthY = headR * 0.42;
    const mouthW = headR * 0.46;
    const open = this.emotions.effectiveMouthOpen + this.smoothEnergy * 0.35;
    const smile = pose.mouthSmile;
    ctx.strokeStyle = "rgba(10, 14, 22, 0.85)";
    ctx.fillStyle = "rgba(10, 14, 22, 0.85)";
    ctx.lineWidth = headR * 0.035;
    ctx.beginPath();
    if (open > 0.08) {
      // Open mouth — ellipse whose height follows amplitude
      ctx.ellipse(0, mouthY, mouthW * 0.55, mouthW * (0.16 + open * 0.42), 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(-mouthW, mouthY - smile * headR * 0.06);
      ctx.quadraticCurveTo(0, mouthY + smile * headR * 0.14, mouthW, mouthY - smile * headR * 0.06);
      ctx.stroke();
    }

    // ---- Blush ----
    if (pose.blush > 0.02) {
      for (const side of [-1, 1]) {
        ctx.fillStyle = `rgba(255, 140, 170, ${0.35 * pose.blush})`;
        ctx.beginPath();
        ctx.ellipse(side * headR * 0.55, headR * 0.22, headR * 0.16, headR * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // ---- State ring (subtle, bottom) ----
    const stateColor: Record<ZaraState, string> = {
      BOOTING: "#7a8aa0", IDLE: "#3a4a6a", LISTENING: "#37c8b5", THINKING: "#8a6cff",
      PLANNING: "#b08cff", SPEAKING: "#4f9cff", WAITING: "#ffb347", INTERRUPTED: "#e05252",
      QUIET: "#4a6a7f", SLEEPING: "#2a3550", EXECUTING: "#3ecf8e", VERIFYING: "#3ecfb0", ERROR: "#e05252",
      SHUTTING_DOWN: "#55606e"
    };
    ctx.fillStyle = hexA(stateColor[this.state], 0.75);
    ctx.beginPath();
    ctx.arc(cx, h * 0.86, 5 + this.smoothEnergy * 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}
