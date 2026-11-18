import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  base: "./",
  // In development the AI server runs separately (npm run dev:server); proxy its routes.
  server: { proxy: { "/api": "http://localhost:8787" } },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Map engines change rarely; keep them out of the app chunk so a deploy re-downloads only our code.
        manualChunks: (id) =>
          id.includes("node_modules/maplibre-gl")
            ? "maplibre"
            : /node_modules\/(@deck\.gl|@luma\.gl|@math\.gl|@loaders\.gl|h3-js)/.test(id)
              ? "deck"
              : undefined,
      },
    },
  },
  test: { environment: "node", exclude: ["e2e/**", "node_modules/**", "dist/**", "dist-mcp/**"] },
});
