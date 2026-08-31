/**
 * ZARA V2 — VRM avatar renderer.
 *
 * Renders the REAL female ZARA character (bundled VRM 1.0 model, pixiv Inc.,
 * redistribution permitted) using Three.js + @pixiv/three-vrm.
 *
 * V2 stage system (the "make the model actually shine" rewrite):
 *   - Auto-framing from the model's REAL bounding box — bust/full presets can
 *     never be cut off or mis-framed again (fixes V1's fixed 0.88m bust cam).
 *   - Full camera rig: 1-finger orbit · pinch zoom · two-finger pan ·
 *     double-tap reset (touch); drag orbit · wheel zoom · WASD/QE (mouse);
 *     view presets (portrait/front/three-quarter/side/back/full);
 *     eye-tracking toggle; view lock.
 *   - Cinematic 4-light setup (key / cool fill / violet rim / ambient) so the
 *     anime shading reads crisp on the dark stage.
 *   - Holo-stage: gradient floor disc + glowing emotion ring under her feet.
 *   - Emotion themes: rim light + ring recolor with the runtime emotion.
 *   - Quality tiers: touch devices (pixelRatio ≤1.5, 30fps), desktop (≤2, 60fps).
 *   - Load progress (phase + ratio) reported to the UI boot sequence.
 *
 * Honesty preserved (V1 contracts): if WebGL or the VRM asset is unavailable
 * the renderer reports status "error" and the UI keeps its fallback — never a
 * fake claim. `raceWithDeadline` stays exported (tests import it).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { EmotionController } from "../emotion/EmotionController";
import { ZaraState } from "../../core/state/states";
import { AvatarRenderer } from "./ProceduralAvatar";
import { themeFor } from "../stage/themes";
import {
  STATE_BEHAVIOR, EMOTION_EXPRESSIONS, DRIVEN_EXPRESSIONS, VISEMES,
  selectViseme, visemeWeight, speechEnvelope, gazeOffsetFor,
  type VrmExpression, type Viseme
} from "./vrmMapping";
import { VIEW_SPECS, baseDistance, viewDistance, clampZoom, type FramingInput } from "./framing";

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
  /** Load lifecycle for the boot sequence / diagnostics. */
  onStatus?: (status: AvatarLoadStatus, detail?: string) => void;
  /** Load progress: phase label + 0..1 ratio. */
  onProgress?: (phase: string, ratio: number) => void;
}

/** Camera presets. Distances are resolved per-view from the real model
 * bounds AND the current canvas aspect (aspect-aware framing — V2.1). */
export type CameraView = "portrait" | "front" | "threeQuarter" | "side" | "back" | "full";

interface CameraRig {
  yaw: number;      // radians around Y
  pitch: number;    // radians above horizon
  dist: number;     // metres from target
  target: THREE.Vector3;
}

