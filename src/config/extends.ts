import { readFileSync, realpathSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { detectRuntime } from "../runtime/detect.ts";
import { isFile } from "./discover.ts";
import { ConfigError } from "./errors.ts";
import type { NamedLayer } from "./merge.ts";
import { validateLayer } from "./schema.ts";

/**
 * Turn a config and everything it extends into layers, in merge order: each
 * `extends` entry (with what it extends, first), then the config itself.
 * Every layer is validated on its own (`validateLayer`).
 *
 * @param raw The loaded config, not validated yet.
 * @param name Its name for messages: `ward.yml`, or the entry as written.
 * @param file The file it was loaded from: relative paths and packages in
 *   its `extends` are resolved from there.
 * @throws ConfigError for an invalid layer, an entry that can't be found or
 *   loaded, or a cycle.
 */
export async function resolveLayers(
  raw: unknown,
  name: string,
  file: string,
): Promise<NamedLayer[]> {
  return collect(raw, name, file, [{ key: resolve(file), name }]);
}

type Visit = { readonly key: string | object; readonly name: string };

async function collect(
  raw: unknown,
  name: string,
  file: string,
  chain: readonly Visit[],
): Promise<NamedLayer[]> {
  const { extends: entries, ...config } = validateLayer(raw, name);
  const layers: NamedLayer[] = [];
  const list = typeof entries === "string" ? [entries] : (entries ?? []);

  for (const [i, entry] of list.entries()) {
    if (typeof entry === "string") {
      const target = resolveEntry(entry, file);
      const visit = { key: target, name: entry };
      checkCycle(chain, visit);
      const loaded = await loadEntry(entry, target);
      layers.push(...(await collect(loaded, entry, target, [...chain, visit])));
    } else {
      // A config object: its own `extends` are relative to this file.
      const visit = { key: entry, name: `${name} extends[${String(i)}]` };
      checkCycle(chain, visit);
      layers.push(
        ...(await collect(entry, visit.name, file, [...chain, visit])),
      );
    }
  }

  layers.push({ config, name });
  return layers;
}

function checkCycle(chain: readonly Visit[], visit: Visit): void {
  if (!chain.some(({ key }) => key === visit.key)) return;
  const path = [...chain, visit].map((step) => step.name).join(" → ");
  throw new ConfigError(`extends cycle: ${path}`);
}

/** The file an entry points at: a relative path, or a file in an npm package. */
function resolveEntry(entry: string, from: string): string {
  if (/^\.\.?([/\\]|$)/.test(entry)) {
    const file = resolve(dirname(from), entry);
    if (!isFile(file)) {
      throw new ConfigError(`extends "${entry}": ${file} not found`);
    }
    return file;
  }
  return resolvePackageEntry(entry, from);
}

/**
 * The config file of an npm package, found in `node_modules` the way Node
 * finds packages: from the directory of the config that lists it, upwards.
 * The real path is used, so pnpm's links find the package's own dependencies.
 *
 * - `name`: `ward.yml` / `ward.yaml` in the package root, else the module
 *   from `exports` / `main` (its default export is the config).
 * - `name/sub`: `exports["./sub"]`, or the file `sub` without `exports`.
 */
function resolvePackageEntry(entry: string, from: string): string {
  const match = /^((?:@[^/]+\/)?[^/@][^/]*)(?:\/(.+))?$/.exec(entry);
  const name = match?.[1];
  if (name === undefined) {
    throw new ConfigError(
      `extends "${entry}": expected a path starting with \`./\` or an npm package name`,
    );
  }
  const subpath = match?.[2];
  const dir = findPackageDir(name, realpathSync(dirname(from)));
  if (dir === null) {
    const hint =
      detectRuntime() === "deno"
        ? `. Deno needs a node_modules folder for it: set "nodeModulesDir": "auto" in deno.json`
        : "";
    throw new ConfigError(
      `extends "${entry}": package ${name} not found, install it as a dev dependency${hint}`,
    );
  }

  if (subpath === undefined) {
    for (const yml of ["ward.yml", "ward.yaml"]) {
      if (isFile(join(dir, yml))) return join(dir, yml);
    }
  }
  const pkgJson = parseJson(join(dir, "package.json"));
  const pkg = isObject(pkgJson) ? pkgJson : {};
  const key = subpath === undefined ? "." : `./${subpath}`;
  let target: string | null;
  if (pkg.exports !== undefined) {
    target = exportTarget(pkg.exports, key);
    if (target === null) {
      throw new ConfigError(
        `extends "${entry}": package ${name} does not export "${key}"`,
      );
    }
  } else if (subpath !== undefined) {
    target = subpath;
  } else {
    target = typeof pkg.main === "string" ? pkg.main : "index.js";
  }

  const file = resolve(dir, target);
  if (!isFile(file)) {
    throw new ConfigError(
      `extends "${entry}": ${relative(dir, file)} not found in package ${name}`,
    );
  }
  return file;
}

function findPackageDir(name: string, from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (isFile(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

/** Conditions `import()` matches on this runtime, as in Node's resolver. */
function conditions(): ReadonlySet<string> {
  const runtime = detectRuntime();
  return new Set(["import", "default", "node", runtime]);
}

/**
 * The target of `key` (`.` or `./sub`) in a package's `exports`: exact
 * subpaths and conditions only, which is all a config package needs.
 */
function exportTarget(exports: unknown, key: string): string | null {
  const isSubpathMap =
    isObject(exports) && Object.keys(exports).some((k) => k.startsWith("."));
  if (!isSubpathMap) return key === "." ? conditionTarget(exports) : null;
  return Object.hasOwn(exports, key) ? conditionTarget(exports[key]) : null;
}

function conditionTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = conditionTarget(item);
      if (target !== null) return target;
    }
    return null;
  }
  if (!isObject(value)) return null;
  const accepted = conditions();
  for (const [condition, target] of Object.entries(value)) {
    if (!accepted.has(condition)) continue;
    const found = conditionTarget(target);
    if (found !== null) return found;
  }
  return null;
}

/** Load an entry's file by its extension; errors name the entry. */
async function loadEntry(entry: string, file: string): Promise<unknown> {
  try {
    switch (extname(file)) {
      case ".yml":
      case ".yaml": {
        const { loadYamlConfig } = await import("./load-yml.ts");
        return loadYamlConfig(file);
      }
      case ".json":
        return parseJson(file);
      case ".ts":
      case ".mts":
      case ".js":
      case ".mjs": {
        const { loadTsConfig } = await import("./load-ts.ts");
        return await loadTsConfig(file);
      }
      default:
        throw new ConfigError(
          `${file}: expected a .yml, .yaml, .json, .ts or .js file`,
        );
    }
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    throw new ConfigError(`extends "${entry}": ${error.message}`, {
      cause: error,
    });
  }
}

function parseJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ConfigError(`${file} is not valid JSON: ${error.message}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
