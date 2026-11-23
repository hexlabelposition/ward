import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/errors.ts";
import { readConfig } from "../../src/config/read.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

describe("readConfig", () => {
  it("returns null without a config", async () => {
    using repo = createTempRepo();

    expect(await readConfig(repo.dir)).toBe(null);
  });

  it("merges ward.local.yml on top of the main config", async () => {
    using repo = createTempRepo();
    repo.write(
      "package.json",
      JSON.stringify({
        ward: {
          hooks: {
            "pre-commit": { tasks: { lint: { run: "npm run lint" } } },
            "pre-push": "npm test",
          },
        },
      }),
    );
    repo.write(
      "ward.local.yml",
      "hooks:\n  prePush: null\n  pre-commit:\n    tasks:\n      lint:\n        glob: '*.ts'\n",
    );

    expect(await readConfig(repo.dir)).toEqual({
      hooks: {
        "pre-commit": {
          tasks: [{ name: "lint", run: "npm run lint", glob: ["*.ts"] }],
        },
      },
    });
  });

  it("reads ward.local.yml without a main config", async () => {
    using repo = createTempRepo();
    repo.write("ward.local.yml", "hooks:\n  pre-commit: npm test\n");

    expect(await readConfig(repo.dir)).toEqual({
      hooks: {
        "pre-commit": { tasks: [{ name: "npm test", run: "npm test" }] },
      },
    });
  });

  it("names the local config in its own problems", async () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-commit: npm test\n");
    repo.write("ward.local.yml", "hooks:\n  pre-comit: null\n");

    await expect(readConfig(repo.dir)).rejects.toThrow(
      new ConfigError(
        "ward.local.yml is invalid:\n" +
          '  hooks.pre-comit: unknown hook. Did you mean "pre-commit"?',
      ),
    );
  });

  it("names both files for problems of the merged config", async () => {
    using repo = createTempRepo();
    repo.write(
      "ward.yml",
      "hooks:\n  commit-msg:\n    tasks:\n      lint:\n        run: commitlint --edit {1}\n",
    );
    repo.write(
      "ward.local.yml",
      "hooks:\n  commit-msg:\n    tasks:\n      lint:\n        glob: '*.md'\n      new:\n        glob: '*.ts'\n",
    );

    await expect(readConfig(repo.dir)).rejects.toThrow(
      new ConfigError(
        "ward.yml + ward.local.yml is invalid:\n" +
          "  hooks.commit-msg.tasks.lint: `glob` and `exclude` need `{staged_files}`, `{push_files}` or `{all_files}` in `run` outside `pre-commit` and `pre-push`\n" +
          "  hooks.commit-msg.tasks.new: missing `run`",
      ),
    );
  });

  it("checks the main config before the local one", async () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "hooks:\n  pre-commit: ''\n");
    repo.write("ward.local.yml", "hooks:\n  nope: x\n");

    await expect(readConfig(repo.dir)).rejects.toThrow(/^ward\.yml is invalid/);
  });
});
