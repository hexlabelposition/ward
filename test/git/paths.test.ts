import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getRepoPaths } from "../../src/git/paths.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

describe("getRepoPaths", () => {
  it("resolves root, git dir and hooks dir", () => {
    using repo = createTempRepo();

    expect(getRepoPaths({ cwd: repo.dir, env: repo.env })).toEqual({
      root: repo.dir,
      gitDir: join(repo.dir, ".git"),
      hooksDir: join(repo.dir, ".git", "hooks"),
    });
  });

  it("returns absolute paths from a subdirectory", () => {
    using repo = createTempRepo();
    const sub = join(repo.dir, "a", "b");
    mkdirSync(sub, { recursive: true });

    expect(getRepoPaths({ cwd: sub, env: repo.env })).toEqual({
      root: repo.dir,
      gitDir: join(repo.dir, ".git"),
      hooksDir: join(repo.dir, ".git", "hooks"),
    });
  });

  it("uses the shared hooks dir in a linked worktree", () => {
    using repo = createTempRepo();
    repo.commit("init");
    const wt = join(repo.dir, "wt");
    repo.git("worktree", "add", "--quiet", wt);

    expect(getRepoPaths({ cwd: wt, env: repo.env })).toEqual({
      root: wt,
      gitDir: join(repo.dir, ".git", "worktrees", "wt"),
      hooksDir: join(repo.dir, ".git", "hooks"),
    });
  });

  it("honors core.hooksPath", () => {
    using repo = createTempRepo();
    repo.git("config", "core.hooksPath", ".husky");
    const sub = join(repo.dir, "sub");
    mkdirSync(sub);

    expect(getRepoPaths({ cwd: sub, env: repo.env })?.hooksDir).toBe(
      join(repo.dir, ".husky"),
    );
  });

  it("returns null outside a git repo", () => {
    using dir = createTempRepo({ init: false });
    const env = { ...dir.env, GIT_CEILING_DIRECTORIES: resolve(dir.dir, "..") };

    expect(getRepoPaths({ cwd: dir.dir, env })).toBeNull();
  });

  it("returns null inside the git dir", () => {
    using repo = createTempRepo();

    expect(
      getRepoPaths({ cwd: join(repo.dir, ".git"), env: repo.env }),
    ).toBeNull();
  });
});
