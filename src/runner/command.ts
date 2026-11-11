/**
 * Replace `{1}`, `{2}`, … with the arguments git passed to the hook
 * (`commit-msg` gets the message file as `{1}`).
 *
 * Values are quoted for the shell when they need it, so a path with spaces
 * stays one argument: write `{1}`, not `"{1}"`. An argument git did not pass
 * (the optional ones of `prepare-commit-msg`) expands to nothing. `{0}` is
 * not a placeholder and is left as is.
 */
export function expandArgs(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  return command.replace(/\{([1-9]\d*)\}/g, (_, n: string) => {
    const value = args[Number(n) - 1];
    return value === undefined || value === "" ? "" : quote(value, platform);
  });
}

/** Quote one argument for `sh`, or for `cmd.exe` on Windows. */
export function quote(value: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    if (/^[\w@+=:,./\\-]+$/.test(value)) return value;
    return `"${value.replaceAll('"', '\\"')}"`;
  }
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
