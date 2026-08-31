/**
 * ZARA V2.1 — Aspect-aware camera framing math (PURE, unit-testable).
 *
 * The V2.0 auto-framing fix measured the model's real bounding box but only
 * fitted the VERTICAL field of view. On narrow (phone portrait) and ultra-wide
 * (landscape tablet) screens that still mis-framed:
 *   - narrow screens: horizontal half-FOV shrinks → body cropped at the sides
 *   - the default preset framed the whole body on phones → character reads tiny
 *
 * V2.1 framing fits BOTH axes and derives per-preset target distances from a
 * "coverage" spec (what fraction of the body each preset should show), so the
 * character is never absurdly zoomed, never tiny, never unintentionally
 * cropped — on phones, tablets, large tablets and desktop windows, portrait
 * or landscape.
 */

export interface FramingInput {
  /** Real model height in metres (from the bounding box). */
  modelHeight: number;
  /** Real model half-extent in metres (max horizontal half-size). */
  modelRadius: number;
  /** Camera vertical FOV in degrees. */
  fovDeg: number;
  /** Canvas aspect ratio (width / height). */
  aspect: number;
}

export interface ViewSpec {
  /** Yaw angle in radians around the character. */
  yaw: number;
  /** Pitch in radians above the horizon. */
  pitch: number;
  /** Vertical fraction of the model height this view should frame (0..1.4). */
  coverage: number;
  /** Horizontal width (in model radii) this view must keep visible. */
  widthInRadii: number;
  /** Which body height to aim the camera at. */
  focus: "head" | "chest" | "hips";
  /** Extra breathing-room multiplier. */
  padding: number;
}

/**
 * Preset view specifications. `coverage` is the design language:
 *   portrait     → head + shoulders close-up (the "talk to me" shot)
 *   threeQuarter → waist-up companion framing (MYRAA-class default on phones)
 *   front/side/back → full-body, straight-on
 *   full         → whole body + stage floor + headroom
 */
export const VIEW_SPECS: Record<string, ViewSpec> = {
  portrait:     { yaw: 0,              pitch: 0.02, coverage: 0.46, widthInRadii: 0.85, focus: "head",  padding: 1.10 },
  front:        { yaw: 0,              pitch: 0.10, coverage: 1.00, widthInRadii: 1.30, focus: "hips",  padding: 1.16 },
  threeQuarter: { yaw: -0.55,          pitch: 0.09, coverage: 0.78, widthInRadii: 1.10, focus: "chest", padding: 1.12 },
  side:         { yaw: -Math.PI / 2,   pitch: 0.07, coverage: 1.00, widthInRadii: 0.75, focus: "hips",  padding: 1.16 },
  back:         { yaw: Math.PI,        pitch: 0.08, coverage: 1.00, widthInRadii: 1.30, focus: "hips",  padding: 1.16 },
  full:         { yaw: -0.35,          pitch: 0.12, coverage: 1.30, widthInRadii: 1.45, focus: "hips",  padding: 1.08 }
};

/**
 * Distance that fits `frameHeight` (metres) in the vertical FOV and
 * `frameWidth` (metres) in the horizontal FOV of a camera with the given
 * vertical FOV and aspect. Returns the larger (both axes always fit).
 */
export function fitDistance(
  frameHeight: number,
  frameWidth: number,
  fovDeg: number,
  aspect: number
): number {
  const vHalf = (fovDeg * Math.PI) / 180 / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 0.15));
  const vDist = frameHeight / (2 * Math.tan(vHalf));
  const wDist = hHalf > 0 ? frameWidth / (2 * Math.tan(hHalf)) : vDist;
  return Math.max(vDist, wDist);
}

/** Full-body base distance (also the zoom clamp reference). */
export function baseDistance(input: FramingInput): number {
  return viewDistance(input, VIEW_SPECS.full).dist;
}

/** Target distance + focus height for a view spec under the current aspect. */
export function viewDistance(input: FramingInput, spec: ViewSpec): { dist: number; focusY: number } {
  const { modelHeight, modelRadius } = input;
  const frameHeight = modelHeight * spec.coverage * spec.padding;
  const frameWidth = modelRadius * 2 * spec.widthInRadii * spec.padding;
  const dist = Math.max(fitDistance(frameHeight, frameWidth, input.fovDeg, input.aspect), spec.coverage * 0.62);
  // Focus heights derived from the real measurements (hips ~52%, chest ~72%).
  const hipsY = modelHeight * 0.52;
  const chestY = modelHeight * 0.72;
  let focusY: number;
  if (spec.focus === "head") focusY = modelHeight * 0.92;
  else if (spec.focus === "chest") focusY = chestY;
  else focusY = hipsY;
  // Partial-coverage views anchor the frame at the TOP of the head (with a
  // little headroom) so the face is never cropped — the frame then extends
  // DOWN to wherever the coverage ends (waist, knees…). Full-coverage views
  // simply centre on the body.
  if (spec.coverage < 0.95) {
    const headroom = modelHeight * 0.05;
    const bandTop = modelHeight + headroom;
    focusY = bandTop - modelHeight * spec.coverage / 2;
  }
  return { dist, focusY };
}

/**
 * Responsive DEFAULT view: narrow/tall screens (phones in portrait) open on
 * the waist-up three-quarter companion shot so the character immediately
 * reads large and alive; wider screens (tablets/desktop) open on the classic
 * three-quarter too — full-body framing stays one tap away.
 */
export function defaultViewFor(aspect: number): "portrait" | "front" | "threeQuarter" | "side" | "back" | "full" {
  return "threeQuarter";
}

/** Clamp helper shared with the renderer's zoom gesture. */
export function clampZoom(dist: number, baseDist: number): number {
  return Math.max(baseDist * 0.32, Math.min(dist, baseDist * 2.4));
}
