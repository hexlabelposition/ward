import { basename } from "node:path";
import {
  type ConfigSource,
  discoverConfig,
  discoverLocalConfig,
} from "./discover.ts";
import { loadConfig } from "./load.ts";
import type { NamedLayer } from "./merge.ts";
import type { ResolvedConfig } from "./schema.ts";

/**
 * Find, load, validate and normalize the config of the repo at `root`: what
 * it `extends`, then the config, then `ward.local.*`, merged in that order.
 * Returns `null` without a config or a local one, so the caller can stop
 * before importing any loader.
 *
 * The whole config is validated even when one hook is asked for: a typo in
 * another hook (`pre-comit`) would otherwise never be reported.
 *
 * @throws ConfigError when a config can't be found, read or is invalid.
 */
export async function readConfig(root: string): Promise<ResolvedConfig | null> {
  const source = discoverConfig(root);
  const localSource = discoverLocalConfig(root);
  if (!source && !localSource) return null;

  const { validateConfig, validateLayer, normalizeConfig } =
    await import("./schema.ts");

  const layers: NamedLayer[] = [];
  if (source) {
    const raw = await loadConfig(source);
    const name = configName(source);
    // One config on its own: checked in one pass, so every problem shows.
    if (!localSource && !hasExtends(raw)) {
      return normalizeConfig(validateConfig(raw, name));
    }
    const { resolveLayers } = await import("./extends.ts");
    layers.push(...(await resolveLayers(raw, name, source.file)));
  }
  if (localSource) {
    const name = configName(localSource);
    const raw = await loadConfig(localSource);
    layers.push({ config: validateLayer(raw, name, { local: true }), name });
  }

  const { mergeLayers } = await import("./merge.ts");
  // What is left to report shows up only after the merge, e.g. a task added
  // without `run`, or a `glob` on a task without file placeholders: the
  // message names every config that went into it.
  const name = layers.map((layer) => layer.name).join(" + ");
  return normalizeConfig(validateConfig(mergeLayers(layers), name));
}

function hasExtends(raw: unknown): boolean {
  return (
    typeof raw === "object" && raw !== null && Object.hasOwn(raw, "extends")
  );
}

function configName(source: ConfigSource): string {
  return source.format === "package"
    ? 'package.json "ward"'
    : basename(source.file);
}
