import { describe, expect, it } from "vitest";
import { defineConfig } from "../../src/index.ts";

describe("defineConfig", () => {
  it("returns the config as is", () => {
    const config = { hooks: { "pre-commit": "npm test" } };
    expect(defineConfig(config)).toBe(config);
  });

  // Checked by `tsc --noEmit` (typecheck), not at run time.
  it("accepts every hook value form", () => {
    defineConfig({});
    defineConfig({
      hooks: {
        "pre-commit": "npm test",
        "commit-msg": ["npm run lint", "commitlint --edit {1}"],
        "pre-push": { tasks: { test: { run: "npm test" } } },
      },
    });
    defineConfig({ hooks: { "pre-commit": ["a", "b"] as const } });
  });

  it("rejects unknown hooks and options", () => {
    // @ts-expect-error unknown hook name
    defineConfig({ hooks: { "pre-comit": "npm test" } });
    // @ts-expect-error unknown top-level option
    defineConfig({ hook: {} });
    // @ts-expect-error task without `run`
    defineConfig({ hooks: { "pre-commit": { tasks: { test: {} } } } });
    // @ts-expect-error `run` must be a string
    defineConfig({ hooks: { "pre-commit": { tasks: { test: { run: 1 } } } } });
  });
});
