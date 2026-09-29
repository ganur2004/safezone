import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // The project keeps one .env at the repo root; Vite would otherwise look in web/.
  envDir: "..",
  // MapLibre spawns its worker with `new Worker(new URL(...))`; Vite's dependency
  // pre-bundling rewrites that URL and the worker then fails to load.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  worker: { format: "es" },
  // MapLibre alone is about a megabyte; the default 500 kB warning is noise here.
  build: { chunkSizeWarningLimit: 1600 },
});
