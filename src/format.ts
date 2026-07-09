import type { AxleFailure } from "@fifthrevision/axle";

// As of Axle 0.26.1 every AxleFailure variant carries a uniform `.message`, so
// a UI can render the reason without narrowing. We keep the `kind` (and tool
// name) as a short prefix for context.
export function formatGenerateError(error: AxleFailure): string {
  const label = error.kind === "tool" ? `tool error (${error.error.name})` : `${error.kind} error`;
  return `${label}: ${error.message}`;
}
