import {
  existsSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBackup,
  dropBackup,
  type HiddenChanges,
  hideUnstagedChanges,
  RestoreError,
  restoreUnstagedChanges,
  revertToBackup,
} from "../../src/git/backup.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

const LINES = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";

/** `a.txt` with its first line staged and its last line changed but not staged. */
function partiallyStaged(repo: TempRepo) {
  repo.commit("init", { "a.txt": LINES, "b.txt": "b\n" });
  repo.write("a.txt", LINES.replace("a", "A"));
  repo.git("add", "a.txt");
  repo.write("a.txt", LINES.replace("a", "A").replace("j", "J"));
}

/** Hide the unstaged changes, expecting some. */
function hide(repo: TempRepo, staged = ["a.txt"]): HiddenChanges {
  const hidden = hideUnstagedChanges(staged, { cwd: repo.dir, env: repo.env });
  if (hidden === null) throw new Error("expected hidden changes");
  return hidden;
}

function read(repo: TempRepo, path: string) {
  return readFileSync(join(repo.dir, path), "utf8");
}

describe("createBackup", () => {
  it("saves the index and the working tree without touching them", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n", "b.ts": "b\n" });
    repo.write("a.ts", "a staged\n");
    repo.git("add", "a.ts");
    repo.write("a.ts", "a unstaged\n");
    repo.write("b.ts", "b unstaged\n");
    const status = repo.git("status", "--porcelain");

    const hash = createBackup({ cwd: repo.dir, env: repo.env });

    expect(hash).toMatch(/^[0-9a-f]{40,64}$/);
    expect(repo.git("status", "--porcelain")).toBe(status);
    expect(repo.git("show", `${String(hash)}:a.ts`)).toBe("a unstaged");
    expect(repo.git("show", `${String(hash)}:b.ts`)).toBe("b unstaged");
    // The stash's second parent is the index.
    expect(repo.git("show", `${String(hash)}^2:a.ts`)).toBe("a staged");
  });

  it("adds the backup to the stash list", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    repo.write("a.ts", "a2\n");

    const hash = createBackup({ cwd: repo.dir, env: repo.env });

    expect(repo.git("stash", "list", "--format=%H %gs")).toBe(
      `${String(hash)} ward backup`,
    );
  });

  it("returns null when there are no changes", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    repo.write("untracked.ts", "x\n");

    expect(createBackup({ cwd: repo.dir, env: repo.env })).toBeNull();
    expect(repo.git("stash", "list")).toBe("");
  });

  it("returns null before the first commit", () => {
    using repo = createTempRepo();
    repo.write("a.ts", "a\n");
    repo.git("add", "a.ts");

    expect(createBackup({ cwd: repo.dir, env: repo.env })).toBeNull();
  });
});

describe("dropBackup", () => {
  it("removes only the backup, wherever it is in the stash list", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    repo.write("a.ts", "mine\n");
    repo.git("stash", "push", "--quiet", "-m", "mine");
    repo.write("a.ts", "a2\n");
    const hash = String(createBackup({ cwd: repo.dir, env: repo.env }));
    repo.git("stash", "push", "--quiet", "-m", "newer");

    dropBackup(hash, { cwd: repo.dir, env: repo.env });

    expect(repo.git("stash", "list", "--format=%gs")).toBe(
      "On main: newer\nOn main: mine",
    );
  });

  it("does nothing when the backup is already gone", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n" });
    repo.write("a.ts", "a2\n");
    const hash = String(createBackup({ cwd: repo.dir, env: repo.env }));
    repo.git("stash", "drop", "--quiet");

    expect(() => {
      dropBackup(hash, { cwd: repo.dir, env: repo.env });
    }).not.toThrow();
  });
});

describe("hideUnstagedChanges", () => {
  it("resets partially staged files to the index and saves a patch", () => {
    using repo = createTempRepo();
    partiallyStaged(repo);
    // Unstaged only: not hidden.
    repo.write("b.txt", "b2\n");

    const hidden = hideUnstagedChanges(["a.txt"], {
      cwd: repo.dir,
      env: repo.env,
    });

    expect(hidden?.files).toEqual(["a.txt"]);
    expect(hidden?.patch).toBe(join(repo.dir, ".git/ward/unstaged.patch"));
    expect(read(repo, "a.txt")).toBe(LINES.replace("a", "A"));
    expect(read(repo, "b.txt")).toBe("b2\n");
    expect(readFileSync(String(hidden?.patch), "utf8")).toContain("+J");
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "A").trim());
  });

  it("returns null when no staged file has unstaged changes", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "b\n" });
    repo.write("a.txt", "a2\n");
    repo.git("add", "a.txt");
    repo.write("b.txt", "b2\n");

    expect(
      hideUnstagedChanges(["a.txt"], { cwd: repo.dir, env: repo.env }),
    ).toBeNull();
    expect(existsSync(join(repo.dir, ".git/ward"))).toBe(false);
  });

  it("keeps bytes that are not UTF-8", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n" });
    repo.write("a.txt", "a2\n");
    repo.git("add", "a.txt");
    const latin1 = Buffer.from("a2\ncaf\xe9\n", "latin1");
    writeFileSync(join(repo.dir, "a.txt"), latin1);
    const git = { cwd: repo.dir, env: repo.env };

    restoreUnstagedChanges(hide(repo), git);

    expect(readFileSync(join(repo.dir, "a.txt"))).toEqual(latin1);
  });
});

