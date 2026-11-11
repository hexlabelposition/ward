import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/errors.ts";
import { normalizeConfig, validateConfig } from "../../src/config/schema.ts";

/** The problems listed in the error, without the "is invalid" header. */
function issues(raw: unknown): string[] {
  try {
    validateConfig(raw, "ward.yml");
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    const [header, ...lines] = error.message.split("\n");
    expect(header).toBe("ward.yml is invalid:");
    return lines.map((line) => line.trim());
  }
  return [];
}

describe("validateConfig", () => {
  it("returns a valid config as is", () => {
    const config = {
      hooks: {
        "pre-commit": "npm test",
        "commit-msg": ["npm run lint", "commitlint --edit {1}"],
        "pre-push": { tasks: { test: { run: "npm test" } } },
      },
    };
    expect(validateConfig(config, "ward.yml")).toBe(config);
  });

  it.each([{}, { hooks: {} }, { hooks: { "pre-commit": [] } }])(
    "accepts %j",
    (config) => {
      expect(issues(config)).toEqual([]);
    },
  );

  it.each([
    [null, "an empty value"],
    [[], "a list"],
    ["npm test", "a string"],
    [() => ({}), "a function"],
  ])("rejects a config that is not an object: %j", (raw, got) => {
    expect(issues(raw)).toEqual([
      `expected an object with \`hooks\`, got ${got}`,
    ]);
  });

  it("suggests a close hook name", () => {
    expect(issues({ hooks: { "pre-comit": "npm test" } })).toEqual([
      'hooks.pre-comit: unknown hook. Did you mean "pre-commit"?',
    ]);
  });

  it("does not suggest a hook that is not close", () => {
    expect(issues({ hooks: { deploy: "npm test" } })).toEqual([
      "hooks.deploy: unknown hook",
    ]);
  });

  it("points hooks at the top level to `hooks:`", () => {
    expect(issues({ "pre-commit": "npm test" })).toEqual([
      "pre-commit: hooks go under `hooks:`, e.g. `hooks: { pre-commit: … }`",
    ]);
  });

  it("suggests a close option name", () => {
    expect(issues({ hook: {} })).toEqual([
      'hook: unknown option. Did you mean "hooks"?',
    ]);
  });

  it("names options from later versions as not supported yet", () => {
    expect(
      issues({
        extends: ["ward:ts"],
        hooks: {
          "pre-commit": {
            parallel: true,
            tasks: { lint: { run: "eslint", glob: "*.ts" } },
          },
        },
      }),
    ).toEqual([
      "extends: not supported yet",
      "hooks.pre-commit.parallel: not supported yet",
      "hooks.pre-commit.tasks.lint.glob: not supported yet",
    ]);
  });

  it("rejects function tasks for now", () => {
    expect(
      issues({
        hooks: { "pre-commit": { tasks: { check: { run: () => 0 } } } },
      }),
    ).toEqual([
      "hooks.pre-commit.tasks.check.run: function tasks are not supported yet",
    ]);
  });

  it("checks commands", () => {
    expect(
      issues({
        hooks: {
          "pre-commit": " ",
          "pre-push": ["npm test", 1, null],
          "commit-msg": { tasks: { lint: { run: "" } } },
        },
      }),
    ).toEqual([
      "hooks.pre-commit: command is empty",
      "hooks.pre-push[1]: expected a command string, got a number",
      "hooks.pre-push[2]: expected a command string, got an empty value",
      "hooks.commit-msg.tasks.lint.run: command is empty",
    ]);
  });

  it("checks hook and task shapes", () => {
    expect(
      issues({
        hooks: {
          "pre-commit": true,
          "pre-push": {},
          "commit-msg": { tasks: ["npm test"] },
          "post-merge": { tasks: { install: "npm i", "": { run: "x" } } },
          "post-checkout": { tasks: { "my task": {} } },
        },
      }),
    ).toEqual([
      "hooks.pre-commit: expected a command, a list of commands or `{ tasks }`, got a boolean",
      "hooks.pre-push: missing `tasks`",
      "hooks.commit-msg.tasks: expected an object of named tasks, got a list",
      'hooks.post-merge.tasks.install: expected `{ run: "…" }`, got a string',
      'hooks.post-merge.tasks[""]: task name is empty',
      'hooks.post-checkout.tasks["my task"]: missing `run`',
    ]);
  });

  it("rejects an empty hooks section", () => {
    // `hooks:` with nothing under it in YAML.
    expect(issues({ hooks: null })).toEqual([
      "hooks: expected an object of hooks, got an empty value",
    ]);
  });
});

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
