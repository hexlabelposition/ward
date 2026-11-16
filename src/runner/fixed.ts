import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { isErrnoCode } from "../util/errors.ts";

/** Content hash of each file, `null` when it is missing. */
export type Snapshot = ReadonlyMap<string, string | null>;

/**
 * Hash the working tree content of `paths` (relative to `root`), to find the
 * files a task changed. A symlink is hashed by its target path, as git
 * stores it.
 */
export function snapshotFiles(
  root: string,
  paths: readonly string[],
): Snapshot {
  return new Map(paths.map((path) => [path, hashFile(join(root, path))]));
}

/**
 * Files whose content differs from `before`, deleted files included. Files
 * the task left as they were are not listed, even when they have unstaged
 * changes from before the run.
 */
export function changedFiles(root: string, before: Snapshot): string[] {
  const changed: string[] = [];
  for (const [path, hash] of before) {
    if (hashFile(join(root, path)) !== hash) changed.push(path);
  }
  return changed;
}

function hashFile(file: string): string | null {
  try {
    const hash = createHash("sha1");
    if (lstatSync(file).isSymbolicLink()) {
      hash.update("link\0").update(readlinkSync(file));
    } else {
      hash.update("file\0").update(readFileSync(file));
    }
    return hash.digest("hex");
  } catch (error) {
    if (isErrnoCode(error, "ENOENT") || isErrnoCode(error, "ENOTDIR")) {
      return null;
    }
    throw error;
  }
}
