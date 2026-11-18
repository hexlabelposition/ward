import {
  existsSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createBackup,
  hideUnstagedChanges,
  type HiddenChanges,
  RestoreError,
  restoreUnstagedChanges,
  revertToBackup,
} from "../../src/git/backup.ts";
import { getStagedFiles } from "../../src/git/files.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

// Edge cases of backup, partial staging and revert (W38).

const posixOnly = process.platform === "win32" ? it.skip : it;

function opts(repo: TempRepo) {
  return { cwd: repo.dir, env: repo.env };
}

/** Hide the unstaged changes of all staged files, expecting some. */
function hide(repo: TempRepo): HiddenChanges {
  const staged = getStagedFiles(opts(repo)).map((file) => file.path);
  const hidden = hideUnstagedChanges(staged, opts(repo));
  if (hidden === null) throw new Error("expected hidden changes");
  return hidden;
}

function bytes(repo: TempRepo, path: string): Buffer {
  return readFileSync(join(repo.dir, path));
}

function writeBytes(repo: TempRepo, path: string, data: number[]) {
  writeFileSync(join(repo.dir, path), Buffer.from(data));
}

function status(repo: TempRepo): string {
  return repo.git("status", "--porcelain", "--untracked-files=no");
}

describe("binary files", () => {
  it("hides and restores the unstaged version", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeBytes(repo, "a.bin", [0, 1, 2]);
    repo.git("add", "a.bin");
    writeBytes(repo, "a.bin", [0, 1, 3]);

    const hidden = hide(repo);
    expect(bytes(repo, "a.bin")).toEqual(Buffer.from([0, 1, 2]));
    restoreUnstagedChanges(hidden, opts(repo));

    expect(bytes(repo, "a.bin")).toEqual(Buffer.from([0, 1, 3]));
    expect(status(repo)).toBe("AM a.bin");
  });

  it("keeps the task's version and the patch when both changed it", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeBytes(repo, "a.bin", [0, 1, 2]);
    repo.git("add", "a.bin");
    writeBytes(repo, "a.bin", [0, 1, 3]);
    const hidden = hide(repo);
    writeBytes(repo, "a.bin", [0, 9]);
    repo.git("add", "a.bin");

    expect(() => {
      restoreUnstagedChanges(hidden, opts(repo));
    }).toThrow(RestoreError);
    expect(bytes(repo, "a.bin")).toEqual(Buffer.from([0, 9]));
    expect(existsSync(hidden.patch)).toBe(true);
  });

  it("reverts to the backup", () => {
    using repo = createTempRepo();
    repo.commit("init");
    writeBytes(repo, "a.bin", [0, 1, 2]);
    repo.git("add", "a.bin");
    writeBytes(repo, "a.bin", [0, 1, 3]);
    repo.commit("bin");
    writeBytes(repo, "a.bin", [0, 1, 4]);
    const before = status(repo);
    const hash = String(createBackup(opts(repo)));
    writeBytes(repo, "a.bin", [0, 9]);
    repo.git("add", "a.bin");

    revertToBackup(hash, opts(repo));

    expect(bytes(repo, "a.bin")).toEqual(Buffer.from([0, 1, 4]));
    expect(status(repo)).toBe(before);
  });
});

describe("renames", () => {
  it("hides and restores unstaged changes of a renamed file", () => {
    using repo = createTempRepo();
    repo.commit("init", { "old.txt": "a\nb\nc\nd\ne\nf\n" });
    repo.git("mv", "old.txt", "new.txt");
    repo.write("new.txt", "A\nb\nc\nd\ne\nf\n");
    repo.git("add", "new.txt");
    repo.write("new.txt", "A\nb\nc\nd\ne\nF\n");

    const hidden = hide(repo);
    expect(hidden.files).toEqual(["new.txt"]);
    expect(readFileSync(join(repo.dir, "new.txt"), "utf8")).toBe(
      "A\nb\nc\nd\ne\nf\n",
    );
    restoreUnstagedChanges(hidden, opts(repo));

    expect(readFileSync(join(repo.dir, "new.txt"), "utf8")).toBe(
      "A\nb\nc\nd\ne\nF\n",
    );
    expect(existsSync(join(repo.dir, "old.txt"))).toBe(false);
    expect(status(repo)).toBe("RM old.txt -> new.txt");
  });

  it("reverts a staged rename the tasks changed", () => {
    using repo = createTempRepo();
    repo.commit("init", { "old.txt": "a\n" });
    repo.git("mv", "old.txt", "new.txt");
    repo.write("new.txt", "a2\n");
    const before = status(repo);
    const hash = String(createBackup(opts(repo)));
    repo.write("new.txt", "A2\n");
    repo.git("add", "new.txt");

    revertToBackup(hash, opts(repo));

    expect(readFileSync(join(repo.dir, "new.txt"), "utf8")).toBe("a2\n");
    expect(status(repo)).toBe(before);
  });
});

