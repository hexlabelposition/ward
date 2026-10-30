import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempRepo } from "./git-repo.ts";

describe("createTempRepo", () => {
  it("creates a git repo with a commit", () => {
    using repo = createTempRepo();
    repo.commit("init", { "a.txt": "a\n" });

    expect(repo.git("rev-parse", "--show-toplevel")).toBe(
      repo.dir.replaceAll("\\", "/"),
    );
    expect(repo.git("log", "--format=%s")).toBe("init");
    expect(repo.git("ls-files")).toBe("a.txt");
  });

  it("creates a plain dir without init", () => {
    using repo = createTempRepo({ init: false });
    expect(existsSync(join(repo.dir, ".git"))).toBe(false);
  });

  it("removes the dir on dispose", () => {
    let dir: string;
    {
      using repo = createTempRepo();
      dir = repo.dir;
    }
    expect(existsSync(dir)).toBe(false);
  });
});
