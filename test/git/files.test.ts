import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFromRef,
  getAllFiles,
  getPushFiles,
  getRefFiles,
  getStagedFiles,
  type GitFile,
  hasStagedChanges,
  parsePushInput,
  type PushUpdate,
} from "../../src/git/files.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const ZERO = "0".repeat(40);

function paths(files: GitFile[]) {
  return files.map((file) => file.path).sort();
}

function staged(repo: TempRepo, cwd = repo.dir) {
  return paths(getStagedFiles({ cwd, env: repo.env }));
}

function all(repo: TempRepo, cwd = repo.dir) {
  return paths(getAllFiles({ cwd, env: repo.env }));
}

function pushed(repo: TempRepo, updates: PushUpdate[], remote = "origin") {
  return paths(getPushFiles(updates, remote, { cwd: repo.dir, env: repo.env }));
}

function fromRef(repo: TempRepo, ref: string) {
  return paths(getRefFiles(ref, { cwd: repo.dir, env: repo.env }));
}

/** `main` with a commit, and `feature` forked from it and checked out. */
function featureBranch(repo: TempRepo) {
  repo.commit("base", { "a.txt": "a\n", "old.txt": "o\n", "gone.txt": "g\n" });
  repo.git("switch", "--quiet", "-c", "feature");
}

/** Symlinks only, from the lists above. */
function symlinks(files: GitFile[]) {
  return paths(files.filter((file) => file.symlink));
}

/**
 * Stage a symlink `link` → `target` and a submodule `sub` through the index,
 * so it works without symlink support (Windows).
 */
function stageSymlinkAndSubmodule(repo: TempRepo) {
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repo.dir,
    env: repo.env,
    input: "target.txt",
    encoding: "utf8",
  }).trim();
  repo.git("update-index", "--add", "--cacheinfo", `120000,${blob},link`);
  const commit = repo.git("rev-parse", "HEAD");
  repo.git("update-index", "--add", "--cacheinfo", `160000,${commit},sub`);
}

/** Add a bare repo as `origin`. It lives in `.git`, so it is removed with the repo. */
function addOrigin(repo: TempRepo) {
  const origin = join(repo.dir, ".git", "origin.git");
  repo.git("init", "--quiet", "--bare", origin);
  repo.git("remote", "add", "origin", origin);
}

/** The `pre-push` line git would send for pushing `branch` to the same name. */
function update(repo: TempRepo, branch: string): PushUpdate {
  let remoteSha = ZERO;
  try {
    remoteSha = repo.git(
      "rev-parse",
      "--verify",
      "--quiet",
      `origin/${branch}`,
    );
  } catch {
    // New branch on the remote.
  }
  return {
    localRef: `refs/heads/${branch}`,
    localSha: repo.git("rev-parse", branch),
    remoteRef: `refs/heads/${branch}`,
    remoteSha,
  };
}

describe("getStagedFiles", () => {
  it("returns an empty list when nothing is staged", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n" });
    repo.write("a.txt", "changed\n");
    repo.write("untracked.txt", "u\n");

    expect(staged(repo)).toEqual([]);
  });

  it("lists added and modified files, not unstaged ones", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "b\n" });
    repo.write("a.txt", "changed\n");
    repo.write("new.txt", "new\n");
    repo.write("b.txt", "unstaged\n");
    repo.git("add", "a.txt", "new.txt");

    expect(staged(repo)).toEqual(["a.txt", "new.txt"]);
  });

  it("leaves out deleted files", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "b\n" });
    repo.git("rm", "--quiet", "a.txt");

    expect(staged(repo)).toEqual([]);
  });

  it("lists a renamed file under its new path", () => {
    using repo = createTempRepo();
    repo.commit("init", { "old.txt": "same content\n".repeat(10) });
    repo.git("mv", "old.txt", "new.txt");

    expect(staged(repo)).toEqual(["new.txt"]);
  });

  it("works before the first commit", () => {
    using repo = createTempRepo();
    repo.write("a.txt", "a\n");
    repo.git("add", "a.txt");

    expect(staged(repo)).toEqual(["a.txt"]);
  });

  it("returns paths relative to the repo root from a subdirectory", () => {
    using repo = createTempRepo();
    repo.commit("init");
    repo.write("src/lib/a.ts", "a\n");
    repo.write("root.txt", "r\n");
    repo.git("add", "--all");

    expect(staged(repo, join(repo.dir, "src", "lib"))).toEqual([
      "root.txt",
      "src/lib/a.ts",
    ]);
  });

  it("keeps spaces and non-ASCII names unquoted", () => {
    using repo = createTempRepo();
    repo.commit("init");
    repo.write("with space.txt", "s\n");
    repo.write("файл.txt", "f\n");
    repo.git("add", "--all");

    expect(staged(repo)).toEqual(["with space.txt", "файл.txt"]);
  });

  it.skipIf(process.platform === "win32")("keeps newlines in names", () => {
    using repo = createTempRepo();
    repo.commit("init");
    repo.write("a\nb.txt", "n\n");
    repo.git("add", "--all");

    expect(staged(repo)).toEqual(["a\nb.txt"]);
  });
});

