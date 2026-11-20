import type { LineRange } from "../git/changes.ts";

/** Whether Ward runs in a GitHub Actions job. */
export function isGitHubActions(env: NodeJS.ProcessEnv): boolean {
  return env.GITHUB_ACTIONS === "true";
}

export type AnnotationProperties = {
  /** Path from the repo root, with `/` separators. */
  readonly file?: string;
  readonly lines?: LineRange;
  readonly title?: string;
};

/**
 * An `::error` workflow command: GitHub Actions shows it as an annotation on
 * the run and, with `file`, on that file's lines in the pull request.
 * Printed to stdout on a line of its own.
 */
export function errorAnnotation(
  message: string,
  { file, lines, title }: AnnotationProperties = {},
): string {
  const properties: string[] = [];
  if (file !== undefined) properties.push(`file=${escapeProperty(file)}`);
  if (lines !== undefined) {
    properties.push(`line=${String(lines.start)}`);
    if (lines.end !== lines.start) {
      properties.push(`endLine=${String(lines.end)}`);
    }
  }
  if (title !== undefined) properties.push(`title=${escapeProperty(title)}`);
  const head = properties.length > 0 ? ` ${properties.join(",")}` : "";
  return `::error${head}::${escapeData(message)}`;
}

/** The escapes of `@actions/core`, so the runner reads the text back as is. */
function escapeData(text: string): string {
  return text
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");
}
