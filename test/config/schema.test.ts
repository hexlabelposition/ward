import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../src/config/schema.ts";

describe("normalizeConfig", () => {
  it("has no hooks without a hooks section", () => {
    expect(normalizeConfig({})).toEqual({ hooks: {} });
  });

  it("turns a string into one task named after the command", () => {
    expect(normalizeConfig({ hooks: { "pre-commit": "npm test" } })).toEqual({
      hooks: {
        "pre-commit": { tasks: [{ name: "npm test", run: "npm test" }] },
      },
    });
  });

  it("turns an array into tasks in order", () => {
    expect(
      normalizeConfig({ hooks: { "pre-push": ["npm run build", "npm test"] } }),
    ).toEqual({
      hooks: {
        "pre-push": {
          tasks: [
            { name: "npm run build", run: "npm run build" },
            { name: "npm test", run: "npm test" },
          ],
        },
      },
    });
  });

  it("keeps named tasks in config order", () => {
    expect(
      normalizeConfig({
        hooks: {
          "pre-commit": {
            tasks: {
              lint: { run: "eslint ." },
              format: { run: "prettier -c ." },
            },
          },
        },
      }),
    ).toEqual({
      hooks: {
        "pre-commit": {
          tasks: [
            { name: "lint", run: "eslint ." },
            { name: "format", run: "prettier -c ." },
          ],
        },
      },
    });
  });

  it("keeps a hook with no tasks", () => {
    expect(
      normalizeConfig({
        hooks: { "pre-commit": [], "pre-push": { tasks: {} } },
      }),
    ).toEqual({
      hooks: { "pre-commit": { tasks: [] }, "pre-push": { tasks: [] } },
    });
  });

  it("does not share arrays with the input", () => {
    const commands = ["a", "b"];
    const { hooks } = normalizeConfig({ hooks: { "pre-commit": commands } });
    commands.push("c");
    expect(hooks["pre-commit"]?.tasks).toHaveLength(2);
  });
});
