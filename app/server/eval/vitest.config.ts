import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { silent: false, include: ["server/eval/*.eval.ts"] },
});