describe("deletions", () => {
  it("checks out a staged file deleted in the working tree, then deletes it again", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n" });
    repo.write("a.txt", "a2\n");
    repo.git("add", "a.txt");
    rmSync(join(repo.dir, "a.txt"));

    const hidden = hide(repo);
    expect(hidden).toMatchObject({ files: [], deleted: ["a.txt"] });
    expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("a2\n");
    // A task fixes it and stages the fix.
    repo.write("a.txt", "A2\n");
    repo.git("add", "a.txt");
    restoreUnstagedChanges(hidden, opts(repo));

    expect(existsSync(join(repo.dir, "a.txt"))).toBe(false);
    expect(repo.git("show", ":a.txt")).toBe("A2");
    expect(existsSync(hidden.patch)).toBe(false);
  });

  it("restores a deletion together with changes of other files", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "1\n2\n3\n4\n5\n" });
    repo.write("a.txt", "a2\n");
    repo.write("b.txt", "1!\n2\n3\n4\n5\n");
    repo.git("add", "a.txt", "b.txt");
    rmSync(join(repo.dir, "a.txt"));
    repo.write("b.txt", "1!\n2\n3\n4\n5!\n");

    const hidden = hide(repo);
    expect(hidden).toMatchObject({ files: ["b.txt"], deleted: ["a.txt"] });
    restoreUnstagedChanges(hidden, opts(repo));

    expect(existsSync(join(repo.dir, "a.txt"))).toBe(false);
    expect(readFileSync(join(repo.dir, "b.txt"), "utf8")).toBe(
      "1!\n2\n3\n4\n5!\n",
    );
  });

  it("leaves staged deletions alone", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "b\n" });
    repo.git("rm", "--quiet", "a.txt");
    repo.write("b.txt", "b2\n");
    repo.git("add", "b.txt");

    expect(hideUnstagedChanges(["b.txt"], opts(repo))).toBeNull();
    expect(existsSync(join(repo.dir, "a.txt"))).toBe(false);
  });

  it("reverts files deleted before and by the tasks", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n" });
    repo.write("a.txt", "a2\n");
    repo.git("add", "a.txt");
    rmSync(join(repo.dir, "a.txt"));
    repo.git("rm", "--quiet", "b.txt");
    const before = status(repo);
    const hash = String(createBackup(opts(repo)));
    // Checked out for the tasks, then a task deletes another file.
    const hidden = hide(repo);
    rmSync(join(repo.dir, "c.txt"));

    revertToBackup(hash, opts(repo));

    expect(existsSync(join(repo.dir, "a.txt"))).toBe(false);
    expect(existsSync(join(repo.dir, "b.txt"))).toBe(false);
    expect(readFileSync(join(repo.dir, "c.txt"), "utf8")).toBe("c\n");
    expect(repo.git("show", ":a.txt")).toBe("a2");
    expect(status(repo)).toBe(before);
    expect(hidden.deleted).toEqual(["a.txt"]);
  });
});

