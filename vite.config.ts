import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    port: 5292,
    strictPort: true,
  },
  preview: {
    port: 5292,
    strictPort: true,
  },
});
