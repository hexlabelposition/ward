import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getGitOperation } from "../../src/git/state.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

/** Two branches that change the same line: `main` and `other`. */
function conflictingBranches(repo: TempRepo) {
  repo.commit("base", { "a.txt": "base\n" });
  repo.git("switch", "--quiet", "-c", "other");
  repo.commit("other", { "a.txt": "other\n" });
  repo.git("switch", "--quiet", "main");
  repo.commit("main", { "a.txt": "main\n" });
}

/** Run git where a non-zero exit (conflict) is expected. */
function tryGit(repo: TempRepo, cwd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd, env: repo.env, encoding: "utf8" });
}

describe("getGitOperation", () => {
  it("returns null in a clean repo", () => {
    using repo = createTempRepo();
    repo.commit("init");

    expect(getGitOperation(join(repo.dir, ".git"))).toBeNull();
  });

  it("detects a merge waiting for its commit", () => {
    using repo = createTempRepo();
    conflictingBranches(repo);

    expect(tryGit(repo, repo.dir, "merge", "other").status).not.toBe(0);
    expect(getGitOperation(join(repo.dir, ".git"))).toBe("merge");

    repo.git("merge", "--abort");
    expect(getGitOperation(join(repo.dir, ".git"))).toBeNull();
  });

  it("detects a rebase stopped on a conflict", () => {
    using repo = createTempRepo();
    conflictingBranches(repo);

    expect(tryGit(repo, repo.dir, "rebase", "other").status).not.toBe(0);
    expect(getGitOperation(join(repo.dir, ".git"))).toBe("rebase");

    repo.git("rebase", "--abort");
    expect(getGitOperation(join(repo.dir, ".git"))).toBeNull();
  });

  it("detects `git am` stopped on a conflict", () => {
    using repo = createTempRepo();
    conflictingBranches(repo);
    repo.write(
      "other.patch",
      repo.git("format-patch", "-1", "other", "--stdout") + "\n",
    );

    expect(tryGit(repo, repo.dir, "am", "other.patch").status).not.toBe(0);
    expect(getGitOperation(join(repo.dir, ".git"))).toBe("rebase");
  });

  it("is per worktree", () => {
    using repo = createTempRepo();
    conflictingBranches(repo);
    const wt = join(repo.dir, "wt");
    repo.git("worktree", "add", "--quiet", "-b", "wt", wt, "main");

    expect(tryGit(repo, wt, "merge", "other").status).not.toBe(0);

    expect(getGitOperation(join(repo.dir, ".git", "worktrees", "wt"))).toBe(
      "merge",
    );
    expect(getGitOperation(join(repo.dir, ".git"))).toBeNull();
  });
});
