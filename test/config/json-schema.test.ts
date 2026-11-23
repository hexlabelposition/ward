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

/** Typed loosely: the definitions are keyed by computed names. */
type Definitions = Record<
  string,
  { properties: Record<string, unknown>; dependencies?: unknown }
>;

const schema = buildConfigSchema();
const definitions = schema.definitions as unknown as Definitions;
const def = (name: string) => definitions[name] ?? { properties: {} };

describe("JSON Schema", () => {
  it("schema.json is up to date (run `bun run schema`)", () => {
    expect(readJson("schema.json")).toEqual(schema);
  });

  it("local.schema.json is up to date (run `bun run schema`)", () => {
    expect(readJson("local.schema.json")).toEqual(
      buildConfigSchema({ local: true }),
    );
  });

  it("package.schema.json is up to date (run `bun run schema`)", () => {
    expect(readJson("package.schema.json")).toEqual(buildPackageSchema());
  });

  it("is published with the package", () => {
    const pkg = readJson("package.json") as {
      files: string[];
      exports: Record<string, string>;
    };
    for (const file of [
      "schema.json",
      "local.schema.json",
      "package.schema.json",
    ]) {
      expect(pkg.files).toContain(file);
      expect(pkg.exports[`./${file}`]).toBe(`./${file}`);
    }
  });

  it.each(["hooks", "hooksLayer"])(
    "lists every hook in both spellings in %s",
    (name) => {
      expect(Object.keys(def(name).properties).sort()).toEqual(
        [...HOOKS, ...CAMEL_HOOKS].sort(),
      );
      expect(def(name).dependencies).toMatchObject({
        "pre-commit": { not: { required: ["preCommit"] } },
      });
    },
  );

  it.each(["", "Layer"])("has the options validateConfig accepts%s", (v) => {
    expect(Object.keys(schema.properties)).toEqual([...KNOWN.config]);
    expect(Object.keys(def(`hookTasks${v}`).properties)).toEqual([
      ...KNOWN.hook,
    ]);
    expect(Object.keys(def(`task${v}`).properties)).toEqual([...KNOWN.task]);
  });
});