describe("hasStagedChanges", () => {
  it("tells whether the index differs from HEAD", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n", "b.ts": "b\n" });
    const git = { cwd: repo.dir, env: repo.env };
    // Unstaged changes don't count.
    repo.write("a.ts", "a2\n");
    expect(hasStagedChanges(git)).toBe(false);

    repo.git("add", "a.ts");
    expect(hasStagedChanges(git)).toBe(true);

    repo.write("a.ts", "a\n");
    repo.git("add", "a.ts");
    expect(hasStagedChanges(git)).toBe(false);

    repo.git("rm", "--quiet", "b.ts");
    expect(hasStagedChanges(git)).toBe(true);
  });

  it("compares with an empty tree before the first commit", () => {
    using repo = createTempRepo();
    const git = { cwd: repo.dir, env: repo.env };
    expect(hasStagedChanges(git)).toBe(false);

    repo.write("a.ts", "a\n");
    repo.git("add", "a.ts");
    expect(hasStagedChanges(git)).toBe(true);
  });
});

describe("getAllFiles", () => {
  it("lists tracked and staged files, not untracked ones", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "src/b.ts": "b\n" });
    repo.write("staged.txt", "s\n");
    repo.git("add", "staged.txt");
    repo.write("untracked.txt", "u\n");

    expect(all(repo)).toEqual(["a.txt", "src/b.ts", "staged.txt"]);
  });

  it("returns the whole repo relative to the root from a subdirectory", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "src/lib/b.ts": "b\n" });

    expect(all(repo, join(repo.dir, "src", "lib"))).toEqual([
      "a.txt",
      "src/lib/b.ts",
    ]);
  });

  it("lists a conflicted file once", () => {
    using repo = createTempRepo();
    repo.commit("base", { "a.txt": "base\n" });
    repo.git("switch", "--quiet", "-c", "other");
    repo.commit("other", { "a.txt": "other\n" });
    repo.git("switch", "--quiet", "main");
    repo.commit("main", { "a.txt": "main\n" });
    const merge = spawnSync("git", ["merge", "other"], {
      cwd: repo.dir,
      env: repo.env,
    });
    expect(merge.status).not.toBe(0);

    expect(all(repo)).toEqual(["a.txt"]);
  });

  it("returns an empty list in an empty repo", () => {
    using repo = createTempRepo();

    expect(all(repo)).toEqual([]);
  });
});

describe("parsePushInput", () => {
  it("parses one update per line and skips blank lines", () => {
    const a = "a".repeat(40);
    expect(
      parsePushInput(
        `refs/heads/main ${a} refs/heads/main ${ZERO}\n\nHEAD ${ZERO} refs/heads/old ${a}\r\n`,
      ),
    ).toEqual([
      {
        localRef: "refs/heads/main",
        localSha: a,
        remoteRef: "refs/heads/main",
        remoteSha: ZERO,
      },
      {
        localRef: "HEAD",
        localSha: ZERO,
        remoteRef: "refs/heads/old",
        remoteSha: a,
      },
    ]);
  });

  it("accepts sha-256 object names", () => {
    const sha = "b".repeat(64);
    expect(
      parsePushInput(`refs/heads/main ${sha} refs/heads/main ${sha}`),
    ).toHaveLength(1);
  });

  it("returns an empty list for empty input", () => {
    expect(parsePushInput("")).toEqual([]);
  });

  it("throws on a malformed line", () => {
    expect(() => parsePushInput("refs/heads/main abc")).toThrow(
      /pre-push input/,
    );
    expect(() =>
      parsePushInput(`refs/heads/main nope refs/heads/main ${ZERO}`),
    ).toThrow(/pre-push input/);
  });
});

