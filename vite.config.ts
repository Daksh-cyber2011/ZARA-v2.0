import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// MYRAA frontend build. The Node backend (server/server.ts) serves both the
// Vite dev middleware (npm run dev) and the built dist/ folder in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          character: ["mmd-parser"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/live": { target: "ws://localhost:3000", ws: true },
      "/assets": "http://localhost:3000",
    },
  },
});
