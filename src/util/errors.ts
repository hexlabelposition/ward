/**
 * `error.code` check for Node system errors (`ENOENT`, `EACCES`, ...).
 * Without `code`, true for any system error.
 */
export function isErrnoCode(error: unknown, code?: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    (code === undefined || error.code === code)
  );
}
