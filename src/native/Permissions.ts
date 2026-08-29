/**
 * ZARA V1.0 — Permission mapping (§25, §45).
 *
 * Maps logical ZARA permissions to runtime permissions via the Capacitor
 * Permissions API where available; on web, permissions are reported granted
 * only if genuinely obtainable (never faked).
 */
export type ZaraPermission =
  | "notifications"
  | "camera"
  | "contacts"
  | "calendar"
  | "location"
  | "microphone";

export async function request(perm: ZaraPermission): Promise<boolean> {
  try {
    const core = await import("@capacitor/core");
    const perms = (core as unknown as {
      Capacitor: {
        isNativePlatform(): boolean;
        Plugins: Record<string, { checkPermissions?: () => Promise<Record<string, string>>; requestPermissions?: () => Promise<Record<string, string>> }>;
      };
    }).Capacitor;

    if (perms?.isNativePlatform?.()) {
      const pluginName = permissionPlugin(perm);
      const plugin = pluginName ? perms.Plugins?.[pluginName] : null;
      if (plugin?.checkPermissions && plugin?.requestPermissions) {
        let status = await plugin.checkPermissions();
        const key = permissionKey(perm);
        if (key && status[key] !== "granted") {
          status = await plugin.requestPermissions();
        }
        if (key) return status[key] === "granted";
      }
      return true; // intent-based — failure surfaces honestly at execution
    }
  } catch { /* fall through to web handling */ }

  // Web preview: mic permission is real; others honestly unavailable.
  if (perm === "microphone") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch { return false; }
  }
  return false;
}

function permissionPlugin(perm: ZaraPermission): string | null {
  switch (perm) {
    case "camera": return "Camera";
    case "contacts": return "Contacts";
    case "location": return "Geolocation";
    case "microphone": return "ZaraVoice"; // handled by MainActivity getUserMedia grant
    default: return null;
  }
}

function permissionKey(perm: ZaraPermission): string | null {
  switch (perm) {
    case "camera": return "camera";
    case "contacts": return "contacts";
    case "location": return "location";
    case "microphone": return "audioRecording";
    default: return null;
  }
}
