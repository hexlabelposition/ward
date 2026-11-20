/** JS runtime ward runs on. */
export type Runtime = "node" | "bun";

/**
 * The runtime running this process.
 *
 * Bun sets `process.versions.bun` and also reports a `node` version for
 * compatibility, so the Bun check has to come first.
 *
 * @param versions `process.versions`, overridable for tests.
 */
export function detectRuntime(
  versions: NodeJS.ProcessVersions = process.versions,
): Runtime {
  if (versions.bun !== undefined) return "bun";
  return "node";
}
