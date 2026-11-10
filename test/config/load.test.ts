import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

// TS loading is tested in a real Node process (load-ts.test.ts).
describe("loadConfig", () => {
  it("loads YAML", async () => {
    using repo = createTempRepo();
    repo.write("ward.yml", "pre-commit: npm test\n");

    expect(
      await loadConfig({ format: "yaml", file: join(repo.dir, "ward.yml") }),
    ).toEqual({ "pre-commit": "npm test" });
  });

  it("loads package.json", async () => {
    using repo = createTempRepo();
    repo.write("package.json", '{"ward":{"pre-commit":"npm test"}}');

    expect(
      await loadConfig({
        format: "package",
        file: join(repo.dir, "package.json"),
      }),
    ).toEqual({ "pre-commit": "npm test" });
  });
});
