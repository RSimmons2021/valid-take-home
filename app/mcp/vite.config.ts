import path from "node:path";
import { defineConfig } from "vite";

/** Bundles the MCP server (and the app's model code it reuses) into one Node file. Dependencies stay external. */
export default defineConfig({
  root: path.resolve(__dirname, ".."),
  publicDir: false,
  build: {
    ssr: path.resolve(__dirname, "main.ts"),
    outDir: "dist-mcp",
    emptyOutDir: true,
    target: "node22",
    rollupOptions: { output: { entryFileNames: "catchment-mcp.js", format: "es" } },
  },
});
