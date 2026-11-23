import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildConfigSchema,
  buildPackageSchema,
} from "../../src/config/json-schema.ts";
import { KNOWN } from "../../src/config/schema.ts";
import { CAMEL_HOOKS, HOOKS } from "../../src/hooks/list.ts";

function readJson(file: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"),
  );
}

const schema = buildConfigSchema();

describe("JSON Schema", () => {
  it("schema.json is up to date (run `bun run schema`)", () => {
    expect(readJson("schema.json")).toEqual(schema);
  });

  it("package.schema.json is up to date (run `bun run schema`)", () => {
    expect(readJson("package.schema.json")).toEqual(buildPackageSchema());
  });

  it("is published with the package", () => {
    const pkg = readJson("package.json") as {
      files: string[];
      exports: Record<string, string>;
    };
    for (const file of ["schema.json", "package.schema.json"]) {
      expect(pkg.files).toContain(file);
      expect(pkg.exports[`./${file}`]).toBe(`./${file}`);
    }
  });

  it("lists every hook in both spellings", () => {
    expect(Object.keys(schema.properties.hooks.properties).sort()).toEqual(
      [...HOOKS, ...CAMEL_HOOKS].sort(),
    );
  });

  it("rejects a hook in both spellings", () => {
    expect(schema.properties.hooks.dependencies["pre-commit"]).toEqual({
      not: { required: ["preCommit"] },
    });
  });

  it("has the options validateConfig accepts", () => {
    const { hookTasks, task } = schema.definitions;
    expect(Object.keys(schema.properties)).toEqual([...KNOWN.config]);
    expect(Object.keys(hookTasks.properties)).toEqual([...KNOWN.hook]);
    expect(Object.keys(task.properties)).toEqual([...KNOWN.task]);
  });
});