describe("getPushFiles", () => {
  it("lists files of commits the remote branch doesn't have", () => {
    using repo = createTempRepo();
    addOrigin(repo);
    repo.commit("init", { "old.txt": "o\n", "a.txt": "a\n" });
    repo.git("push", "--quiet", "--no-verify", "origin", "main");
    repo.commit("one", { "a.txt": "changed\n", "new.txt": "n\n" });
    repo.commit("two", { "src/c.ts": "c\n" });

    expect(pushed(repo, [update(repo, "main")])).toEqual([
      "a.txt",
      "new.txt",
      "src/c.ts",
    ]);
  });

  it("limits a new branch to its own commits", () => {
    using repo = createTempRepo();
    addOrigin(repo);
    repo.commit("init", { "old.txt": "o\n" });
    repo.git("push", "--quiet", "--no-verify", "origin", "main");
    repo.git("switch", "--quiet", "-c", "feature");
    repo.commit("feature", { "f.txt": "f\n" });

    expect(pushed(repo, [update(repo, "feature")])).toEqual(["f.txt"]);
  });

  it("leaves out files deleted or renamed away by a later commit", () => {
    using repo = createTempRepo();
    addOrigin(repo);
    repo.commit("init", { "keep.txt": "k\n", "gone.txt": "g\n" });
    repo.git("push", "--quiet", "--no-verify", "origin", "main");
    repo.commit("add", { "tmp.txt": "t\n", "old.txt": "same\n".repeat(10) });
    repo.git("rm", "--quiet", "tmp.txt", "gone.txt");
    repo.git("mv", "old.txt", "new.txt");
    repo.commit("remove and rename");

    expect(pushed(repo, [update(repo, "main")])).toEqual(["new.txt"]);
  });

  it("returns nothing for a ref deletion or an up-to-date branch", () => {
    using repo = createTempRepo();
    addOrigin(repo);
    repo.commit("init", { "a.txt": "a\n" });
    repo.git("push", "--quiet", "--no-verify", "origin", "main");
    const sha = repo.git("rev-parse", "main");

    expect(
      pushed(repo, [
        {
          localRef: "(delete)",
          localSha: ZERO,
          remoteRef: "refs/heads/old",
          remoteSha: sha,
        },
        update(repo, "main"),
      ]),
    ).toEqual([]);
  });

  it("ignores a remote sha that is not in the local repo", () => {
    using repo = createTempRepo();
    addOrigin(repo);
    repo.commit("init", { "a.txt": "a\n" });
    repo.git("push", "--quiet", "--no-verify", "origin", "main");
    repo.commit("next", { "b.txt": "b\n" });

    expect(
      pushed(repo, [{ ...update(repo, "main"), remoteSha: "1".repeat(40) }]),
    ).toEqual(["b.txt"]);
  });

  it("lists each file once across updates and commits", () => {
    using repo = createTempRepo();
    addOrigin(repo);
    repo.commit("init");
    repo.git("push", "--quiet", "--no-verify", "origin", "main");
    repo.commit("one", { "a.txt": "1\n" });
    repo.commit("two", { "a.txt": "2\n" });
    repo.git("branch", "copy");

    const files = getPushFiles(
      [update(repo, "main"), update(repo, "copy")],
      "origin",
      { cwd: repo.dir, env: repo.env },
    );
    expect(files).toEqual([{ path: "a.txt", symlink: false }]);
  });

  it("takes the whole history when pushing to a URL", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n" });
    repo.commit("next", { "b.txt": "b\n" });

    expect(
      pushed(
        repo,
        [{ ...update(repo, "main"), remoteSha: ZERO }],
        "https://example.invalid/repo.git",
      ),
    ).toEqual(["a.txt", "b.txt"]);
  });
});

describe("getRefFiles", () => {
  it("lists files changed on the branch, not on the base after the fork", () => {
    using repo = createTempRepo();
    featureBranch(repo);
    repo.commit("feature", { "a.txt": "changed\n", "b.txt": "b\n" });
    repo.git("switch", "--quiet", "main");
    repo.commit("main moves on", { "c.txt": "c\n" });
    repo.git("switch", "--quiet", "feature");

    expect(fromRef(repo, "main")).toEqual(["a.txt", "b.txt"]);
  });

  it("leaves out deleted files and lists renamed ones under the new path", () => {
    using repo = createTempRepo();
    featureBranch(repo);
    repo.git("rm", "--quiet", "gone.txt");
    repo.git("mv", "old.txt", "new.txt");
    repo.git("commit", "--quiet", "--no-verify", "-m", "move");

    expect(fromRef(repo, "main")).toEqual(["new.txt"]);
  });

  it("leaves out uncommitted changes", () => {
    using repo = createTempRepo();
    featureBranch(repo);
    repo.commit("feature", { "b.txt": "b\n" });
    repo.write("staged.txt", "s\n");
    repo.git("add", "staged.txt");
    repo.write("a.txt", "unstaged\n");

    expect(fromRef(repo, "main")).toEqual(["b.txt"]);
  });

  it("returns paths relative to the repo root from a subdirectory", () => {
    using repo = createTempRepo();
    featureBranch(repo);
    repo.commit("feature", { "src/b.txt": "b\n" });

    const files = getRefFiles("main", {
      cwd: join(repo.dir, "src"),
      env: repo.env,
    });
    expect(paths(files)).toEqual(["src/b.txt"]);
  });

  it("returns nothing when the branch has no changes", () => {
    using repo = createTempRepo();
    featureBranch(repo);

    expect(fromRef(repo, "main")).toEqual([]);
  });
});

