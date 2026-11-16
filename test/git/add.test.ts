import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addFiles, chunkPaths } from "../../src/git/add.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

describe("addFiles", () => {
  it("stages changes and deletions of the given files only", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n" });
    repo.write("a.ts", "a2\n");
    rmSync(join(repo.dir, "b.ts"));
    repo.write("c.ts", "c2\n");
    repo.write("other.ts", "x\n");

    addFiles(["a.ts", "b.ts"], { cwd: repo.dir, env: repo.env });

    expect(repo.git("diff", "--cached", "--name-status")).toBe(
      "M\ta.ts\nD\tb.ts",
    );
  });

  it("takes paths literally", () => {
    using repo = createTempRepo();
    repo.commit("init", { "[id].ts": "1\n", "i.ts": "1\n" });
    for (const name of ["[id].ts", "i.ts"]) repo.write(name, "2\n");

    addFiles(["[id].ts"], { cwd: repo.dir, env: repo.env });

    expect(
      repo.git("diff", "--cached", "--name-only", "-z").split("\0"),
    ).toEqual(["[id].ts", ""]);
  });

  // Windows doesn't allow `*` in file names.
  it.skipIf(process.platform === "win32")("takes `*` literally", () => {
    using repo = createTempRepo();
    repo.commit("init", { "*.md": "1\n", "a.md": "1\n" });
    for (const name of ["*.md", "a.md"]) repo.write(name, "2\n");

    addFiles(["*.md"], { cwd: repo.dir, env: repo.env });

    expect(
      repo.git("diff", "--cached", "--name-only", "-z").split("\0"),
    ).toEqual(["*.md", ""]);
  });

  it("stages a list longer than one call takes", () => {
    using repo = createTempRepo();
    const names = Array.from(
      { length: 200 },
      (_, i) => `${"x".repeat(100)}-${String(i).padStart(3, "0")}.ts`,
    );
    repo.commit("init", Object.fromEntries(names.map((n) => [n, "1\n"])));
    for (const name of names) repo.write(name, "2\n");

    addFiles(names, { cwd: repo.dir, env: repo.env });

    expect(repo.git("diff", "--name-only")).toBe("");
  });
});

describe("chunkPaths", () => {
  it("keeps each chunk within the limit, counting a separator per path", () => {
    expect(chunkPaths(["aaa", "bbb", "cc", "d"], 8)).toEqual([
      ["aaa", "bbb"],
      ["cc", "d"],
    ]);
  });

  it("gives a path longer than the limit a chunk of its own", () => {
    expect(chunkPaths(["a", "long-path", "b"], 4)).toEqual([
      ["a"],
      ["long-path"],
      ["b"],
    ]);
  });

  it("returns no chunks for no paths", () => {
    expect(chunkPaths([], 10)).toEqual([]);
  });
});
