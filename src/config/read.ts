import { basename } from "node:path";
import { discoverConfig } from "./discover.ts";
import { loadConfig } from "./load.ts";
import type { ResolvedConfig } from "./schema.ts";

/**
 * Find, load, validate and normalize the config of the repo at `root`.
 * Returns `null` without a config, so the caller can stop before importing
 * any loader.
 *
 * The whole config is validated even when one hook is asked for: a typo in
 * another hook (`pre-comit`) would otherwise never be reported.
 *
 * @throws ConfigError when the config can't be read or is invalid.
 */
export async function readConfig(root: string): Promise<ResolvedConfig | null> {
  const source = discoverConfig(root);
  if (!source) return null;

  const raw = await loadConfig(source);
  const { validateConfig, normalizeConfig } = await import("./schema.ts");
  const name =
    source.format === "package" ? 'package.json "ward"' : basename(source.file);
  return normalizeConfig(validateConfig(raw, name));
}
