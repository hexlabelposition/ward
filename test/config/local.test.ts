import { describe, expect, it } from "vitest";
import type { Config, LocalConfig } from "../../src/config/define.ts";
import { ConfigError } from "../../src/config/errors.ts";
import { mergeLocalConfig } from "../../src/config/local.ts";

const merge = (main: Config, local: LocalConfig) =>
  mergeLocalConfig(main, local, "ward.local.yml");

const main: Config = {
  hooks: {
    "pre-commit": {
      parallel: true,
      tasks: {
        eslint: { run: "eslint {staged_files}", glob: "*.ts" },
        prettier: { run: "prettier --write {staged_files}" },
      },
    },
    "pre-push": ["npm run typecheck", "npm test"],
  },
};

describe("mergeLocalConfig", () => {
  it("keeps the main config without local hooks", () => {
    expect(merge(main, {})).toEqual(main);
  });

  it("adds a hook", () => {
    expect(merge(main, { hooks: { "commit-msg": "commitlint" } })).toEqual({
      hooks: { ...main.hooks, "commit-msg": "commitlint" },
    });
  });

  it("removes a hook with null", () => {
    expect(merge(main, { hooks: { "pre-push": null } })).toEqual({
      hooks: { "pre-commit": main.hooks?.["pre-commit"] },
    });
  });

  it("replaces a hook with a command or a list", () => {
    expect(
      merge(main, { hooks: { "pre-commit": "npm test", "pre-push": [] } }),
    ).toEqual({ hooks: { "pre-commit": "npm test", "pre-push": [] } });
  });

  it("merges tasks by name and options key by key", () => {
    expect(
      merge(main, {
        hooks: {
          "pre-commit": {
            parallel: false,
            backup: false,
            tasks: {
              test: { run: "vitest related {staged_files}" },
              eslint: { glob: ["*.ts", "*.tsx"] },
              prettier: null,
            },
          },
        },
      }),
    ).toEqual({
      hooks: {
        "pre-commit": {
          parallel: false,
          backup: false,
          tasks: {
            eslint: { run: "eslint {staged_files}", glob: ["*.ts", "*.tsx"] },
            test: { run: "vitest related {staged_files}" },
          },
        },
        "pre-push": main.hooks?.["pre-push"],
      },
    });
  });

  it("keeps the order of the main tasks, new ones last", () => {
    const merged = merge(main, {
      hooks: {
        "pre-commit": { tasks: { new: { run: "x" }, prettier: { run: "y" } } },
      },
    }) as { hooks: Record<string, { tasks: object }> };

    expect(Object.keys(merged.hooks["pre-commit"]?.tasks ?? {})).toEqual([
      "eslint",
      "prettier",
      "new",
    ]);
  });

  it("matches hooks across spellings and uses git's names", () => {
    expect(
      merge(
        { hooks: { preCommit: "npm test" } },
        { hooks: { "pre-commit": "npm run lint" } },
      ),
    ).toEqual({ hooks: { "pre-commit": "npm run lint" } });
    expect(merge(main, { hooks: { prePush: null } })).toEqual({
      hooks: { "pre-commit": main.hooks?.["pre-commit"] },
    });
  });

  it("uses `{ tasks }` as is over a command list", () => {
    const local = { tasks: { test: { run: "npm test" } } };
    expect(merge(main, { hooks: { "pre-push": local } })).toEqual({
      hooks: { "pre-commit": main.hooks?.["pre-commit"], "pre-push": local },
    });
  });

  it("fails when null removes a hook or task that is not there", () => {
    expect(() =>
      merge(main, {
        hooks: {
          "post-merge": null,
          "pre-commit": { tasks: { eslnt: null } },
          "pre-push": { tasks: { "type check": null } },
        },
      }),
    ).toThrow(
      new ConfigError(
        "ward.local.yml is invalid:\n" +
          "  hooks.post-merge: no such hook in the main config to remove\n" +
          "  hooks.pre-commit.tasks.eslnt: no such task in the main config to remove\n" +
          '  hooks.pre-push.tasks["type check"]: no such task in the main config to remove',
      ),
    );
  });
});
