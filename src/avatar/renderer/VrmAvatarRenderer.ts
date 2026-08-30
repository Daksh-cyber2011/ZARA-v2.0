/**
 * ZARA V1.0 — VRM female avatar renderer (FINAL-INTEGRATION §6, §7, §8, §9, §29, §31).
 *
 * Renders the REAL female ZARA character (bundled VRM 1.0 model, pixiv Inc.,
 * redistribution permitted — see AUDIT-FINAL-INTEGRATION.md §F) using
 * Three.js + @pixiv/three-vrm inside the Capacitor WebView.
 *
 * The avatar is NOT decoration (§8): every visual behavior derives from the
 * REAL runtime state machine + the deterministic EmotionController via the
 * pure mappings in ./vrmMapping.ts. Speech animation is an honest controlled
 * approximation over VRM visemes (§9) — never claimed as phoneme lip-sync.
 *
 * Performance (§29): capped pixel ratio, no shadow maps, render loop pauses
 * when the page is hidden, all GPU resources disposed on stop().
 *
 * Fallback honesty: if WebGL or the VRM asset is unavailable, the renderer
 * reports status "error" and the UI keeps the procedural placeholder — never
 * a fake claim that the real character is showing.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { EmotionController } from "../emotion/EmotionController";
import { ZaraState } from "../../core/state/states";
import { AvatarRenderer } from "./ProceduralAvatar";
import {
  STATE_BEHAVIOR, EMOTION_EXPRESSIONS, DRIVEN_EXPRESSIONS, VISEMES,
  selectViseme, visemeWeight, speechEnvelope, gazeOffsetFor, frameIntervalFor,
  type VrmExpression, type Viseme
} from "./vrmMapping";

export type AvatarLoadStatus = "loading" | "ready" | "error";

/** §24: race any promise against a hard deadline. Exported for tests. */
export function raceWithDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms — falling back`)), ms);
    })
  ]);
}

export interface VrmAvatarOptions {
  /** URL of the VRM asset (default: bundled female character). */
  modelUrl?: string;
  /** Called when load state changes — for diagnostics + UI layering. */
  onStatus?: (status: AvatarLoadStatus, detail?: string) => void;
}

/** The bundled VRM model already faces +Z (toward a camera at positive Z). */
const MODEL_YAW_RAD = 0;

/** §24: hard ceiling on VRM asset loading — 12s covers slow tablet storage
 * while guaranteeing the procedural fallback engages instead of hanging. */
const VRM_LOAD_TIMEOUT_MS = 12000;

export class VrmAvatarRenderer implements AvatarRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private ambient: THREE.AmbientLight | null = null;
  private vrm: VRM | null = null;
  private gazeTarget: THREE.Object3D | null = null;
  private headPos = new THREE.Vector3();

  private raf = 0;
  private clock = new THREE.Clock();
  private time = 0;
  private stopped = false;
  private hidden = false;
  /** §35: accumulated real time since the last actually-rendered frame. */
  private frameAccumMs = 0;

  private state: ZaraState = "IDLE";
  private energy = 0;
  private tapCb: (() => void) | null = null;

  // Blink bookkeeping
  private blinkTimer = 0;
  private blinkNext = 2.5;
  private blinkAnim = -1; // -1 = not blinking; 0..1 = animation progress

  // Expression easing (weights approach targets smoothly, §30)
  private exprWeights = new Map<VrmExpression, number>();
  private exprTargets = new Map<VrmExpression, number>();

  // Viseme beat
  private visemeBeat = 0;
  private beatTimer = 0;
  private beatInterval = 0.15;
  private currentViseme: Viseme | null = null;

  // Gaze smoothing
  private gazeCurrent = new THREE.Vector3(0, 0.02, 1);
  private wanderSeed = Math.random() * 10;

  // Light easing
  private lightLevel = 1;

  private onVisibility = () => {
    this.hidden = typeof document !== "undefined" && document.hidden;
    if (this.hidden) this.pauseLoop();
    else this.resumeLoop();
  };

  constructor(private emotions: EmotionController, private opts: VrmAvatarOptions = {}) {}

  get ready(): boolean { return !!this.vrm && !this.stopped; }

  start(canvas: HTMLCanvasElement): void {
    this.opts.onStatus?.("loading");
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power"
      });
    } catch (err) {
      this.opts.onStatus?.("error", `WebGL unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.35, 0.9);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    this.keyLight.position.set(1.2, 1.8, 2.4);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(this.keyLight, this.ambient);

    this.gazeTarget = new THREE.Object3D();
    this.gazeTarget.position.set(0, 1.4, 1);
    this.scene.add(this.gazeTarget);

    canvas.addEventListener("pointerdown", () => this.tapCb?.());
    this.resize(canvas);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => this.resize(canvas));
      document.addEventListener("visibilitychange", this.onVisibility);
    }

    void this.loadModel(this.opts.modelUrl ?? "assets/ZARA-avatar.vrm");
    this.resumeLoop();
  }

  private resize(canvas: HTMLCanvasElement): void {
    if (!this.renderer || !this.camera) return;
    const w = Math.max(1, canvas.clientWidth || 640);
    const h = Math.max(1, canvas.clientHeight || 640);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private async loadModel(url: string): Promise<void> {
    let gltf: { userData: { vrm?: VRM }; scene: THREE.Object3D };
    try {
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));
      // §24: VRM loading must be BOUNDED. A stalled fetch on a slow tablet
      // must degrade to the procedural fallback, not hang "loading" forever.
      gltf = await raceWithDeadline(
        loader.loadAsync(url),
        VRM_LOAD_TIMEOUT_MS,
        "VRM asset load"
      );
    } catch (err) {
      if (!this.stopped) {
        this.opts.onStatus?.("error", `VRM asset failed to load: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    if (this.stopped || !this.scene) return;
    const vrm = gltf.userData.vrm;
    if (!vrm) {
      this.opts.onStatus?.("error", "File is not a VRM model (no VRM extension).");
      return;
    }
    this.vrm = vrm;
    vrm.scene.rotation.y = MODEL_YAW_RAD;
    // Merge fragmented skeletons → materially fewer draw-call bones on mobile.
    try { VRMUtils.combineSkeletons(vrm.scene); } catch { /* optional optimization */ }

    if (vrm.lookAt && this.gazeTarget) vrm.lookAt.target = this.gazeTarget;
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    if (head) head.getWorldPosition(this.headPos);
    this.frameCamera();

    this.scene.add(vrm.scene);
    // Boot: eyes closed → they open as BOOTING completes (§8 waking animation).
    this.blinkTimer = 0;
    this.opts.onStatus?.("ready");
  }

  /** Bust-portrait framing derived from the actual head bone position. */
  private frameCamera(): void {
    if (!this.camera) return;
    const hy = this.headPos.y || 1.35;
    this.camera.position.set(0, hy - 0.02, 0.88);
    this.camera.lookAt(0, hy - 0.12, 0);
  }

  stop(): void {
    this.stopped = true;
    this.pauseLoop();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.vrm) {
      try { VRMUtils.deepDispose(this.vrm.scene); } catch { /* already gone */ }
      this.vrm = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
  }

  setState(state: ZaraState): void { this.state = state; }
  setEnergy(level: number): void { this.energy = Math.max(0, Math.min(1, level)); }
  onTap(cb: () => void): void { this.tapCb = cb; }

  private pauseLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resumeLoop(): void {
    if (this.raf || this.stopped || this.hidden) return;
    this.clock.getDelta(); // discard stale delta
    const loop = () => {
      if (this.stopped) return;
      // §35 adaptive frame rate: tick the clock every rAF (cheap) but only
      // RENDER when the accumulated time exceeds the current state's target
      // frame interval. Idle/quiet/sleeping states throttle to 20/12 fps;
      // active states render at the full display rate.
      const dtMs = this.clock.getDelta() * 1000;
      this.frameAccumMs += dtMs;
      const interval = frameIntervalFor(this.state);
      if (this.frameAccumMs >= interval) {
        const dt = Math.min(0.05, this.frameAccumMs / 1000);
        this.frameAccumMs = 0;
        this.frame(dt);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(dt: number): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.time += dt;
    const t = this.time;
    const behavior = STATE_BEHAVIOR[this.state];
    const emotion = this.emotions.emotion;
    this.emotions.update(dt);

    /* ---- expression targets (emotion + state biases) ---- */
    this.exprTargets.clear();
    const target = EMOTION_EXPRESSIONS[emotion];
    for (const [name, w] of Object.entries(target ?? {})) {
      this.exprTargets.set(name as VrmExpression, w as number);
    }
    // State bias: LISTENING/WAITING attentive micro-lift; ERROR adds concern.
    if (this.state === "LISTENING" || this.state === "WAITING") {
      this.exprTargets.set("happy", Math.max(this.exprTargets.get("happy") ?? 0, 0.15));
    }

    /* ---- blink / forced eye close ---- */
    let blinkWeight = behavior.forcedEyeClose;
    if (behavior.blinkRate > 0 && behavior.forcedEyeClose < 0.5) {
      this.blinkTimer += dt;
      if (this.blinkAnim >= 0) {
        this.blinkAnim += dt / 0.14;
        if (this.blinkAnim >= 1) { this.blinkAnim = -1; }
        else blinkWeight = Math.max(blinkWeight, Math.sin(this.blinkAnim * Math.PI));
      } else if (this.blinkTimer > this.blinkNext) {
        this.blinkTimer = 0;
        this.blinkNext = Math.max(0.8, 60 / behavior.blinkRate) * (0.6 + Math.random() * 0.8);
        this.blinkAnim = 0;
      }
    }
    this.exprTargets.set("blink", Math.max(this.exprTargets.get("blink") ?? 0, blinkWeight));

    /* ---- gaze ---- */
    if (this.gazeTarget) {
      const off = gazeOffsetFor(behavior.gazeMode, t, this.wanderSeed);
      const desired = new THREE.Vector3(
        this.headPos.x + off.x,
        this.headPos.y + off.y,
        this.headPos.z + off.z
      );
      const k = 1 - Math.exp(-dt * (2 + behavior.gazeStability * 8));
      this.gazeCurrent.lerp(desired, k);
      this.gazeTarget.position.copy(this.gazeCurrent);
    }

    /* ---- speech visemes (§9 controlled approximation) ---- */
    const speaking = this.state === "SPEAKING";
    const envelope = speechEnvelope(t, speaking) * (0.55 + 0.45 * this.energy);
    if (speaking) {
      this.beatTimer += dt;
      if (this.beatTimer >= this.beatInterval) {
        this.beatTimer = 0;
        this.beatInterval = 0.12 + Math.random() * 0.06;
        this.visemeBeat++;
        this.currentViseme = selectViseme(envelope, this.visemeBeat);
      }
    } else {
      this.currentViseme = null;
    }

    /* ---- apply expressions + visemes (smoothed) ---- */
    const em = this.vrm?.expressionManager;
    if (em) {
      const ease = 1 - Math.exp(-dt * 10);
      for (const name of DRIVEN_EXPRESSIONS) {
        const targetW = this.exprTargets.get(name) ?? 0;
        const cur = this.exprWeights.get(name) ?? 0;
        const next = cur + (targetW - cur) * ease;
        this.exprWeights.set(name, next);
        em.setValue(name, Math.max(0, Math.min(1, next)));
      }
      for (const v of VISEMES) {
        const targetW = this.currentViseme === v ? visemeWeight(envelope) : 0;
        const cur = this.exprWeights.get(v as VrmExpression) ?? 0;
        const next = cur + (targetW - cur) * (1 - Math.exp(-dt * 18));
        this.exprWeights.set(v as VrmExpression, next);
        em.setValue(v, Math.max(0, Math.min(1, next)));
      }
    }

    /* ---- breathing + sway (root-level: no bone conflicts, §29 cheap) ---- */
    if (this.vrm) {
      const breathPhase = t * (Math.PI * 2 * behavior.breathRate / 60);
      const bob = Math.sin(breathPhase) * 0.008 * behavior.breathDepth;
      const sway = behavior.bodySway > 0 ? Math.sin(t * 0.42) * 0.015 * behavior.bodySway : 0;
      this.vrm.scene.position.y = bob;
      this.vrm.scene.rotation.z = sway;
    }

    /* ---- light easing ---- */
    if (this.keyLight && this.ambient) {
      this.lightLevel += (behavior.lightIntensity - this.lightLevel) * (1 - Math.exp(-dt * 4));
      this.keyLight.intensity = 1.35 * this.lightLevel;
      this.ambient.intensity = 0.6 * this.lightLevel;
    }

    /* ---- update + render ---- */
    this.vrm?.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