describe("unresolved conflicts", () => {
  /** A cherry-pick stopped on a conflict in `a.txt`. */
  function conflict(repo: TempRepo) {
    repo.commit("base", { "a.txt": "base\n", "b.txt": "b\n" });
    repo.git("switch", "--quiet", "-c", "other");
    repo.commit("other", { "a.txt": "other\n" });
    repo.git("switch", "--quiet", "main");
    repo.commit("main", { "a.txt": "main\n" });
    try {
      repo.git("cherry-pick", "other");
    } catch {
      // Expected: the conflict stops it.
    }
  }

  it("creates no backup while the index has conflicts", () => {
    using repo = createTempRepo();
    conflict(repo);
    repo.write("b.txt", "b2\n");

    expect(createBackup(opts(repo))).toBeNull();
    expect(repo.git("stash", "list")).toBe("");
  });

  it("does not hide conflicted files", () => {
    using repo = createTempRepo();
    conflict(repo);

    expect(hideUnstagedChanges(["a.txt"], opts(repo))).toBeNull();
  });

  it("keeps a resolved cherry-pick going through a revert", () => {
    using repo = createTempRepo();
    conflict(repo);
    repo.write("a.txt", "resolved\n");
    repo.git("add", "a.txt");
    const hash = String(createBackup(opts(repo)));
    repo.write("a.txt", "RESOLVED\n");
    repo.git("add", "a.txt");

    revertToBackup(hash, opts(repo));

    expect(repo.git("show", ":a.txt")).toBe("resolved");
    expect(existsSync(join(repo.dir, ".git/CHERRY_PICK_HEAD"))).toBe(true);
  });
});

describe("symlinks", () => {
  posixOnly("hides and restores an unstaged symlink target", () => {
    using repo = createTempRepo();
    repo.commit("init", { "x.txt": "x\n", "y.txt": "y\n", "z.txt": "z\n" });
    symlinkSync("x.txt", join(repo.dir, "link"));
    repo.git("add", "link");
    rmSync(join(repo.dir, "link"));
    symlinkSync("y.txt", join(repo.dir, "link"));

    const hidden = hide(repo);
    expect(readlinkSync(join(repo.dir, "link"))).toBe("x.txt");
    restoreUnstagedChanges(hidden, opts(repo));

    expect(readlinkSync(join(repo.dir, "link"))).toBe("y.txt");
    expect(status(repo)).toBe("AM link");
  });

  posixOnly("hides and restores a file replaced by a symlink", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n", "x.txt": "x\n" });
    repo.write("a.txt", "a2\n");
    repo.git("add", "a.txt");
    rmSync(join(repo.dir, "a.txt"));
    symlinkSync("x.txt", join(repo.dir, "a.txt"));

    const hidden = hide(repo);
    expect(readFileSync(join(repo.dir, "a.txt"), "utf8")).toBe("a2\n");
    restoreUnstagedChanges(hidden, opts(repo));

    expect(readlinkSync(join(repo.dir, "a.txt"))).toBe("x.txt");
    expect(status(repo)).toBe("MT a.txt");
  });

  posixOnly("reverts a symlink the tasks replaced", () => {
    using repo = createTempRepo();
    repo.commit("init", { "x.txt": "x\n", "y.txt": "y\n" });
    symlinkSync("x.txt", join(repo.dir, "link"));
    repo.commit("link");
    rmSync(join(repo.dir, "link"));
    symlinkSync("y.txt", join(repo.dir, "link"));
    const before = status(repo);
    const hash = String(createBackup(opts(repo)));
    rmSync(join(repo.dir, "link"));
    repo.write("link", "a file now\n");

    revertToBackup(hash, opts(repo));

    expect(readlinkSync(join(repo.dir, "link"))).toBe("y.txt");
    expect(status(repo)).toBe(before);
  });
});

describe("non-ASCII paths", () => {
  it("hides and restores changes of a file with spaces and accents", () => {
    using repo = createTempRepo();
    const name = "dir é/ü ñ.txt";
    repo.commit("init", { [name]: "a\nb\nc\nd\ne\nf\n" });
    repo.write(name, "A\nb\nc\nd\ne\nf\n");
    repo.git("add", name);
    repo.write(name, "A\nb\nc\nd\ne\nF\n");

    const hidden = hide(repo);
    expect(hidden.files).toEqual([name]);
    restoreUnstagedChanges(hidden, opts(repo));

    expect(readFileSync(join(repo.dir, name), "utf8")).toBe(
      "A\nb\nc\nd\ne\nF\n",
    );
    expect(repo.git("show", `:${name}`)).toBe("A\nb\nc\nd\ne\nf");
  });
});
