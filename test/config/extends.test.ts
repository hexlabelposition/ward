import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/errors.ts";
import { readConfig } from "../../src/config/read.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const posixOnly = process.platform === "win32" ? it.skip : it;

/** `{ hook: [task names] }` of the resolved config, to compare layers. */
async function tasks(repo: TempRepo) {
  const config = await readConfig(repo.dir);
  return Object.fromEntries(
    Object.entries(config?.hooks ?? {}).map(([hook, value]) => [
      hook,
      value.tasks.map((task) => `${task.name}: ${String(task.run)}`),
    ]),
  );
}

const lint =
  "hooks:\n  pre-commit:\n    tasks:\n      lint:\n        run: eslint\n";

describe("extends", () => {
  it("merges a relative path, then the config on top", async () => {
    using repo = createTempRepo();
    repo.write(
      "configs/base.yml",
      "hooks:\n  pre-push: npm test\n  pre-commit:\n    tasks:\n" +
        "      lint:\n        run: eslint {staged_files}\n" +
        "      format:\n        run: prettier -w {staged_files}\n",
    );
    repo.write(
      "ward.yml",
      "extends: ./configs/base.yml\nhooks:\n  pre-commit:\n    tasks:\n" +
        "      lint:\n        glob: '*.ts'\n      format: null\n" +
        "      test:\n        run: vitest related {staged_files}\n",
    );

    const config = await readConfig(repo.dir);

    expect(config).toEqual({
      hooks: {
        "pre-push": { tasks: [{ name: "npm test", run: "npm test" }] },
        "pre-commit": {
          tasks: [
            { name: "lint", run: "eslint {staged_files}", glob: ["*.ts"] },
            { name: "test", run: "vitest related {staged_files}" },
          ],
        },
      },
    });
  });

  it("merges a list in order and resolves nested paths from their file", async () => {
    using repo = createTempRepo();
    repo.write("shared/common.yml", "hooks:\n  pre-push: common\n");
    repo.write(
      "shared/base.yml",
      "extends: ./common.yml\nhooks:\n  commit-msg: base\n",
    );
    repo.write(
      "other.json",
      JSON.stringify({ hooks: { "commit-msg": "json" } }),
    );
    repo.write(
      "ward.yml",
      "extends:\n  - ./shared/base.yml\n  - ./other.json\n  - hooks:\n      post-merge: inline\n",
    );

    expect(await tasks(repo)).toEqual({
      "pre-push": ["common: common"],
      "commit-msg": ["json: json"],
      "post-merge": ["inline: inline"],
    });
  });

  it("works from package.json and under ward.local.yml", async () => {
    using repo = createTempRepo();
    repo.write("base.yml", lint);
    repo.write(
      "package.json",
      JSON.stringify({ ward: { extends: "./base.yml" } }),
    );
    repo.write("ward.local.yml", "hooks:\n  pre-push: mine\n");

    expect(await tasks(repo)).toEqual({
      "pre-commit": ["lint: eslint"],
      "pre-push": ["mine: mine"],
    });
  });

  it("names every config in problems of the merged one", async () => {
    using repo = createTempRepo();
    repo.write("base.yml", lint);
    repo.write(
      "ward.yml",
      "extends: ./base.yml\nhooks:\n  pre-commit:\n    tasks:\n      new:\n        glob: '*.ts'\n",
    );
    repo.write("ward.local.yml", "");

    await expect(readConfig(repo.dir)).rejects.toThrow(
      new ConfigError(
        "./base.yml + ward.yml + ward.local.yml is invalid:\n" +
          "  hooks.pre-commit.tasks.new: missing `run`",
      ),
    );
  });

  it("names the extended config in its own problems", async () => {
    using repo = createTempRepo();
    repo.write("base.yml", "hooks:\n  pre-comit: x\n");
    repo.write("ward.yml", "extends: ./base.yml\n");

    await expect(readConfig(repo.dir)).rejects.toThrow(
      new ConfigError(
        "./base.yml is invalid:\n" +
          '  hooks.pre-comit: unknown hook. Did you mean "pre-commit"?',
      ),
    );
  });

  it("names the entry when its file can't be loaded", async () => {
    using repo = createTempRepo();
    repo.write("base.yml", "hooks: [\n");
    repo.write("ward.yml", "extends: ./base.yml\n");

    await expect(readConfig(repo.dir)).rejects.toThrow(
      /^extends "\.\/base\.yml": base\.yml: /,
    );
  });

  it("fails on a missing file and an unknown file type", async () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "extends: ./nope.yml\n");
    await expect(readConfig(repo.dir)).rejects.toThrow(
      `extends "./nope.yml": ${join(repo.dir, "nope.yml")} not found`,
    );

    repo.write("base.toml", "");
    repo.write("ward.yml", "extends: ./base.toml\n");
    await expect(readConfig(repo.dir)).rejects.toThrow(
      `extends "./base.toml": ${join(repo.dir, "base.toml")}: expected a .yml, .yaml, .json, .ts or .js file`,
    );
  });

  it("fails on a cycle", async () => {
    using repo = createTempRepo();
    repo.write("a.yml", "extends: ./b.yml\n");
    repo.write("b.yml", "extends: ./ward.yml\n");
    repo.write("ward.yml", "extends: ./a.yml\n");

    await expect(readConfig(repo.dir)).rejects.toThrow(
      new ConfigError(
        "extends cycle: ward.yml → ./a.yml → ./b.yml → ./ward.yml",
      ),
    );
  });

  it("rejects built-in presets for now", async () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "extends: ward:ts\n");

    await expect(readConfig(repo.dir)).rejects.toThrow(
      "extends: built-in presets are not supported yet",
    );
  });
});

