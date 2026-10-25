import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Copy only runtime media. Source map imports and removed legacy PNGs never
// enter the production artifact.
const copyTownImages = () => ({
  name: "copy-town-images",
  closeBundle() {
    const destination = resolve("dist/images");
    mkdirSync(destination, { recursive: true });
    for (const directory of ["optimized"]) {
      const source = resolve("images", directory);
      if (existsSync(source)) cpSync(source, resolve(destination, directory), { recursive: true });
    }
  }
});

const packageVersion = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version as string;

export default defineConfig({
  base: "/",
  define: { __APP_VERSION__: JSON.stringify(packageVersion) },
  plugins: [react(), copyTownImages()],
  // OpenSeadragon is only reached through the lazy Atlas route. Pre-bundle it
  // at startup so the first local visit cannot hit Vite's 504 re-optimize gap.
  optimizeDeps: { include: ["openseadragon"] },
  build: {
    rollupOptions: {
      output: {
        // Keep stable third-party runtimes outside the frequently changing
        // application bundle. Route-level chunks remain lazy.
        manualChunks(id) {
          if (id.includes("node_modules/@supabase")) return "supabase";
          if (id.includes("node_modules/motion")) return "motion";
        }
      }
    }
  },
  server: { host: "127.0.0.1", port: 5173, strictPort: true,
    proxy: { "/api/site/public/": "http://127.0.0.1:8787", "/api/site/media/": "http://127.0.0.1:8787" } },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true }
});
