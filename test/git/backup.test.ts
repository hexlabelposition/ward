import { describe, expect, it } from "vitest";
import { createBackup, dropBackup } from "../../src/git/backup.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

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