describe("checkFromRef", () => {
  it("accepts a ref that shares history with HEAD", () => {
    using repo = createTempRepo();
    featureBranch(repo);
    repo.commit("feature", { "b.txt": "b\n" });

    expect(checkFromRef("main", { cwd: repo.dir, env: repo.env })).toBeNull();
    expect(checkFromRef("HEAD~1", { cwd: repo.dir, env: repo.env })).toBeNull();
  });

  it("explains an unknown ref", () => {
    using repo = createTempRepo();
    featureBranch(repo);

    expect(checkFromRef("origin/main", { cwd: repo.dir, env: repo.env })).toBe(
      "--from-ref origin/main: no such commit; in CI, fetch it first (actions/checkout: `fetch-depth: 0`)",
    );
  });

  it("explains a ref without common history", () => {
    using repo = createTempRepo();
    featureBranch(repo);
    repo.git("switch", "--quiet", "--orphan", "other");
    repo.commit("unrelated", { "x.txt": "x\n" });

    expect(checkFromRef("main", { cwd: repo.dir, env: repo.env })).toBe(
      "--from-ref main: no common history with HEAD; in a shallow clone, fetch it first (actions/checkout: `fetch-depth: 0`)",
    );
  });
});

describe("symlinks and submodules", () => {
  it("marks staged symlinks and leaves out submodules", () => {
    using repo = createTempRepo();
    repo.commit("init", { "target.txt": "t\n" });
    stageSymlinkAndSubmodule(repo);
    repo.write("a.txt", "a\n");
    repo.git("add", "a.txt");

    const files = getStagedFiles({ cwd: repo.dir, env: repo.env });
    expect(paths(files)).toEqual(["a.txt", "link"]);
    expect(symlinks(files)).toEqual(["link"]);
  });

  it("marks symlinks in all files and leaves out submodules", () => {
    using repo = createTempRepo();
    repo.commit("init", { "target.txt": "t\n" });
    stageSymlinkAndSubmodule(repo);

    const files = getAllFiles({ cwd: repo.dir, env: repo.env });
    expect(paths(files)).toEqual(["link", "target.txt"]);
    expect(symlinks(files)).toEqual(["link"]);
  });

  it("marks pushed symlinks and leaves out submodules", () => {
    using repo = createTempRepo();
    addOrigin(repo);
    repo.commit("init", { "target.txt": "t\n" });
    repo.git("push", "--quiet", "--no-verify", "origin", "main");
    stageSymlinkAndSubmodule(repo);
    repo.write("a.txt", "a\n");
    repo.git("add", "a.txt");
    // Not `repo.commit`: `add --all` would drop the index-only link.
    repo.git("commit", "--quiet", "--no-verify", "-m", "links");

    const files = getPushFiles([update(repo, "main")], "origin", {
      cwd: repo.dir,
      env: repo.env,
    });
    expect(paths(files)).toEqual(["a.txt", "link"]);
    expect(symlinks(files)).toEqual(["link"]);
  });

  it("marks symlinks changed since a ref and leaves out submodules", () => {
    using repo = createTempRepo();
    repo.commit("init", { "target.txt": "t\n" });
    repo.git("switch", "--quiet", "-c", "feature");
    stageSymlinkAndSubmodule(repo);
    repo.write("a.txt", "a\n");
    repo.git("add", "a.txt");
    repo.git("commit", "--quiet", "--no-verify", "-m", "links");

    const files = getRefFiles("main", { cwd: repo.dir, env: repo.env });
    expect(paths(files)).toEqual(["a.txt", "link"]);
    expect(symlinks(files)).toEqual(["link"]);
  });
});
