import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // §46: vendor code-splitting — three/VRM and @google/genai are the two
    // heavyweights; splitting them lets the WebView cache them independently
    // across app updates and keeps the first paint lighter.
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@pixiv/three-vrm"],
          genai: ["@google/genai"]
        }
      }
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
