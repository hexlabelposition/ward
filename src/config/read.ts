import { basename } from "node:path";
import type { Config } from "./define.ts";
import {
  type ConfigSource,
  discoverConfig,
  discoverLocalConfig,
} from "./discover.ts";
import { loadConfig } from "./load.ts";
import type { ResolvedConfig } from "./schema.ts";

/**
 * Find, load, validate and normalize the config of the repo at `root`, with
 * `ward.local.*` merged on top. Returns `null` without either, so the caller
 * can stop before importing any loader.
 *
 * The whole config is validated even when one hook is asked for: a typo in
 * another hook (`pre-comit`) would otherwise never be reported.
 *
 * @throws ConfigError when the config can't be read or is invalid.
 */
export async function readConfig(root: string): Promise<ResolvedConfig | null> {
  const source = discoverConfig(root);
  const localSource = discoverLocalConfig(root);
  if (!source && !localSource) return null;

  const { validateConfig, validateLocalConfig, normalizeConfig } =
    await import("./schema.ts");

  let config: Config = {};
  if (source) {
    config = validateConfig(await loadConfig(source), configName(source));
  }
  if (localSource) {
    const localName = configName(localSource);
    const local = validateLocalConfig(await loadConfig(localSource), localName);
    const { mergeLocalConfig } = await import("./local.ts");
    const merged = mergeLocalConfig(config, local, localName);
    // What is left to report comes from both files, e.g. a new local task
    // without `run`, or a local `glob` on a main task without file placeholders.
    const name = source ? `${configName(source)} + ${localName}` : localName;
    config = validateConfig(merged, name);
  }
  return normalizeConfig(config);
}

function configName(source: ConfigSource): string {
  return source.format === "package"
    ? 'package.json "ward"'
    : basename(source.file);
}
