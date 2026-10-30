import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Tests spawn real git processes, which is slow on Windows runners.
    testTimeout: 20_000,
  },
});
