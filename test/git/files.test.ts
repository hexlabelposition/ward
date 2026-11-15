import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getStagedFiles } from "../../src/git/files.ts";
import { createTempRepo, type TempRepo } from "../helpers/git-repo.ts";

function staged(repo: TempRepo, cwd = repo.dir) {
  return getStagedFiles({ cwd, env: repo.env }).sort();
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
