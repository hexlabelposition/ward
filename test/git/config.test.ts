import { describe, expect, it } from "vitest";
import { getConfig } from "../../src/git/config.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

describe("getConfig", () => {
  it("returns null for an unset key", () => {
    using repo = createTempRepo();

    expect(getConfig("core.hooksPath", { cwd: repo.dir, env: repo.env })).toBe(
      null,
    );
  });

  it("returns the value and its scope", () => {
    using repo = createTempRepo();
    repo.git("config", "--global", "core.hooksPath", "~/hooks");
    expect(
      getConfig("core.hooksPath", { cwd: repo.dir, env: repo.env }),
    ).toEqual({ value: "~/hooks", scope: "global" });

    repo.git("config", "core.hooksPath", ".husky/_");
    expect(
      getConfig("core.hooksPath", { cwd: repo.dir, env: repo.env }),
    ).toEqual({ value: ".husky/_", scope: "local" });
  });
});