describe("restoreUnstagedChanges", () => {
  it("puts the changes back on top of task fixes, leaving the index alone", () => {
    using repo = createTempRepo();
    partiallyStaged(repo);
    const git = { cwd: repo.dir, env: repo.env };
    const hidden = hide(repo);
    // A task fixes a line away from the unstaged change and stages it.
    repo.write("a.txt", LINES.replace("a", "A!"));
    repo.git("add", "a.txt");

    restoreUnstagedChanges(hidden, git);

    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "A!").replace("j", "J"),
    );
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "A!").trim());
    expect(existsSync(hidden.patch)).toBe(false);
  });

  it("merges the changes into lines next to a task fix", () => {
    using repo = createTempRepo();
    partiallyStaged(repo);
    const git = { cwd: repo.dir, env: repo.env };
    const hidden = hide(repo);
    // In the context of the unstaged change, so a plain apply fails, but not
    // next to it: git merges changes two lines apart.
    repo.write("a.txt", LINES.replace("a", "A").replace("g", "G"));
    repo.git("add", "a.txt");

    restoreUnstagedChanges(hidden, git);

    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "A").replace("g", "G").replace("j", "J"),
    );
    expect(repo.git("show", ":a.txt")).toBe(
      LINES.replace("a", "A").replace("g", "G").trim(),
    );
    expect(repo.git("status", "--porcelain")).toBe("MM a.txt");
  });

  it("merges into a task fix that was not staged", () => {
    using repo = createTempRepo();
    partiallyStaged(repo);
    const git = { cwd: repo.dir, env: repo.env };
    const hidden = hide(repo);
    repo.write("a.txt", LINES.replace("a", "A").replace("g", "G"));

    restoreUnstagedChanges(hidden, git);

    expect(read(repo, "a.txt")).toBe(
      LINES.replace("a", "A").replace("g", "G").replace("j", "J"),
    );
    expect(repo.git("show", ":a.txt")).toBe(LINES.replace("a", "A").trim());
  });

  it("leaves conflict markers and keeps the patch when changes overlap", () => {
    using repo = createTempRepo();
    partiallyStaged(repo);
    const git = { cwd: repo.dir, env: repo.env };
    const hidden = hide(repo);
    repo.write("a.txt", LINES.replace("a", "A").replace("j", "j;"));
    repo.git("add", "a.txt");

    let error: unknown;
    try {
      restoreUnstagedChanges(hidden, git);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(RestoreError);
    expect(error).toMatchObject({
      conflicts: ["a.txt"],
      patch: hidden.patch,
    });
    expect(read(repo, "a.txt")).toContain("<<<<<<<");
    expect(existsSync(hidden.patch)).toBe(true);
    // The index still holds what the task staged.
    expect(repo.git("show", ":a.txt")).toBe(
      LINES.replace("a", "A").replace("j", "j;").trim(),
    );
    expect(existsSync(`${hidden.patch}.index`)).toBe(false);
  });
});

describe("revertToBackup", () => {
  it("puts the index and the working tree back as they were", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" });
    repo.write("a.txt", "a staged\n");
    repo.git("add", "a.txt");
    repo.write("a.txt", "a unstaged\n");
    repo.write("b.txt", "b unstaged\n");
    const git = { cwd: repo.dir, env: repo.env };
    const status = repo.git("status", "--porcelain");
    const hash = String(createBackup(git));
    // What tasks might do: fix and stage, delete, add a new file.
    repo.write("a.txt", "A FIXED\n");
    rmSync(join(repo.dir, "c.txt"));
    repo.write("new.txt", "new\n");
    repo.git("add", "--all");

    revertToBackup(hash, git);

    expect(read(repo, "a.txt")).toBe("a unstaged\n");
    expect(repo.git("show", ":a.txt")).toBe("a staged");
    expect(read(repo, "b.txt")).toBe("b unstaged\n");
    expect(read(repo, "c.txt")).toBe("c\n");
    // Out of the index, still on disk.
    expect(read(repo, "new.txt")).toBe("new\n");
    expect(repo.git("status", "--porcelain")).toBe(`${status}\n?? new.txt`);
  });

  it("leaves files the tasks did not touch as they are", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "b\n" });
    repo.write("a.txt", "a2\n");
    repo.write("b.txt", "b2\n");
    const git = { cwd: repo.dir, env: repo.env };
    const hash = String(createBackup(git));
    const old = new Date(2000, 0, 1);
    utimesSync(join(repo.dir, "b.txt"), old, old);
    repo.write("a.txt", "A2\n");

    revertToBackup(hash, git);

    expect(read(repo, "a.txt")).toBe("a2\n");
    expect(statSync(join(repo.dir, "b.txt")).mtime).toEqual(old);
  });
});