describe("extends an npm package", () => {
  it("uses ward.yml in the package root", async () => {
    using repo = createTempRepo();
    repo.write("node_modules/@co/ward/package.json", '{"name":"@co/ward"}');
    repo.write("node_modules/@co/ward/ward.yml", lint);
    repo.write("ward.yml", "extends: '@co/ward'\n");

    expect(await tasks(repo)).toEqual({ "pre-commit": ["lint: eslint"] });
  });

  it("imports the module from exports, with import conditions", async () => {
    using repo = createTempRepo();
    repo.write(
      "node_modules/cfg/package.json",
      JSON.stringify({
        name: "cfg",
        exports: {
          ".": {
            types: "./index.d.ts",
            require: "./index.cjs",
            import: "./index.mjs",
          },
          "./strict": "./strict.yml",
        },
      }),
    );
    repo.write(
      "node_modules/cfg/index.mjs",
      "export default { hooks: { 'pre-push': 'from module' } };\n",
    );
    repo.write("node_modules/cfg/strict.yml", "hooks:\n  commit-msg: strict\n");
    repo.write("ward.yml", "extends: [cfg, cfg/strict]\n");

    expect(await tasks(repo)).toEqual({
      "pre-push": ["from module: from module"],
      "commit-msg": ["strict: strict"],
    });
  });

  it("uses main, or a file in the package without exports", async () => {
    using repo = createTempRepo();
    repo.write(
      "node_modules/cfg/package.json",
      JSON.stringify({ name: "cfg", main: "lib/config.mjs" }),
    );
    repo.write(
      "node_modules/cfg/lib/config.mjs",
      "export default { hooks: { 'pre-push': 'main' } };\n",
    );
    repo.write("node_modules/cfg/extra.yaml", "hooks:\n  commit-msg: extra\n");
    repo.write("ward.yml", "extends: [cfg, cfg/extra.yaml]\n");

    expect(await tasks(repo)).toEqual({
      "pre-push": ["main: main"],
      "commit-msg": ["extra: extra"],
    });
  });

  it("fails on a package that is not installed", async () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "extends: '@co/nope/strict'\n");

    await expect(readConfig(repo.dir)).rejects.toThrow(
      /^extends "@co\/nope\/strict": package @co\/nope not found, install it as a dev dependency/,
    );
  });

  it("fails on a subpath the package does not export", async () => {
    using repo = createTempRepo();
    repo.write(
      "node_modules/cfg/package.json",
      JSON.stringify({ exports: { ".": "./index.mjs" } }),
    );
    repo.write("ward.yml", "extends: cfg/ward.yml\n");

    await expect(readConfig(repo.dir)).rejects.toThrow(
      new ConfigError(
        'extends "cfg/ward.yml": package cfg does not export "./ward.yml"',
      ),
    );
  });

  posixOnly(
    "finds a package's own dependencies through pnpm's links",
    async () => {
      using repo = createTempRepo();
      const store = "node_modules/.pnpm/node_modules";
      repo.write(`${store}/base/package.json`, "{}");
      repo.write(`${store}/base/ward.yml`, lint);
      repo.write(`${store}/cfg/package.json`, "{}");
      repo.write(`${store}/cfg/ward.yml`, "extends: base\n");
      symlinkSync(
        join(repo.dir, store, "cfg"),
        join(repo.dir, "node_modules/cfg"),
      );
      repo.write("ward.yml", "extends: cfg\n");

      expect(await tasks(repo)).toEqual({ "pre-commit": ["lint: eslint"] });
    },
  );

  it("looks in parent directories of the config", async () => {
    using repo = createTempRepo();
    mkdirSync(join(repo.dir, "node_modules/cfg"), { recursive: true });
    repo.write("node_modules/cfg/package.json", "{}");
    repo.write("node_modules/cfg/ward.yml", lint);
    repo.write("configs/base.yml", "extends: cfg\n");
    repo.write("ward.yml", "extends: ./configs/base.yml\n");

    expect(await tasks(repo)).toEqual({ "pre-commit": ["lint: eslint"] });
  });
});
