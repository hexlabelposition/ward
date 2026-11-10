import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverConfig } from "../../src/config/discover.ts";
import { ConfigError } from "../../src/config/errors.ts";
import { createTempRepo } from "../helpers/git-repo.ts";

const posixOnly = process.platform === "win32" ? it.skip : it;

describe("discoverConfig", () => {
  it("returns null without a config", () => {
    using repo = createTempRepo();
    repo.write("package.json", JSON.stringify({ name: "app" }));

    expect(discoverConfig(repo.dir)).toBe(null);
  });

  it.each([
    ["ward.config.ts", "ts"],
    ["ward.yml", "yaml"],
    ["ward.yaml", "yaml"],
  ])("finds %s", (name, format) => {
    using repo = createTempRepo();
    repo.write(name, "");
    repo.write("package.json", JSON.stringify({ name: "app" }));

    expect(discoverConfig(repo.dir)).toEqual({
      format,
      file: join(repo.dir, name),
    });
  });

  it('finds the "ward" key in package.json', () => {
    using repo = createTempRepo();
    repo.write("package.json", JSON.stringify({ ward: { "pre-commit": "" } }));

    expect(discoverConfig(repo.dir)).toEqual({
      format: "package",
      file: join(repo.dir, "package.json"),
    });
  });

  it.each([
    [["ward.config.ts", "ward.yml"], "ward.config.ts, ward.yml"],
    [["ward.yml", "ward.yaml"], "ward.yml, ward.yaml"],
    [["ward.yaml", "package.json"], 'ward.yaml, package.json ("ward" key)'],
  ])("fails on several configs: %j", (files, names) => {
    using repo = createTempRepo();
    for (const file of files) {
      repo.write(file, file === "package.json" ? '{"ward":{}}' : "");
    }

    expect(() => discoverConfig(repo.dir)).toThrow(
      new ConfigError(`several configs found: ${names}. Keep one of them.`),
    );
  });

  it("only looks in the given dir", () => {
    using repo = createTempRepo();
    repo.write("packages/a/ward.yml", "");

    expect(discoverConfig(repo.dir)).toBe(null);
    expect(discoverConfig(join(repo.dir, "packages/a"))?.format).toBe("yaml");
  });

  it("ignores a directory with a config name", () => {
    using repo = createTempRepo();
    mkdirSync(join(repo.dir, "ward.yml"));

    expect(discoverConfig(repo.dir)).toBe(null);
  });

  posixOnly("follows a symlinked config", () => {
    using repo = createTempRepo();
    repo.write("configs/ward.yml", "");
    symlinkSync(join(repo.dir, "configs/ward.yml"), join(repo.dir, "ward.yml"));

    expect(discoverConfig(repo.dir)?.format).toBe("yaml");
  });

  it("reads package.json with a BOM", () => {
    using repo = createTempRepo();
    repo.write("package.json", '\uFEFF{"ward":{}}');

    expect(discoverConfig(repo.dir)?.format).toBe("package");
  });

  it("fails on invalid package.json", () => {
    using repo = createTempRepo();
    repo.write("package.json", "{ nope");

    expect(() => discoverConfig(repo.dir)).toThrow(
      /^package\.json is not valid JSON: /,
    );
  });

  it.each(["[]", "null", '"ward"'])(
    "ignores package.json that is not an object: %s",
    (json) => {
      using repo = createTempRepo();
      repo.write("package.json", json);

      expect(discoverConfig(repo.dir)).toBe(null);
    },
  );
});
