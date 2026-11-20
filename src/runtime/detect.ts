/** JS runtime ward runs on. */
export type Runtime = "node" | "bun" | "deno";

/**
 * The runtime running this process.
 *
 * Bun and Deno set `process.versions.bun` / `process.versions.deno` and also
 * report a `node` version for compatibility, so they are checked first.
 *
 * @param versions `process.versions`, overridable for tests.
 */
export function detectRuntime(
  versions: NodeJS.ProcessVersions = process.versions,
): Runtime {
  if (versions.bun !== undefined) return "bun";
  if (versions.deno !== undefined) return "deno";
  return "node";
}
