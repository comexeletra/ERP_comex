/**
 * Keep unexpected API failures diagnosable without serializing the full error
 * object, which can contain SQL text, parameters, or other request data.
 */
export function apiErrorDetails(error: unknown): {
  errorName: string;
  errorMessage: string;
  errorStack?: string;
} {
  if (!(error instanceof Error)) {
    return { errorName: typeof error, errorMessage: "Non-Error value thrown" };
  }

  const stackFrames = error.stack?.split("\n").slice(1, 8).join("\n");
  return {
    errorName: error.name.slice(0, 80),
    errorMessage: error.message.slice(0, 500),
    ...(stackFrames ? { errorStack: stackFrames } : {}),
  };
}
