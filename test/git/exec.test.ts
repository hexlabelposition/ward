import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git, gitBuffer, GitError } from "../../src/git/exec.ts";
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

describe("gitBuffer", () => {
  it("returns stdout as bytes, trailing newline included", () => {
    using repo = createTempRepo();
    const latin1 = Buffer.from("caf\xe9\n", "latin1");
    repo.commit("init");
    writeFileSync(join(repo.dir, "a.txt"), latin1);
    repo.git("add", "a.txt");

    expect(
      gitBuffer(["show", ":a.txt"], { cwd: repo.dir, env: repo.env }),
    ).toEqual(latin1);
  });
});
