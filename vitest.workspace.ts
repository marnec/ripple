import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "backend",
      include: ["tests/convex/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    extends: "./vite.config.ts",
    test: {
      name: "frontend",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  },
]);
