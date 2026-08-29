/**
 * ZARA V1.1 — Screen-awareness native bridge (Directive §4-6).
 *
 * Typed handle to the ZaraPerception Capacitor plugin (Android). Falls back
 * to honest "unsupported" on web/tests — the provider layer then reports the
 * capability as unavailable instead of pretending (§31).
 */
import { registerPlugin, PluginListenerHandle } from "@capacitor/core";

export interface ScreenObservationNative {
  packageName: string;
  appLabel: string;
  className: string;
  text: string;
  at: number;
}

interface ZaraPerceptionPlugin {
  getCapabilityState(): Promise<{
    supported: boolean;
    permissionGranted: boolean;
    connected: boolean;
  }>;
  openAccessibilitySettings(): Promise<{ ok: boolean; summary?: string }>;
  setForwarding(options: { enabled: boolean }): Promise<{ ok: boolean }>;
  addListener(
    eventName: "screenObservation",
    listenerFunc: (data: ScreenObservationNative) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "serviceState",
    listenerFunc: (data: { connected: boolean }) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const ZaraPerception = registerPlugin<ZaraPerceptionPlugin>("ZaraPerception");

export function isPerceptionPluginAvailable(): boolean {
  const g = globalThis as {
    Capacitor?: { isNativePlatform?: () => boolean; isPluginAvailable?: (n: string) => boolean };
  };
  return !!(g.Capacitor?.isNativePlatform?.() && g.Capacitor?.isPluginAvailable?.("ZaraPerception"));
}

/** §4 real capability probe (never assumed). */
export async function probeScreenCapability(): Promise<{
  platformSupported: boolean;
  permissionGranted: boolean;
}> {
  if (!isPerceptionPluginAvailable()) {
    return { platformSupported: false, permissionGranted: false };
  }
  try {
    const s = await ZaraPerception.getCapabilityState();
    return { platformSupported: !!s.supported, permissionGranted: !!s.permissionGranted };
  } catch {
    return { platformSupported: false, permissionGranted: false };
  }
}

/** §24 consent flow: open Android's accessibility settings pane. */
export async function openAccessibilitySettings(): Promise<boolean> {
  if (!isPerceptionPluginAvailable()) return false;
  try {
    const r = await ZaraPerception.openAccessibilitySettings();
    return !!r.ok;
  } catch {
    return false;
  }
}

/** Enable/disable native → JS event forwarding (the second privacy gate). */
export async function setScreenForwarding(enabled: boolean): Promise<void> {
  if (!isPerceptionPluginAvailable()) return;
  try {
    await ZaraPerception.setForwarding({ enabled });
  } catch { /* best effort — provider state stays honest either way */ }
}

/** Subscribe to structured screen observations from the accessibility service. */
export async function onScreenObservation(
  cb: (obs: ScreenObservationNative) => void
): Promise<(() => void) | null> {
  if (!isPerceptionPluginAvailable()) return null;
  try {
    const handle = await ZaraPerception.addListener("screenObservation", cb);
    return () => { void handle.remove(); };
  } catch {
    return null;
  }
}

/** Subscribe to accessibility-service connect/disconnect state. */
export async function onServiceState(
  cb: (connected: boolean) => void
): Promise<(() => void) | null> {
  if (!isPerceptionPluginAvailable()) return null;
  try {
    const handle = await ZaraPerception.addListener("serviceState", d => cb(!!d.connected));
    return () => { void handle.remove(); };
  } catch {
    return null;
  }
}
