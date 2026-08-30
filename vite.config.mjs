import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromiumCapturePlugin } from "./chromiumCapture.mjs";
import { videoExportPlugin } from "./videoExportPlugin.mjs";

export default defineConfig({
  plugins: [react(), tailwindcss(), chromiumCapturePlugin(), videoExportPlugin()],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
    open: false,
  },
  build: {
    target: "es2021",
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
});
