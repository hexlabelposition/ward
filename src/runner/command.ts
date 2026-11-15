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

/**
 * Longest command Ward passes to the shell. `cmd.exe` takes 8191 characters
 * for the whole command line; on Linux `sh -c <command>` gets the command as
 * one argument, capped at 128 KiB, and macOS caps arguments and environment
 * together at 1 MiB. Both leave room for the shell's own part and the env.
 */
export function maxCommandLength(platform: NodeJS.Platform): number {
  return platform === "win32" ? 8000 : 100_000;
}

/**
 * Expand a command, split into several commands when the file lists would
 * make it longer than `maxLength` (`maxCommandLength`). Each command gets the
 * next files of the longest list, in order; other lists and `{1}`, `{2}` are
 * expanded in full in each. A file is never split, so a single file longer
 * than the limit still gets a command of its own.
 *
 * Length is counted in UTF-8 bytes on POSIX (the kernel limit) and in
 * characters on Windows (`cmd.exe`).
 */
export function expandCommandChunks(
  command: string,
  values: ExpandValues,
  platform: NodeJS.Platform = process.platform,
  maxLength = maxCommandLength(platform),
): string[] {
  const full = expandCommand(command, values, platform);
  const length = (text: string) =>
    platform === "win32" ? text.length : Buffer.byteLength(text);
  if (length(full) <= maxLength) return [full];

  // The list to split: the one with the most files among those in `command`.
  let source: FileSource | undefined;
  let files: readonly string[] = [];
  for (const candidate of fileSources(command)) {
    const list = values.files?.[candidate] ?? [];
    if (list.length > files.length) {
      source = candidate;
      files = list;
    }
  }
  if (source === undefined || files.length <= 1) return [full];

  const placeholder = Object.keys(FILE_PLACEHOLDERS).find(
    (name) => FILE_PLACEHOLDERS[name] === source,
  );
  const uses = command.split(`{${String(placeholder)}}`).length - 1;
  const expandWith = (chunk: readonly string[]) =>
    expandCommand(
      command,
      { ...values, files: { ...values.files, [source]: chunk } },
      platform,
    );

  // Each file adds its quoted form at every use of the list, plus a space
  // before it unless it is the first.
  const base = length(expandWith([]));
  const commands: string[] = [];
  let chunk: string[] = [];
  let size = base;
  for (const file of files) {
    const quoted = length(quote(file, platform));
    const cost = uses * (chunk.length === 0 ? quoted : quoted + 1);
    if (chunk.length > 0 && size + cost > maxLength) {
      commands.push(expandWith(chunk));
      chunk = [];
      size = base;
    }
    if (chunk.length === 0) size += uses * quoted;
    else size += cost;
    chunk.push(file);
  }
  commands.push(expandWith(chunk));
  return commands;
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
