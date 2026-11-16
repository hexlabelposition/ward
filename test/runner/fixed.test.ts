import { rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedFiles, snapshotFiles } from "../../src/runner/fixed.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

const posixOnly = process.platform === "win32" ? it.skip : it;

describe("changedFiles", () => {
  it("lists files changed or deleted since the snapshot", () => {
    using repo = createTempRepo({ init: false });
    repo.write("same.ts", "1\n");
    repo.write("changed.ts", "1\n");
    repo.write("rewritten.ts", "1\n");
    repo.write("deleted.ts", "1\n");
    const before = snapshotFiles(repo.dir, [
      "same.ts",
      "changed.ts",
      "rewritten.ts",
      "deleted.ts",
    ]);

    repo.write("changed.ts", "2\n");
    repo.write("rewritten.ts", "1\n");
    rmSync(join(repo.dir, "deleted.ts"));

    expect(changedFiles(repo.dir, before)).toEqual([
      "changed.ts",
      "deleted.ts",
    ]);
  });

  it("lists a file that was missing and got created", () => {
    using repo = createTempRepo({ init: false });
    const before = snapshotFiles(repo.dir, ["new.ts", "dir/gone.ts"]);
    repo.write("new.ts", "");

    expect(changedFiles(repo.dir, before)).toEqual(["new.ts"]);
  });

  posixOnly(
    "compares a symlink by its target, not the file it points to",
    () => {
      using repo = createTempRepo({ init: false });
      repo.write("a.md", "a\n");
      repo.write("b.md", "a\n");
      symlinkSync("a.md", join(repo.dir, "link.md"));
      const before = snapshotFiles(repo.dir, ["link.md"]);

      repo.write("a.md", "changed\n");
      expect(changedFiles(repo.dir, before)).toEqual([]);

      unlinkSync(join(repo.dir, "link.md"));
      symlinkSync("b.md", join(repo.dir, "link.md"));
      expect(changedFiles(repo.dir, before)).toEqual(["link.md"]);
    },
  );
});
