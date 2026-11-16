import { StringDecoder } from "node:string_decoder";
import { styleText } from "node:util";

/** Takes a stream's output in chunks and writes it out line by line. */
export type LineWriter = {
  write: (chunk: Buffer | string) => void;
  /** Write a last line that has no newline, if any. */
  end: () => void;
};

/**
 * Put `prefix` before every line of a stream. Only whole lines are written,
 * so lines of tasks running at the same time never mix; a multi-byte
 * character split between chunks stays whole. A last line without a newline
 * is written by `end`, with one added.
 */
export function prefixLines(
  prefix: string,
  write: (text: string) => void,
): LineWriter {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  const flush = (text: string) => {
    const lines = (rest + text).split("\n");
    rest = lines.pop() ?? "";
    if (lines.length > 0) {
      write(lines.map((line) => `${prefix}${line}\n`).join(""));
    }
  };
  return {
    write: (chunk) => {
      flush(typeof chunk === "string" ? chunk : decoder.write(chunk));
    },
    end: () => {
      flush(decoder.end());
      if (rest !== "") write(`${prefix}${rest}\n`);
      rest = "";
    },
  };
}

/** Colors the prefixes cycle through, one per task. */
const COLORS = ["cyan", "magenta", "yellow", "blue", "green"] as const;

/**
 * Prefixes for the task at `index` of `names`, for stdout and stderr: the
 * name padded to the longest one, so the output lines up, then `| `. The
 * name is colored when the stream shows colors (a terminal, no `NO_COLOR`).
 */
export function taskPrefixes(
  names: readonly string[],
  index: number,
): { stdout: string; stderr: string } {
  const width = Math.max(...names.map((name) => name.length));
  const name = (names[index] ?? "").padEnd(width);
  const color = COLORS[index % COLORS.length] ?? "cyan";
  const make = (stream: NodeJS.WriteStream) =>
    `${styleText(color, name, { stream })} | `;
  return { stdout: make(process.stdout), stderr: make(process.stderr) };
}

/**
 * Env for commands whose output Ward pipes: with `FORCE_COLOR=1` when Ward's
 * own stdout shows colors, since tools turn them off for a pipe. Left as is
 * when the user set `FORCE_COLOR` or `NO_COLOR`.
 */
export function colorEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.FORCE_COLOR !== undefined || env.NO_COLOR !== undefined) return env;
  if (!process.stdout.isTTY || !process.stdout.hasColors(env)) return env;
  return { ...env, FORCE_COLOR: "1" };
}
