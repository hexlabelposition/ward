import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";
import { CLI } from "../helpers/ward-bin.ts";

/** Bun is optional locally; CI installs it for every test job. */
const hasBun = spawnSync("bun", ["--version"]).status === 0;

/**
 * A local package named like ward, installed with `file:`. Its bin loads the
 * source CLI, so no build is needed; the CLI's dependencies resolve from this
 * repo's node_modules.
 */
function fakeWardPackage(): TempRepo {
  const pkg = createTempRepo({ init: false });
  pkg.write(
    "package.json",
    JSON.stringify({
      name: "@hexlabelposition/ward",
      version: "0.0.0",
      type: "module",
      bin: { ward: "cli.mjs" },
    }),
  );
  pkg.write(
    "cli.mjs",
    `#!/usr/bin/env node\nawait import(${JSON.stringify(pathToFileURL(CLI).href)});\n`,
  );
  chmodSync(join(pkg.dir, "cli.mjs"), 0o755); // as in the published tarball
  return pkg;
}

function bunInstall(repo: TempRepo) {
  const { status, stdout, stderr } = spawnSync("bun", ["install"], {
    cwd: repo.dir,
    env: repo.env,
    encoding: "utf8",
  });
  return { status, output: stdout + stderr };
}

/** Commit with hooks enabled; the config's task leaves hook-ran.txt behind. */
function commitRunsHook(repo: TempRepo) {
  const { status, stderr } = spawnSync(
    "git",
    ["commit", "--allow-empty", "-m", "msg"],
    { cwd: repo.dir, env: repo.env, encoding: "utf8" },
  );
  expect(stderr).not.toContain("not found");
  expect(status).toBe(0);
  return existsSync(join(repo.dir, "hook-ran.txt"));
}

const CONFIG = "hooks:\n  pre-commit: echo ran> hook-ran.txt\n";

// `bun install` runs these slowly on Windows runners.
describe.skipIf(!hasBun)("bun install", { timeout: 60_000 }, () => {
  it("runs prepare and installs the stubs", () => {
    using pkg = fakeWardPackage();
    using repo = createTempRepo();
    repo.write(
      "package.json",
      JSON.stringify({
        name: "app",
        private: true,
        scripts: { prepare: "ward" },
        devDependencies: { "@hexlabelposition/ward": `file:${pkg.dir}` },
      }),
    );
    repo.write("ward.yml", CONFIG);

    const { status, output } = bunInstall(repo);

    expect(status).toBe(0);
    expect(output).toContain("hooks installed in .git/hooks");
    expect(
      readFileSync(join(repo.dir, ".git/hooks/pre-commit"), "utf8"),
    ).toContain("bin='node_modules/.bin/ward'");
    expect(commitRunsHook(repo)).toBe(true);
  });

  it("runs prepare of a workspace package and installs the stubs", () => {
    using pkg = fakeWardPackage();
    using repo = createTempRepo();
    repo.write(
      "package.json",
      JSON.stringify({
        name: "root",
        private: true,
        workspaces: ["packages/*"],
      }),
    );
    repo.write(
      "packages/a/package.json",
      JSON.stringify({
        name: "a",
        version: "1.0.0",
        scripts: { prepare: "ward" },
        devDependencies: { "@hexlabelposition/ward": `file:${pkg.dir}` },
      }),
    );
    repo.write("ward.yml", CONFIG);

    // Bun hides the output of workspace scripts: check the stubs instead.
    expect(bunInstall(repo).status).toBe(0);
    expect(
      readFileSync(join(repo.dir, ".git/hooks/pre-commit"), "utf8"),
    ).toMatch(/^bin='(packages\/a\/)?node_modules\/\.bin\/ward'$/m);
    expect(commitRunsHook(repo)).toBe(true);
  });
});
