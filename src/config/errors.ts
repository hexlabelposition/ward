/** A problem with the user's config: shown as is, without a stack trace. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
