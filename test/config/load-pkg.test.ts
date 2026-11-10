import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadPackageConfig } from "../../src/config/load-pkg.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

describe("loadPackageConfig", () => {
  it('returns the "ward" key as is', () => {
    using repo = createTempRepo();
    const ward = { "pre-commit": "npm test", parallel: true };
    repo.write("package.json", JSON.stringify({ name: "app", ward }));

    expect(loadPackageConfig(join(repo.dir, "package.json"))).toEqual(ward);
  });

  it("returns undefined without the key", () => {
    using repo = createTempRepo();
    repo.write("package.json", "{}");

    expect(loadPackageConfig(join(repo.dir, "package.json"))).toBe(undefined);
  });

  it("fails on invalid JSON", () => {
    using repo = createTempRepo();
    repo.write("package.json", '{"ward": }');

    expect(() => loadPackageConfig(join(repo.dir, "package.json"))).toThrow(
      /^package\.json is not valid JSON: /,
    );
  });
});
