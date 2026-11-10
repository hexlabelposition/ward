import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOKS } from "../../src/hooks/list.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const CLI = resolve(import.meta.dirname, "../../src/cli/index.ts");

function ward(repo: TempRepo, args: string[]) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { cwd: repo.dir, env: repo.env, encoding: "utf8" },
  );
  return { status, stdout, stderr };
}

describe("ward uninstall", () => {
  it("removes stubs and restores chained hooks", () => {
    using repo = createTempRepo();
    repo.write(".git/hooks/pre-push", "#!/bin/sh\ngit lfs pre-push\n");
    expect(ward(repo, ["--chain"]).status).toBe(0);

    const { status, stdout } = ward(repo, ["uninstall"]);

    expect(status).toBe(0);
    expect(stdout).toContain("restored pre-push from pre-push.pre-ward");
    expect(stdout).toContain(
      `removed ${String(HOOKS.length)} hooks from .git/hooks`,
    );
    expect(existsSync(join(repo.dir, ".git/hooks/pre-commit"))).toBe(false);
    expect(readFileSync(join(repo.dir, ".git/hooks/pre-push"), "utf8")).toBe(
      "#!/bin/sh\ngit lfs pre-push\n",
    );
  });

  it("says so when there is nothing to remove", () => {
    using repo = createTempRepo();

    const { status, stdout } = ward(repo, ["uninstall"]);

    expect(status).toBe(0);
    expect(stdout).toContain("no ward hooks found in .git/hooks");
  });

  it("cleans core.hooksPath and .git/hooks", () => {
    using repo = createTempRepo();
    ward(repo, []);
    repo.git("config", "core.hooksPath", ".githooks");
    ward(repo, ["--respect-hooks-path"]);

    const { status, stdout } = ward(repo, ["uninstall"]);

    expect(status).toBe(0);
    expect(stdout).toContain("from .githooks");
    expect(stdout).toContain("from .git/hooks");
    expect(existsSync(join(repo.dir, ".githooks/pre-commit"))).toBe(false);
    expect(existsSync(join(repo.dir, ".git/hooks/pre-commit"))).toBe(false);
  });

  it("warns that prepare will reinstall the hooks", () => {
    using repo = createTempRepo();
    repo.write(
      "package.json",
      JSON.stringify({ scripts: { prepare: "ward" } }),
    );
    ward(repo, []);

    expect(ward(repo, ["uninstall"]).stdout).toContain(
      'package.json still runs ward in "prepare"',
    );
  });

  it("fails outside a git repo", () => {
    using dir = createTempRepo({ init: false });
    dir.env.GIT_CEILING_DIRECTORIES = resolve(dir.dir, "..");

    const { status, stderr } = ward(dir, ["uninstall"]);

    expect(status).toBe(1);
    expect(stderr).toContain("not inside a git working tree");
  });

  it.each([["--chain"], ["extra"]])("rejects %s", (arg) => {
    using repo = createTempRepo();

    const { status, stderr } = ward(repo, ["uninstall", arg]);

    expect(status).toBe(1);
    expect(stderr).toContain(`unexpected argument "${arg}"`);
  });
});
