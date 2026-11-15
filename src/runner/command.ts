/** Where a file placeholder takes its files from. */
export type FileSource = "staged" | "push" | "all";

const FILE_PLACEHOLDERS: Readonly<Record<string, FileSource>> = {
  staged_files: "staged",
  push_files: "push",
  all_files: "all",
};

const PLACEHOLDER = /\{([1-9]\d*|staged_files|push_files|all_files)\}/g;

export type ExpandValues = {
  /** Arguments git passed to the hook, for `{1}`, `{2}`, … */
  args?: readonly string[];
  /** Files for `{staged_files}`, `{push_files}`, `{all_files}`. */
  files?: Readonly<Partial<Record<FileSource, readonly string[]>>>;
};

/**
 * Files a task with `glob` / `exclude` but no file placeholder is matched
 * against, to decide whether it runs. Other hooks have no such files.
 */
export const DEFAULT_FILE_SOURCE: Readonly<
  Partial<Record<string, FileSource>>
> = {
  "pre-commit": "staged",
  "pre-push": "push",
};

/** File sources a command uses, in no particular order. */
export function fileSources(command: string): Set<FileSource> {
  const sources = new Set<FileSource>();
  for (const [, name] of command.matchAll(PLACEHOLDER)) {
    const source = name === undefined ? undefined : FILE_PLACEHOLDERS[name];
    if (source !== undefined) sources.add(source);
  }
  return sources;
}

/**
 * Replace placeholders in one pass, so a value is never expanded again
 * (a file named `{1}.ts` stays as is):
 *
 * - `{1}`, `{2}`, … - the arguments git passed to the hook (`commit-msg` gets
 *   the message file as `{1}`). An argument git did not pass (the optional
 *   ones of `prepare-commit-msg`) expands to nothing. `{0}` is not a
 *   placeholder and is left as is.
 * - `{staged_files}`, `{push_files}`, `{all_files}` - the files, separated
 *   by spaces. A source missing from `files` expands to nothing.
 *
 * Values are quoted for the shell when they need it, so a path with spaces
 * stays one argument: write `{1}`, not `"{1}"`.
 */
export function expandCommand(
  command: string,
  { args = [], files = {} }: ExpandValues,
  platform: NodeJS.Platform = process.platform,
): string {
  return command.replace(PLACEHOLDER, (_, name: string) => {
    const source = FILE_PLACEHOLDERS[name];
    if (source !== undefined) {
      return (files[source] ?? [])
        .map((file) => quote(file, platform))
        .join(" ");
    }
    const value = args[Number(name) - 1];
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
