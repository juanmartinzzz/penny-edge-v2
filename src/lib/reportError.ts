/**
 * Surface UI errors in the page banner and always mirror them to the console
 * so failures (including async job results) are easy to copy into bug reports.
 */

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

/**
 * Log + set the page error banner. Returns the message shown.
 */
export function reportUiError(
  setError: (message: string | null) => void,
  err: unknown,
  fallback: string,
  context?: string,
): string {
  const message = errorMessage(err, fallback);
  if (context) {
    console.error(`[${context}] ${message}`, err);
  } else {
    console.error(message, err);
  }
  setError(message);
  return message;
}

/** Log a finished async job that ended in error (may already be on the banner via lastRunError). */
export function logJobFailure(
  context: string,
  detail: {
    runId?: string;
    error?: string | null;
    [key: string]: unknown;
  },
): void {
  const message = detail.error?.trim() || "Job failed with no error message";
  console.error(`[${context}] ${message}`, detail);
}
