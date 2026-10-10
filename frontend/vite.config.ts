import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const backend = process.env.ATLAS_BACKEND_URL || "http://127.0.0.1:8000";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: [".e2b.app"],
    proxy: {
      "/api": backend,
      "/docs": backend,
    },
  },
  build: { chunkSizeWarningLimit: 2200 },
});
