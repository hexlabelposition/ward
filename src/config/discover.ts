import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isErrnoCode } from "../util/errors.ts";
import { ConfigError } from "./errors.ts";

export type ConfigFormat = "ts" | "yaml" | "package";

export type ConfigSource = {
  format: ConfigFormat;
  /** Absolute path to the file. */
  file: string;
};

/** Candidates in discovery order. */
const FILES: readonly [name: string, format: ConfigFormat][] = [
  ["ward.config.ts", "ts"],
  ["ward.yml", "yaml"],
  ["ward.yaml", "yaml"],
  ["package.json", "package"],
];

/**
 * Find the config in the repo root: `ward.config.ts` → `ward.{yml,yaml}` →
 * the `"ward"` key of `package.json`. Only reads `package.json`, so it stays
 * cheap on the no-op path.
 *
 * Returns `null` without a config. Throws `ConfigError` when several sources
 * exist: picking one silently would hide the other.
 */
export function discoverConfig(root: string): ConfigSource | null {
  const found = FILES.filter(([name, format]) => {
    const file = join(root, name);
    return format === "package" ? hasWardKey(file) : isFile(file);
  }).map(([name, format]) => ({ name, format, file: join(root, name) }));

  if (found.length > 1) {
    const names = found
      .map(({ name, format }) =>
        format === "package" ? `${name} ("ward" key)` : name,
      )
      .join(", ");
    throw new ConfigError(`several configs found: ${names}. Keep one of them.`);
  }

  const [source] = found;
  return source ? { format: source.format, file: source.file } : null;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch (error) {
    if (isErrnoCode(error, "ENOENT") || isErrnoCode(error, "ENOTDIR")) {
      return false;
    }
    throw error;
  }
}

function hasWardKey(file: string): boolean {
  if (!isFile(file)) return false;
  let pkg: unknown;
  try {
    // npm accepts a BOM, JSON.parse doesn't.
    pkg = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ConfigError(`package.json is not valid JSON: ${error.message}`);
  }
  return (
    typeof pkg === "object" &&
    pkg !== null &&
    !Array.isArray(pkg) &&
    Object.hasOwn(pkg, "ward")
  );
}
