import { readFileSync } from "node:fs";
import { ConfigError } from "./errors.ts";

/** Parsed `package.json`. Throws `ConfigError` when it is not valid JSON. */
export function readPackageJson(file: string): unknown {
  try {
    // npm accepts a BOM, JSON.parse doesn't.
    return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ConfigError(`package.json is not valid JSON: ${error.message}`);
  }
}

/** The `"ward"` key of `package.json`, or `undefined` if there is none. */
export function getWardKey(pkg: unknown): unknown {
  return isObject(pkg) && Object.hasOwn(pkg, "ward") ? pkg.ward : undefined;
}

/** The raw `"ward"` section of `package.json`, not validated yet. */
export function loadPackageConfig(file: string): unknown {
  return getWardKey(readPackageJson(file));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
