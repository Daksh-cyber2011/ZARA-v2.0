/**
 * ZARA V1.1 — Perception capability model (Directive §4).
 *
 * ZARA must know EXACTLY which perception capabilities are currently
 * available, and never let the model (or the UI) assume an unavailable
 * capability. Every capability is in one of four states:
 *
 *   "unavailable"       — the platform cannot provide it at all
 *   "off"               — the user has not enabled it (privacy default)
 *   "permission_required" — the user wants it, but the OS permission is missing
 *   "active"            — really running, real events flowing
 *
 * Transitions are emitted on the bus as CAPABILITY_CHANGED so diagnostics and
 * the UI always reflect the truth. This is the anti-fabrication backbone of
 * §31: capability state is derived from REAL system checks, never assumed.
 */

export type CapabilityState =
  | "unavailable"
  | "off"
  | "permission_required"
  | "active";

export const CAPABILITY_STATES: readonly CapabilityState[] = [
  "unavailable", "off", "permission_required", "active"
];

/** A single perception capability with an honest, explainable state. */
export interface PerceptionCapability {
  /** Stable machine id, e.g. "screen_awareness". */
  id: string;
  /** Human label for settings/diagnostics. */
  label: string;
  state: CapabilityState;
  /** One-line honest explanation (shown verbatim in diagnostics). */
  detail: string;
}

/** Legal transitions — guards against impossible state flips. */
const LEGAL: Readonly<Record<CapabilityState, readonly CapabilityState[]>> = {
  unavailable: ["unavailable"],
  off: ["off", "permission_required", "active"],
  permission_required: ["permission_required", "off", "active"],
  active: ["active", "off", "permission_required"]
};

export function canCapabilityTransition(from: CapabilityState, to: CapabilityState): boolean {
  if (from === to) return false; // no-op transitions are not "changes"
  return LEGAL[from].includes(to);
}

/** True only when real events from this capability may be processed. */
export function isCapabilityActive(c: PerceptionCapability): boolean {
  return c.state === "active";
}

/**
 * Resolves the effective screen-awareness capability from three facts:
 * platform support, the user's settings toggle, and the OS permission state.
 * All three inputs come from real checks (plugin probe / Settings / Android
 * accessibility-enabled check) — never defaults pretending to be facts.
 */
export function resolveScreenCapability(input: {
  platformSupported: boolean;
  userEnabled: boolean;
  permissionGranted: boolean;
}): CapabilityState {
  if (!input.platformSupported) return "unavailable";
  if (!input.userEnabled) return "off";
  if (!input.permissionGranted) return "permission_required";
  return "active";
}

/** Same resolution for app/lifecycle awareness (no special OS permission). */
export function resolveAppCapability(input: {
  platformSupported: boolean;
  userEnabled: boolean;
}): CapabilityState {
  if (!input.userEnabled) return "off";
  return input.platformSupported ? "active" : "unavailable";
}
