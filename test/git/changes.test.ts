import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedLinesSince,
  getHead,
  parseChangedLines,
} from "../../src/git/changes.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

function lines(repo: TempRepo) {
  const git = { cwd: repo.dir, env: repo.env };
  const head = getHead(git);
  if (head === null) throw new Error("no commit");
  return Object.fromEntries(changedLinesSince(head, git));
}

describe("changedLinesSince", () => {
  it("returns the changed lines of each file in the commit", () => {
    using repo = createTempRepo();
    repo.commit("base", {
      "a.txt": "1\n2\n3\n4\n5\n",
      "b.txt": "b\n",
      "gone.txt": "x\ny\n",
    });
    repo.write("a.txt", "1\nTWO\n3\n4\nFIVE\nsix\n");
    repo.write("b.txt", "top\nb\n");
    rmSync(join(repo.dir, "gone.txt"));

    expect(lines(repo)).toEqual({
      "a.txt": [
        { start: 2, end: 2 },
        { start: 5, end: 5 },
      ],
      // An insertion at the top: the line it comes before.
      "b.txt": [{ start: 1, end: 1 }],
      "gone.txt": [{ start: 1, end: 2 }],
    });
  });

  it("finds files with special characters in their names", () => {
    using repo = createTempRepo();
    // Windows forbids `"` in file names; git quotes the name for it.
    const name =
      process.platform === "win32" ? "sp ace ü.txt" : 'sp ace "q" ü.txt';
    repo.commit("base", { [name]: "a\n" });
    repo.write(name, "b\n");

    expect(lines(repo)).toEqual({ [name]: [{ start: 1, end: 1 }] });
  });

  it("leaves out files without text hunks", () => {
    using repo = createTempRepo();
    repo.commit("base", { "bin.dat": "a\0b" });
    repo.write("bin.dat", "a\0c");

    expect(lines(repo)).toEqual({});
  });
});

describe("parseChangedLines", () => {
  it("takes the new path of an added file and ignores --- in content", () => {
    const patch = [
      "diff --git new.txt new.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ new.txt",
      "@@ -0,0 +1 @@",
      "+x",
      "diff --git a.txt a.txt",
      "--- a.txt",
      "+++ a.txt",
      "@@ -3,2 +3 @@",
      "--- not a header",
      "-y",
      "+z",
    ].join("\n");

    expect(Object.fromEntries(parseChangedLines(patch))).toEqual({
      "new.txt": [{ start: 1, end: 1 }],
      "a.txt": [{ start: 3, end: 4 }],
    });
  });

  it("unquotes C-style paths with octal UTF-8 bytes", () => {
    const patch = [
      'diff --git "t\\303\\274b\\tx" "t\\303\\274b\\tx"',
      '--- "t\\303\\274b\\tx"',
      '+++ "t\\303\\274b\\tx"',
      "@@ -1 +1 @@",
    ].join("\n");

    expect([...parseChangedLines(patch).keys()]).toEqual(["tüb\tx"]);
  });
});
