import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    typecheck: { tsconfig: "./tsconfig.test.json" },
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    setupFiles: ["tests/setup.ts"],
    // Integration tests share one PostgreSQL schema, so they must not run
    // concurrently with each other. Unit tests are pure and unaffected.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/services/**", "src/repositories/**"],
      exclude: ["src/lib/config/env.ts"],
    },
  },
});
