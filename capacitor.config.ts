import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zara.companion",
  appName: "ZARA",
  webDir: "dist",
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: "#02060d"
  },
  server: {
    androidScheme: "https"
  }
};

export default config;
