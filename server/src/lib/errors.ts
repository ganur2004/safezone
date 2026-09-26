/** Errors that are safe to show to the user (never contain keys or URLs with keys). */
export class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

export class SourceUnavailableError extends Error {
  override readonly name = "SourceUnavailableError";
  /** false for configuration problems, where retrying cannot help. */
  readonly retryable: boolean;

  constructor(
    readonly sourceName: string,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options);
    this.retryable = options?.retryable ?? true;
  }
}
