import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findForeignHooks, installHooks } from "../../src/hooks/install.ts";
import { HOOKS } from "../../src/hooks/list.ts";
import { renderStub } from "../../src/hooks/stub.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

const posixOnly = process.platform === "win32" ? it.skip : it;

describe("installHooks", () => {
  it("writes a stub for every hook", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");

    const result = installHooks(hooksDir);

    expect(result).toEqual({
      written: [...HOOKS],
      unchanged: [],
      chained: [],
      overwritten: [],
      foreign: [],
    });
    for (const hook of HOOKS) {
      expect(readFileSync(join(hooksDir, hook), "utf8")).toBe(renderStub(hook));
    }
    expect(existsSync(join(hooksDir, "pre-commit.ward-tmp"))).toBe(false);
  });

  posixOnly("makes stubs executable", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");

    installHooks(hooksDir);

    expect(statSync(join(hooksDir, "pre-commit")).mode & 0o777).toBe(0o755);
  });

  posixOnly("restores a lost exec bit on an up-to-date stub", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    installHooks(hooksDir);
    chmodSync(join(hooksDir, "pre-commit"), 0o644);

    installHooks(hooksDir);

    expect(statSync(join(hooksDir, "pre-commit")).mode & 0o777).toBe(0o755);
  });

  it("is idempotent", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    installHooks(hooksDir);

    expect(installHooks(hooksDir)).toEqual({
      written: [],
      unchanged: [...HOOKS],
      chained: [],
      overwritten: [],
      foreign: [],
    });
  });

  it("rewrites outdated ward stubs", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    installHooks(hooksDir);
    writeFileSync(join(hooksDir, "pre-push"), "#!/bin/sh\n# ward:managed v0\n");

    expect(installHooks(hooksDir).written).toEqual(["pre-push"]);
    expect(readFileSync(join(hooksDir, "pre-push"), "utf8")).toBe(
      renderStub("pre-push"),
    );
  });

  it("rewrites stubs when the bin path changes", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    installHooks(hooksDir);

    expect(installHooks(hooksDir, { bin: "tools/ward" }).written).toEqual([
      ...HOOKS,
    ]);
  });

  it("leaves foreign hooks untouched", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    const foreign = "#!/bin/sh\nnpx lint-staged\n";
    writeFileSync(join(hooksDir, "pre-commit"), foreign);

    const result = installHooks(hooksDir);

    expect(result.foreign).toEqual([
      { hook: "pre-commit", reason: "not-chained" },
    ]);
    expect(result.written).not.toContain("pre-commit");
    expect(readFileSync(join(hooksDir, "pre-commit"), "utf8")).toBe(foreign);
    expect(existsSync(join(hooksDir, "pre-commit.pre-ward"))).toBe(false);
  });

  it("finds foreign hooks", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    installHooks(hooksDir);
    writeFileSync(join(hooksDir, "pre-push"), "#!/bin/sh\ngit lfs pre-push\n");
    rmSync(join(hooksDir, "commit-msg"));
    mkdirSync(join(hooksDir, "commit-msg"));

    expect(findForeignHooks(hooksDir)).toEqual(["commit-msg", "pre-push"]);
  });

  it("chains foreign hooks when asked", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    const foreign = "#!/bin/sh\nnpx lint-staged\n";
    writeFileSync(join(hooksDir, "pre-commit"), foreign);

    const result = installHooks(hooksDir, { chain: true });

    expect(result.chained).toEqual(["pre-commit"]);
    expect(result.written).toContain("pre-commit");
    expect(result.foreign).toEqual([]);
    expect(readFileSync(join(hooksDir, "pre-commit.pre-ward"), "utf8")).toBe(
      foreign,
    );
    expect(readFileSync(join(hooksDir, "pre-commit"), "utf8")).toBe(
      renderStub("pre-commit"),
    );
  });

  it("does not overwrite an existing backup", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    writeFileSync(join(hooksDir, "pre-commit.pre-ward"), "old backup\n");
    writeFileSync(join(hooksDir, "pre-commit"), "new foreign\n");

    const result = installHooks(hooksDir, { chain: true });

    expect(result.foreign).toEqual([
      { hook: "pre-commit", reason: "backup-exists" },
    ]);
    expect(readFileSync(join(hooksDir, "pre-commit.pre-ward"), "utf8")).toBe(
      "old backup\n",
    );
    expect(readFileSync(join(hooksDir, "pre-commit"), "utf8")).toBe(
      "new foreign\n",
    );
  });

  it("keeps the chain on reinstall", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    writeFileSync(join(hooksDir, "pre-commit"), "foreign\n");
    installHooks(hooksDir, { chain: true });

    const result = installHooks(hooksDir);

    expect(result.unchanged).toContain("pre-commit");
    expect(result.foreign).toEqual([]);
    expect(readFileSync(join(hooksDir, "pre-commit.pre-ward"), "utf8")).toBe(
      "foreign\n",
    );
  });

  it("leaves a directory in place of a hook as is", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    mkdirSync(join(hooksDir, "commit-msg"));

    expect(installHooks(hooksDir).foreign).toEqual([
      { hook: "commit-msg", reason: "not-chained" },
    ]);
    expect(installHooks(hooksDir, { chain: true }).foreign).toEqual([
      { hook: "commit-msg", reason: "not-a-file" },
    ]);
  });

  posixOnly("treats a symlinked hook as foreign and chains the link", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    repo.write("scripts/hook.sh", renderStub("pre-commit"));
    symlinkSync(
      join(repo.dir, "scripts/hook.sh"),
      join(hooksDir, "pre-commit"),
    );

    expect(installHooks(hooksDir).foreign).toEqual([
      { hook: "pre-commit", reason: "not-chained" },
    ]);
    expect(installHooks(hooksDir, { chain: true }).chained).toEqual([
      "pre-commit",
    ]);
    expect(
      lstatSync(join(hooksDir, "pre-commit.pre-ward")).isSymbolicLink(),
    ).toBe(true);
  });

  it("overwrites foreign hooks with force", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    writeFileSync(join(hooksDir, "pre-commit"), "#!/bin/sh\nnpx lint-staged\n");

    const result = installHooks(hooksDir, { force: true });

    expect(result.overwritten).toEqual(["pre-commit"]);
    expect(result.written).toContain("pre-commit");
    expect(result.foreign).toEqual([]);
    expect(readFileSync(join(hooksDir, "pre-commit"), "utf8")).toBe(
      renderStub("pre-commit"),
    );
    expect(existsSync(join(hooksDir, "pre-commit.pre-ward"))).toBe(false);
  });

  it("prefers chaining over overwriting with chain and force", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    writeFileSync(join(hooksDir, "pre-commit"), "foreign\n");
    writeFileSync(join(hooksDir, "pre-push"), "new foreign\n");
    writeFileSync(join(hooksDir, "pre-push.pre-ward"), "old backup\n");

    const result = installHooks(hooksDir, { chain: true, force: true });

    expect(result.chained).toEqual(["pre-commit"]);
    expect(result.overwritten).toEqual(["pre-push"]);
    expect(result.foreign).toEqual([]);
    expect(readFileSync(join(hooksDir, "pre-push.pre-ward"), "utf8")).toBe(
      "old backup\n",
    );
    expect(readFileSync(join(hooksDir, "pre-push"), "utf8")).toBe(
      renderStub("pre-push"),
    );
  });

  it("leaves a directory in place of a hook as is with force", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    mkdirSync(join(hooksDir, "commit-msg"));

    expect(installHooks(hooksDir, { force: true }).foreign).toEqual([
      { hook: "commit-msg", reason: "not-a-file" },
    ]);
    expect(lstatSync(join(hooksDir, "commit-msg")).isDirectory()).toBe(true);
  });

  posixOnly("replaces a symlinked hook, not its target, with force", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    repo.write("scripts/hook.sh", "#!/bin/sh\necho mine\n");
    symlinkSync(
      join(repo.dir, "scripts/hook.sh"),
      join(hooksDir, "pre-commit"),
    );

    expect(installHooks(hooksDir, { force: true }).overwritten).toEqual([
      "pre-commit",
    ]);
    expect(lstatSync(join(hooksDir, "pre-commit")).isFile()).toBe(true);
    expect(readFileSync(join(repo.dir, "scripts/hook.sh"), "utf8")).toBe(
      "#!/bin/sh\necho mine\n",
    );
  });

  it("creates a missing hooks dir", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "custom", "hooks");

    installHooks(hooksDir);

    expect(existsSync(join(hooksDir, "pre-commit"))).toBe(true);
  });
});
