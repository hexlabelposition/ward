import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseDocument } from "yaml";
import { ConfigError } from "./errors.ts";

/**
 * `ward.yml` / `ward.yaml` as plain data, not validated yet. An empty file
 * (or one with only comments) is an empty config.
 */
export function loadYamlConfig(file: string): unknown {
  const doc = parseDocument(readFileSync(file, "utf8"), {
    prettyErrors: true,
  });
  // Warnings (unknown tags and such) are left to validation.
  const [error] = doc.errors;
  if (error) {
    throw new ConfigError(`${basename(file)}: ${error.message}`, {
      cause: error,
    });
  }
  return doc.toJS() ?? {};
}
