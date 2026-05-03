import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    name: "backend",
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
