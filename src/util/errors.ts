/** `error.code` check for Node system errors (`ENOENT`, `EACCES`, ...). */
export function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
