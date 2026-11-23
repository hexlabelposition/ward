import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isErrnoCode } from "../util/errors.ts";
import type { HookName } from "./list.ts";
import { getStubVersion, readStubOptions, STUB_VERSION } from "./stub.ts";

/**
 * Rewrite the stubs when the one for `hook` was written by another Ward
 * version, so an upgrade needs no reinstall. Runs on every `ward run`, so
 * the check reads only that one stub; the rest is imported when needed.
 *
 * Any other version counts, not only an older one: after a downgrade, a
 * newer stub may rely on things this version doesn't do. The new stubs keep
 * the binary and runtime of the old one.
 *
 * @returns The hooks whose stubs were written; empty when nothing was stale.
 */
export async function refreshStaleStubs(
  hooksDir: string,
  hook: HookName,
): Promise<HookName[]> {
  let content: string;
  try {
    content = readFileSync(join(hooksDir, hook), "utf8");
  } catch (error) {
    // No stub (`ward run` called directly), or not a file.
    if (isErrnoCode(error)) return [];
    throw error;
  }
  const version = getStubVersion(content);
  if (version === null || version === STUB_VERSION) return [];
  const options = readStubOptions(content);
  if (!options) return [];

  const { refreshHooks } = await import("./install.ts");
  return refreshHooks(hooksDir, options);
}
