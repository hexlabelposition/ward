import { describe, expect, it } from "vitest";
import { git, GitError } from "../../src/git/exec.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

describe("git", () => {
  it("returns stdout without the trailing newline", () => {
    using repo = createTempRepo();
    expect(
      git(["rev-parse", "--is-inside-work-tree"], {
        cwd: repo.dir,
        env: repo.env,
      }),
    ).toBe("true");
  });

  it("throws GitError with status and stderr on failure", () => {
    using repo = createTempRepo();
    let error: unknown;
    try {
      git(["rev-parse", "--verify", "nope"], { cwd: repo.dir, env: repo.env });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GitError);
    expect(error).toMatchObject({ status: 128 });
    expect((error as GitError).stderr).toMatch(/nope|fatal/);
  });
});
