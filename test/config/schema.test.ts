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

  it("accepts camelCase hook names", () => {
    expect(
      issues({
        hooks: {
          preCommit: "npm test",
          commitMsg: "commitlint --edit {1}",
          prePush: { tasks: { test: { run: "npm test {push_files}" } } },
        },
      }),
    ).toEqual([]);
  });

  it("suggests a close hook name in the spelling of the key", () => {
    expect(issues({ hooks: { preComit: "npm test" } })).toEqual([
      'hooks.preComit: unknown hook. Did you mean "preCommit"?',
    ]);
  });

  it("rejects the same hook in both spellings", () => {
    expect(
      issues({
        hooks: { "pre-commit": "npm test", preCommit: "npm run lint" },
      }),
    ).toEqual([
      'hooks.preCommit: the same hook as "pre-commit": keep one of them',
    ]);
  });

  it("checks a camelCase hook as the hook it names", () => {
    expect(issues({ hooks: { preCommit: "npm test {push_files}" } })).toEqual(
      issues({ hooks: { "pre-commit": "npm test {push_files}" } }).map(
        (issue) => issue.replace("hooks.pre-commit", "hooks.preCommit"),
      ),
    );
    expect(
      issues({ hooks: { preCommit: "npm test {push_files}" } }),
    ).not.toEqual([]);
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

  it("points camelCase hooks at the top level to `hooks:`", () => {
    expect(issues({ preCommit: "npm test" })).toEqual([
      "preCommit: hooks go under `hooks:`, e.g. `hooks: { preCommit: … }`",
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
            tasks: { lint: { run: "eslint", cache: true } },
          },
        },
      }),
    ).toEqual([
      "extends: not supported yet",
      "hooks.pre-commit.tasks.lint.cache: not supported yet",
    ]);
  });

  it("accepts `glob` and `exclude` as a pattern or a list", () => {
    expect(
      issues({
        hooks: {
          "pre-commit": {
            tasks: {
              lint: { run: "eslint", glob: "*.{ts,tsx}", exclude: "dist/**" },
              format: { run: "prettier -w", glob: ["*.md", "docs/**/*.yml"] },
            },
          },
        },
      }),
    ).toEqual([]);
  });

  it("allows `{push_files}` in `pre-push` only", () => {
    expect(
      issues({
        hooks: {
          "pre-push": "eslint {push_files}",
          "pre-commit": ["eslint {staged_files} {all_files}", "x {push_files}"],
          "post-merge": { tasks: { lint: { run: "eslint {push_files}" } } },
        },
      }),
    ).toEqual([
      "hooks.pre-commit[1]: `{push_files}` is only available in `pre-push`",
      "hooks.post-merge.tasks.lint.run: `{push_files}` is only available in `pre-push`",
    ]);
  });

  it("needs a file placeholder for `glob` outside `pre-commit` and `pre-push`", () => {
    expect(
      issues({
        hooks: {
          "pre-commit": { tasks: { tsc: { run: "tsc", glob: "*.ts" } } },
          "pre-push": { tasks: { test: { run: "vitest", exclude: "*.md" } } },
          "post-merge": {
            tasks: {
              install: { run: "npm i", glob: "package-lock.json" },
              lint: { run: "eslint {all_files}", glob: "*.ts" },
            },
          },
        },
      }),
    ).toEqual([
      "hooks.post-merge.tasks.install: `glob` and `exclude` need `{staged_files}`, `{push_files}` or `{all_files}` in `run` outside `pre-commit` and `pre-push`",
    ]);
  });

  it("accepts `symlinks` and `stageFixed` as booleans only", () => {
    expect(
      issues({
        hooks: {
          "pre-commit": {
            tasks: {
              a: { run: "x {staged_files}", symlinks: true, stageFixed: false },
              b: { run: "x {staged_files}", symlinks: "yes" },
              c: { run: "x {staged_files}", stageFixed: 0 },
            },
          },
        },
      }),
    ).toEqual([
      "hooks.pre-commit.tasks.b.symlinks: expected true or false, got a string",
      "hooks.pre-commit.tasks.c.stageFixed: expected true or false, got a number",
    ]);
  });

  it("reports invalid patterns", () => {
    expect(
      issues({
        hooks: {
          "pre-commit": {
            tasks: {
              a: { run: "x", glob: "[abc" },
              b: { run: "x", glob: ["*.ts", "./src/*.ts", 1] },
              c: { run: "x", glob: [], exclude: "" },
              d: { run: "x", exclude: { "*.ts": true } },
            },
          },
        },
      }),
    ).toEqual([
      expect.stringMatching(
        /^hooks\.pre-commit\.tasks\.a\.glob: invalid pattern "\[abc": .*\]/,
      ),
      'hooks.pre-commit.tasks.b.glob[1]: invalid pattern "./src/*.ts": patterns are relative to the repo root: write "src/*.ts"',
      "hooks.pre-commit.tasks.b.glob[2]: expected a pattern string, got a number",
      "hooks.pre-commit.tasks.c.glob: list of patterns is empty",
      'hooks.pre-commit.tasks.c.exclude: invalid pattern "": pattern is empty',
      "hooks.pre-commit.tasks.d.exclude: expected a pattern or a list of patterns, got an object",
    ]);
  });

  it("accepts `parallel`, `backup` and `revert` as booleans only", () => {
    expect(
      issues({
        hooks: {
          "pre-commit": {
            parallel: true,
            backup: false,
            revert: false,
            tasks: {},
          },
          "pre-push": { parallel: "yes", backup: 0, revert: [], tasks: {} },
        },
      }),
    ).toEqual([
      "hooks.pre-push.parallel: expected true or false, got a string",
      "hooks.pre-push.backup: expected true or false, got a number",
      "hooks.pre-push.revert: expected true or false, got a list",
    ]);
  });

  it("accepts function tasks", () => {
    expect(
      issues({
        hooks: {
          "pre-commit": {
            tasks: { check: { run: () => 0, glob: "*.ts", stageFixed: false } },
          },
          "commit-msg": { tasks: { check: { run: async () => {} } } },
        },
      }),
    ).toEqual([]);
  });

  it("rejects `glob` on a function task in a hook without files", () => {
    expect(
      issues({
        hooks: {
          "commit-msg": { tasks: { check: { run: () => 0, exclude: "*.md" } } },
        },
      }),
    ).toEqual([
      "hooks.commit-msg.tasks.check: `glob` and `exclude` on a function task only work in `pre-commit` and `pre-push`",
    ]);
  });

  it("asks for a named task for a function in the short forms", () => {
    expect(
      issues({
        hooks: { "pre-commit": () => 0, "pre-push": ["npm test", () => 0] },
      }),
    ).toEqual([
      "hooks.pre-commit: expected a command, a list of commands or `{ tasks }`, got a function",
      "hooks.pre-push[1]: a function needs a named task: `{ tasks: { name: { run: fn } } }`",
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

  it("names camelCase hooks as in git", () => {
    expect(normalizeConfig({ hooks: { preCommit: "npm test" } })).toEqual({
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

  it("turns `glob` and `exclude` into lists, keeps `symlinks: true` and `stageFixed: false`", () => {
    expect(
      normalizeConfig({
        hooks: {
          "pre-commit": {
            tasks: {
              lint: { run: "eslint", glob: "*.ts", exclude: ["a/**", "b/**"] },
              test: { run: "vitest", symlinks: false },
              links: { run: "ls", symlinks: true },
              fmt: { run: "prettier", stageFixed: true },
              check: { run: "prettier --check", stageFixed: false },
            },
          },
        },
      }),
    ).toEqual({
      hooks: {
        "pre-commit": {
          tasks: [
            {
              name: "lint",
              run: "eslint",
              glob: ["*.ts"],
              exclude: ["a/**", "b/**"],
            },
            { name: "test", run: "vitest" },
            { name: "links", run: "ls", symlinks: true },
            { name: "fmt", run: "prettier" },
            { name: "check", run: "prettier --check", stageFixed: false },
          ],
        },
      },
    });
  });

  it("keeps `parallel: true` only", () => {
    expect(
      normalizeConfig({
        hooks: {
          "pre-commit": { parallel: true, tasks: { a: { run: "a" } } },
          "pre-push": { parallel: false, tasks: {} },
        },
      }),
    ).toEqual({
      hooks: {
        "pre-commit": { tasks: [{ name: "a", run: "a" }], parallel: true },
        "pre-push": { tasks: [] },
      },
    });
  });

  it("keeps `backup: false` and `revert: false` only", () => {
    expect(
      normalizeConfig({
        hooks: {
          "pre-commit": {
            backup: false,
            revert: false,
            tasks: { a: { run: "a" } },
          },
          "pre-push": { backup: true, revert: true, tasks: {} },
        },
      }),
    ).toEqual({
      hooks: {
        "pre-commit": {
          tasks: [{ name: "a", run: "a" }],
          backup: false,
          revert: false,
        },
        "pre-push": { tasks: [] },
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
