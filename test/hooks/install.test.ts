import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installHooks } from "../../src/hooks/install.ts";
import { HOOKS } from "../../src/hooks/list.ts";
import { renderStub } from "../../src/hooks/stub.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

const posixOnly = process.platform === "win32" ? it.skip : it;

describe("installHooks", () => {
  it("writes a stub for every hook", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");

    const result = installHooks(hooksDir);

    expect(result).toEqual({ written: [...HOOKS], unchanged: [], foreign: [] });
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

    expect(result.foreign).toEqual(["pre-commit"]);
    expect(result.written).not.toContain("pre-commit");
    expect(readFileSync(join(hooksDir, "pre-commit"), "utf8")).toBe(foreign);
  });

  it("treats a directory in place of a hook as foreign", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    mkdirSync(join(hooksDir, "commit-msg"));

    expect(installHooks(hooksDir).foreign).toEqual(["commit-msg"]);
  });

  posixOnly("treats a symlinked hook as foreign", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "hooks");
    repo.write("scripts/hook.sh", renderStub("pre-commit"));
    symlinkSync(
      join(repo.dir, "scripts/hook.sh"),
      join(hooksDir, "pre-commit"),
    );

    expect(installHooks(hooksDir).foreign).toEqual(["pre-commit"]);
  });

  it("creates a missing hooks dir", () => {
    using repo = createTempRepo();
    const hooksDir = join(repo.dir, ".git", "custom", "hooks");

    installHooks(hooksDir);

    expect(existsSync(join(hooksDir, "pre-commit"))).toBe(true);
  });
});
