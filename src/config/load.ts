import type { ConfigSource } from "./discover.ts";

/**
 * Load the raw config from a discovered source: not validated (W45) or
 * normalized (`normalizeConfig`) yet. Loaders are imported lazily, so a TS
 * config never loads the YAML parser.
 */
export async function loadConfig({
  format,
  file,
}: ConfigSource): Promise<unknown> {
  switch (format) {
    case "ts": {
      const { loadTsConfig } = await import("./load-ts.ts");
      return loadTsConfig(file);
    }
    case "yaml": {
      const { loadYamlConfig } = await import("./load-yml.ts");
      return loadYamlConfig(file);
    }
    case "package": {
      const { loadPackageConfig } = await import("./load-pkg.ts");
      return loadPackageConfig(file);
    }
  }
}