/** §24: hard ceiling on VRM asset loading. */
const VRM_LOAD_TIMEOUT_MS = 20000;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class VrmAvatarRenderer implements AvatarRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private fillLight: THREE.DirectionalLight | null = null;
  private rimLight: THREE.DirectionalLight | null = null;
  private ambient: THREE.AmbientLight | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private vrm: VRM | null = null;
  private gazeTarget: THREE.Object3D | null = null;

  /* model measurements (resolved after load — the auto-framing fix) */
  private headY = 1.42;
  private chestY = 1.12;
  private hipsY = 0.92;
  private modelHeight = 1.55;
  private modelRadius = 0.5;

  /* camera rig state */
  private rig: CameraRig = { yaw: -0.35, pitch: 0.1, dist: 1.9, target: new THREE.Vector3(0, 1.0, 0) };
  private rigGoal: CameraRig = { yaw: -0.35, pitch: 0.1, dist: 1.9, target: new THREE.Vector3(0, 1.0, 0) };
  private view: CameraView = "threeQuarter";
  private viewLocked = false;
  private eyeTracking = true;
  private baseDist = 1.9;
  private aspect = 1;
  private resizeObserver: ResizeObserver | null = null;

  private raf = 0;
  private clock = new THREE.Clock();
  private time = 0;
  private stopped = false;
  private hidden = false;
  private frameAccumMs = 0;
  private frameBudgetMs = 1000 / 60;

  private state: ZaraState = "IDLE";
  private energy = 0;
  private tapCb: (() => void) | null = null;

  /* pointer (mouse eye-tracking + fine-pointer orbit) */
  private pointerNdc = new THREE.Vector2(0, 0);

  /* blink bookkeeping */
  private blinkTimer = 0;
  private blinkNext = 2.5;
  private blinkAnim = -1;

  /* expression easing */
  private exprWeights = new Map<VrmExpression, number>();
  private exprTargets = new Map<VrmExpression, number>();

  /* viseme beat */
  private visemeBeat = 0;
  private beatTimer = 0;
  private beatInterval = 0.15;
  private currentViseme: Viseme | null = null;

  /* gaze smoothing */
  private gazeCurrent = new THREE.Vector3(0, 0.02, 1);
  private wanderSeed = Math.random() * 10;

  /* theme (emotion) colors for rim light + ring — eased */
  private themeCur = new THREE.Color("#22d3ee");
  private themeGoal = new THREE.Color("#22d3ee");

  /* light easing */
  private lightLevel = 1;

  /* touch gesture state */
  private touches = new Map<number, { x: number; y: number }>();
  private tapAt = 0;
  private tapPos = { x: 0, y: 0 };
  private lastPinch = 0;

  private onVisibility = () => {
    this.hidden = typeof document !== "undefined" && document.hidden;
    if (this.hidden) this.pauseLoop();
    else this.resumeLoop();
  };

  constructor(private emotions: EmotionController, private opts: VrmAvatarOptions = {}) {}

  get ready(): boolean { return !!this.vrm && !this.stopped; }
  get isViewLocked(): boolean { return this.viewLocked; }
  get isEyeTracking(): boolean { return this.eyeTracking; }
  get currentView(): CameraView { return this.view; }

  /* ------------------------------ lifecycle ------------------------------ */

  start(canvas: HTMLCanvasElement): void {
    this.opts.onStatus?.("loading");
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
      });
    } catch (err) {
      const detail = `WebGL unavailable: ${err instanceof Error ? err.message : String(err)}`;
      console.warn("[ZARA-avatar]", detail);
      this.opts.onStatus?.("error", detail);
      return;
    }
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Quality tier: touch devices cap the pixel ratio (fill-rate) + fps.
    const coarse = typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent));
    const maxRatio = coarse ? 1.5 : 2;
    this.frameBudgetMs = coarse ? 1000 / 30 : 1000 / 60;
    this.renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, maxRatio));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);

    /* Cinematic light rig — key (warm front-left), fill (cool right),
     * violet rim (back-top) for that holographic edge, ambient base. */
    this.keyLight = new THREE.DirectionalLight(0xfff4ec, 1.05);
    this.keyLight.position.set(1.4, 2.1, 2.6);
    this.fillLight = new THREE.DirectionalLight(0xbfe8ff, 0.38);
    this.fillLight.position.set(-2.0, 1.4, 1.6);
    this.rimLight = new THREE.DirectionalLight(0x8b5cf6, 0.85);
    this.rimLight.position.set(-0.6, 2.4, -2.2);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.52);
    this.scene.add(this.keyLight, this.fillLight, this.rimLight, this.ambient);

    /* Holo-stage: soft floor disc + glowing emotion ring (recolors live). */
    this.buildStage();

    this.gazeTarget = new THREE.Object3D();
    this.gazeTarget.position.set(0, 1.45, 1);
    this.scene.add(this.gazeTarget);

    this.bindInput(canvas);
    this.resize(canvas);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => this.resize(canvas));
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    // Robust resize on WebViews where orientation changes do not always fire
    // a window resize event (split-layout transitions, foldables, tablets).
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize(canvas));
      this.resizeObserver.observe(canvas);
      if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    }

    void this.loadModel(this.opts.modelUrl ?? "assets/ZARA-avatar.vrm");
    this.resumeLoop();
  }

  /** Gradient floor disc + double glowing ring at her feet. */
  private buildStage(): void {
    if (!this.scene) return;
    const R = 0.62;

    // Floor disc: radial gradient texture (dark center fade to transparent).
    const size = 256;
    const cnv = document.createElement("canvas");
    cnv.width = cnv.height = size;
    const g = cnv.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0, "rgba(120,150,200,0.20)");
      grad.addColorStop(0.55, "rgba(90,120,180,0.08)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    const floorTex = new THREE.CanvasTexture(cnv);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R * 1.9, 48),
      new THREE.MeshBasicMaterial({ map: floorTex, transparent: true, depthWrite: false })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.001;
    this.scene.add(floor);

    // Emotion ring (outer) — recolors with the theme, pulses with energy.
    this.ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#22d3ee"),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.98, R * 1.03, 64), this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    this.scene.add(ring);

    // Inner hairline ring.
    const innerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#6366f1"),
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const inner = new THREE.Mesh(new THREE.RingGeometry(R * 0.62, R * 0.64, 48), innerMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.003;
    this.scene.add(inner);
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = "none";

    /* ---- touch: orbit / pinch / pan / double-tap ---- */
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      canvas.setPointerCapture?.(e.pointerId);
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.tapPos = { x: e.clientX, y: e.clientY };
      this.tapAt = performance.now();
      if (this.touches.size === 2) {
        const pts = [...this.touches.values()];
        this.lastPinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
      this.tapCb?.();
    }, { passive: false });

    canvas.addEventListener("pointermove", (e) => {
      // Mouse → eye tracking target (always, even while orbiting).
      if (e.pointerType === "mouse") {
        this.pointerNdc.set(
          (e.clientX / window.innerWidth) * 2 - 1,
          -(e.clientY / window.innerHeight) * 2 + 1
        );
        return;
      }
      const prev = this.touches.get(e.pointerId);
      if (!prev) return;
      const ptsBefore = [...this.touches.values()];
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...this.touches.values()];
      if (pts.length === 1 && !this.viewLocked) {
        this.orbitBy((e.clientX - prev.x) * 0.0062, -(e.clientY - prev.y) * 0.0046);
      } else if (pts.length >= 2 && ptsBefore.length >= 2 && !this.viewLocked) {
        const pinch = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.lastPinch > 0) this.zoomBy((this.lastPinch - pinch) * 0.028);
        this.lastPinch = pinch;
        // Two-finger pan (midpoint delta).
        const midBefore = { x: (ptsBefore[0].x + ptsBefore[1].x) / 2, y: (ptsBefore[0].y + ptsBefore[1].y) / 2 };
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        this.panBy((mid.x - midBefore.x) * -0.0016, (mid.y - midBefore.y) * 0.0016);
      }
      e.preventDefault();
    }, { passive: false });

    const endTouch = (e: PointerEvent) => {
      const wasSingle = this.touches.size === 1;
      this.touches.delete(e.pointerId);
      this.lastPinch = 0;
      if (wasSingle) {
        const dur = performance.now() - this.tapAt;
        const moved = Math.hypot(e.clientX - this.tapPos.x, e.clientY - this.tapPos.y);
        if (dur < 280 && moved < 16) this.resetView(); // double-tap → reset
      }
    };
    canvas.addEventListener("pointerup", endTouch);
    canvas.addEventListener("pointercancel", endTouch);

    /* ---- mouse: drag orbit, wheel zoom ---- */
    let dragging = false;
    let lastMouse = { x: 0, y: 0 };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      dragging = true;
      lastMouse = { x: e.clientX, y: e.clientY };
      this.tapCb?.();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || !dragging || this.viewLocked) return;
      this.orbitBy((e.clientX - lastMouse.x) * 0.005, -(e.clientY - lastMouse.y) * 0.0035);
      lastMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY * 0.0016);
    }, { passive: false });

    /* ---- keyboard: WASD/QE + presets (fine pointers only) ---- */
    const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (!coarse) {
      const keys = new Set<string>();
      // NOTE: this loop uses its OWN timestamp source — sharing this.clock
      // here would consume the render loop's deltas and freeze all rendering
      // (the exact bug that hid the model in the first V2 build).
      let keyNow = performance.now();
      window.addEventListener("keydown", (e) => {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
        const k = e.key.toLowerCase();
        if ("wasdqe".includes(k) && k.length === 1) { keys.add(k); e.preventDefault(); return; }
        if (k === "r") { this.resetView(); e.preventDefault(); }
        if (k === "l") { this.setViewLocked(!this.viewLocked); }
        if (k === "f") { this.setEyeTracking(!this.eyeTracking); }
        if (k === "1") { this.setView("portrait"); }
        if (k === "2") { this.setView("front"); }
        if (k === "3") { this.setView("threeQuarter"); }
        if (k === "4") { this.setView("side"); }
        if (k === "5") { this.setView("back"); }
        if (k === "6") { this.setView("full"); }
      });
      window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
      window.addEventListener("blur", () => keys.clear());
      const keyLoop = () => {
        if (this.stopped) return;
        const now = performance.now();
        const dt = Math.min(0.05, (now - keyNow) / 1000);
        keyNow = now;
        if (keys.size && !this.viewLocked) {
          if (keys.has("a")) this.orbitBy(-1.6 * dt, 0);
          if (keys.has("d")) this.orbitBy(1.6 * dt, 0);
          if (keys.has("w")) this.orbitBy(0, 0.55 * dt);
          if (keys.has("s")) this.orbitBy(0, -0.55 * dt);
          if (keys.has("q")) this.zoomBy(2.4 * dt);
          if (keys.has("e")) this.zoomBy(-2.4 * dt);
        }
        requestAnimationFrame(keyLoop);
      };
      requestAnimationFrame(keyLoop);
    }
  }

  /* ------------------------------ rest pose ------------------------------ */

  /** Relaxed A-stance on the normalized humanoid rig (identity = T-pose).
   * Arms come down to a natural carry, elbows soften forward — she reads as
   * a living companion rather than a rigging asset. */
  private applyRestPose(vrm: VRM): void {
    const h = vrm.humanoid;
    if (!h) return;
    const set = (name: string, x: number, y: number, z: number) => {
      const node = h.getNormalizedBoneNode(name as never);
      if (node) node.rotation.set(x, y, z);
    };
    // Arms down (~72°) — model faces +Z; her left arm extends +X, right -X.
    set("leftUpperArm", 0, 0, -1.26);
    set("rightUpperArm", 0, 0, 1.26);
    // Soft elbow bend, slightly forward.
    set("leftLowerArm", 0, -0.22, 0);
    set("rightLowerArm", 0, 0.22, 0);
    // Relaxed hands.
    set("leftHand", 0, 0, -0.08);
    set("rightHand", 0, 0, 0.08);
    // Subtle weight shift for a natural stance.
    set("leftUpperLeg", 0.02, 0, -0.03);
    set("rightUpperLeg", -0.02, 0, 0.03);
  }

  /* ------------------------------ camera API ------------------------------ */

  orbitBy(dYaw: number, dPitch: number): void {
    this.rigGoal.yaw += dYaw;
    this.rigGoal.pitch = clamp(this.rigGoal.pitch + dPitch, -0.35, 0.75);
  }

  zoomBy(delta: number): void {
    this.rigGoal.dist = clampZoom(this.rigGoal.dist * (1 + delta), this.baseDist);
  }

  panBy(dx: number, dy: number): void {
    const right = new THREE.Vector3(Math.cos(this.rig.yaw), 0, -Math.sin(this.rig.yaw));
    this.rigGoal.target.addScaledVector(right, dx * this.rig.dist);
    const minY = this.hipsY * 0.4;
    const maxY = this.headY * 1.15;
    this.rigGoal.target.y = clamp(this.rigGoal.target.y + dy * this.rig.dist, minY, maxY);
  }

  setView(view: CameraView): void {
    this.view = view;
    this.applyViewGeometry();
  }

  /** Recompute the current view's yaw/pitch/dist/target from the REAL model
   * bounds + current canvas aspect (the aspect-aware framing core). */
  private applyViewGeometry(): void {
    const spec = VIEW_SPECS[this.view];
    if (!spec) return;
    const input: FramingInput = {
      modelHeight: this.modelHeight,
      modelRadius: this.modelRadius,
      fovDeg: this.camera?.fov ?? 30,
      aspect: this.aspect
    };
    const { dist, focusY } = viewDistance(input, spec);
    this.rigGoal.yaw = spec.yaw;
    this.rigGoal.pitch = spec.pitch;
    this.rigGoal.dist = dist;
    this.rigGoal.target.set(0, focusY, 0);
  }

  setViewLocked(locked: boolean): void { this.viewLocked = locked; }
  setEyeTracking(on: boolean): void { this.eyeTracking = on; }
  resetView(): void { this.setView("threeQuarter"); }

  private focusY(focus: "head" | "chest" | "hips"): number {
    if (focus === "head") return this.headY - 0.06;
    if (focus === "chest") return this.chestY;
    return this.hipsY;
  }

  /* ------------------------------ load model ------------------------------ */

  private async loadModel(url: string): Promise<void> {
    let gltf: { userData: { vrm?: VRM }; scene: THREE.Object3D };
    try {
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));
      this.opts.onProgress?.("FETCHING NEURAL VESSEL", 0.08);
      const loadPromise = new Promise<typeof gltf>((resolve, reject) => {
        loader.load(
          url,
          g => resolve(g as typeof gltf),
          ev => {
            if (ev.total > 0) {
              this.opts.onProgress?.("FETCHING NEURAL VESSEL", 0.08 + 0.72 * (ev.loaded / ev.total));
            }
          },
          err => reject(err instanceof Error ? err : new Error(String(err)))
        );
      });
      this.opts.onProgress?.("PARSING CHARACTER MATRIX", 0.84);
      gltf = await raceWithDeadline(loadPromise, VRM_LOAD_TIMEOUT_MS, "VRM asset load");
    } catch (err) {
      const detail = `VRM asset failed to load: ${err instanceof Error ? err.message : String(err)}`;
      console.warn("[ZARA-avatar]", detail);
      if (!this.stopped) {
        this.opts.onStatus?.("error", detail);
      }
      return;
    }
    if (this.stopped || !this.scene) return;
    this.opts.onProgress?.("MATERIALIZING PRESENCE", 0.92);
    const vrm = gltf.userData.vrm;
    if (!vrm) {
      this.opts.onStatus?.("error", "File is not a VRM model (no VRM extension).");
      return;
    }
    this.vrm = vrm;
    try { VRMUtils.combineSkeletons(vrm.scene); } catch { /* optional optimization */ }

    if (vrm.lookAt && this.gazeTarget) vrm.lookAt.target = this.gazeTarget;

    this.scene.add(vrm.scene);
    vrm.scene.updateWorldMatrix(true, true);

    /* Natural rest pose — swap the raw T-pose for a relaxed A-stance so she
     * reads as a companion, not a rigging test. Applied to the NORMALIZED
     * rig (identity = T-pose), so it is model-independent and reversible. */
    this.applyRestPose(vrm);

    /* ---- THE AUTO-FRAMING FIX: measure the REAL model, then frame it ---- */
    const bbox = new THREE.Box3().setFromObject(vrm.scene);
    if (isFinite(bbox.min.y) && isFinite(bbox.max.y) && bbox.max.y > bbox.min.y) {
      this.modelHeight = bbox.max.y - bbox.min.y;
      this.headY = Math.min(bbox.max.y - this.modelHeight * 0.08, bbox.max.y - 0.05);
      this.chestY = bbox.min.y + this.modelHeight * 0.72;
      this.hipsY = bbox.min.y + this.modelHeight * 0.52;
      this.modelRadius = Math.max(0.35, Math.max(bbox.max.x - bbox.min.x, bbox.max.z - bbox.min.z) / 2);
    } else {
      const head = vrm.humanoid?.getNormalizedBoneNode("head");
      if (head) {
        head.getWorldPosition(new THREE.Vector3());
        const p = new THREE.Vector3();
        head.getWorldPosition(p);
        this.headY = p.y || 1.42;
      }
      this.chestY = this.headY - 0.3;
      this.hipsY = this.headY - 0.5;
      this.modelHeight = 1.55;
    }

    /* Full-body base distance (zoom clamp reference) from the real height
     * AND the current aspect — fits both axes so the character is never
     * cropped on narrow screens or absurdly small on wide ones. */
    const framing: FramingInput = {
      modelHeight: this.modelHeight,
      modelRadius: this.modelRadius,
      fovDeg: this.camera?.fov ?? 30,
      aspect: this.aspect
    };
    this.baseDist = clamp(baseDistance(framing), 0.9, 4.2);

    this.applyViewGeometry();
    this.rig = { ...this.rigGoal, target: this.rigGoal.target.clone() };

    this.blinkTimer = 0;
    this.opts.onProgress?.("PRESENCE ONLINE", 1);
    this.opts.onStatus?.("ready");
  }

  /* ------------------------------ frame loop ------------------------------ */

  private resize(canvas: HTMLCanvasElement): void {
    if (!this.renderer || !this.camera) return;
    const w = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 640);
    const h = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || 640);
    this.renderer.setSize(w, h, false);
    const nextAspect = w / h;
    const aspectChanged = Math.abs(nextAspect - this.aspect) > 0.001;
    this.aspect = nextAspect;
    this.camera.aspect = nextAspect;
    this.camera.updateProjectionMatrix();
    // Aspect-aware framing: re-derive the current view's distance whenever the
    // canvas shape changes (rotation, split-layout transitions, window resize).
    if (aspectChanged && this.vrm) {
      this.baseDist = clamp(baseDistance({
        modelHeight: this.modelHeight,
        modelRadius: this.modelRadius,
        fovDeg: this.camera.fov,
        aspect: this.aspect
      }), 0.9, 4.2);
      this.applyViewGeometry();
    }
  }

  stop(): void {
    this.stopped = true;
    this.pauseLoop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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
    this.clock.getDelta();
    const loop = () => {
      if (this.stopped) return;
      const dtMs = this.clock.getDelta() * 1000;
      this.frameAccumMs += dtMs;
      // V2: never below 30fps — idle presence must stay butter-smooth.
      const budget = Math.min(this.frameBudgetMs, 1000 / 30);
      if (this.frameAccumMs >= budget) {
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

    /* ---- theme colors (rim light + floor ring follow emotion) ---- */
    this.themeGoal.set(themeFor(emotion).primary);
    this.themeCur.lerp(this.themeGoal, 1 - Math.exp(-dt * 3.2));
    if (this.rimLight) this.rimLight.color.copy(this.themeCur).lerp(new THREE.Color(0xffffff), 0.25);
    if (this.ringMat) {
      this.ringMat.color.copy(this.themeCur);
      this.ringMat.opacity = 0.34 + 0.30 * (0.5 + 0.5 * Math.sin(t * 1.6)) + this.energy * 0.18;
    }

    /* ---- camera rig easing (spring-ish exponential) ---- */
    const k = 1 - Math.exp(-dt * 7);
    this.rig.yaw += (this.rigGoal.yaw - this.rig.yaw) * k;
    this.rig.pitch += (this.rigGoal.pitch - this.rig.pitch) * k;
    this.rig.dist += (this.rigGoal.dist - this.rig.dist) * k;
    this.rig.target.lerp(this.rigGoal.target, k);
    const { yaw, pitch, dist, target } = this.rig;
    this.camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(yaw) * Math.cos(pitch) * dist
    );
    this.camera.lookAt(target);

    /* ---- expression targets ---- */
    this.exprTargets.clear();
    const target2 = EMOTION_EXPRESSIONS[emotion];
    for (const [name, w] of Object.entries(target2 ?? {})) {
      this.exprTargets.set(name as VrmExpression, w as number);
    }
    if (this.state === "LISTENING" || this.state === "WAITING") {
      this.exprTargets.set("happy", Math.max(this.exprTargets.get("happy") ?? 0, 0.15));
    }

    /* ---- blink / forced eye close ---- */
    let blinkWeight = behavior.forcedEyeClose;
    if (behavior.blinkRate > 0 && behavior.forcedEyeClose < 0.5) {
      this.blinkTimer += dt;
      if (this.blinkAnim >= 0) {
        this.blinkAnim += dt / 0.14;
        if (this.blinkAnim >= 1) this.blinkAnim = -1;
        else blinkWeight = Math.max(blinkWeight, Math.sin(this.blinkAnim * Math.PI));
      } else if (this.blinkTimer > this.blinkNext) {
        this.blinkTimer = 0;
        this.blinkNext = Math.max(0.8, 60 / behavior.blinkRate) * (0.6 + Math.random() * 0.8);
        this.blinkAnim = 0;
      }
    }
    this.exprTargets.set("blink", Math.max(this.exprTargets.get("blink") ?? 0, blinkWeight));

    /* ---- gaze: eye-tracking (pointer) or state-driven wander ---- */
    if (this.gazeTarget) {
      let desired: THREE.Vector3;
      if (this.eyeTracking && behavior.gazeMode !== "closed") {
        // Eyes follow the pointer — map NDC to a plane in front of the head.
        desired = new THREE.Vector3(
          this.pointerNdc.x * 0.55,
          this.headY + 0.02 + this.pointerNdc.y * 0.35,
          1.15
        );
      } else {
        const off = gazeOffsetFor(behavior.gazeMode, t, this.wanderSeed);
        desired = new THREE.Vector3(off.x, this.headY + off.y, off.z);
      }
      const k = 1 - Math.exp(-dt * (2 + behavior.gazeStability * 8));
      this.gazeCurrent.lerp(desired, k);
      this.gazeTarget.position.copy(this.gazeCurrent);
    }

    /* ---- speech visemes ---- */
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

    /* ---- apply expressions + visemes ---- */
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

    /* ---- breathing + sway (root-level) ---- */
    if (this.vrm) {
      const breathPhase = t * (Math.PI * 2 * behavior.breathRate / 60);
      const bob = Math.sin(breathPhase) * 0.008 * behavior.breathDepth;
      const sway = behavior.bodySway > 0 ? Math.sin(t * 0.42) * 0.015 * behavior.bodySway : 0;
      this.vrm.scene.position.y = bob;
      this.vrm.scene.rotation.z = sway;
    }

    /* ---- light easing ---- */
    if (this.keyLight && this.ambient && this.fillLight) {
      this.lightLevel += (behavior.lightIntensity - this.lightLevel) * (1 - Math.exp(-dt * 4));
      this.keyLight.intensity = 1.05 * this.lightLevel;
      this.fillLight.intensity = 0.38 * this.lightLevel;
      this.ambient.intensity = 0.52 * this.lightLevel;
    }

    this.vrm?.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
