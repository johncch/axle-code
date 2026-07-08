import type { AgentErrorResult } from "@fifthrevision/axle";

type GenerateError = AgentErrorResult["error"];

// GenerateError is a discriminated union on `kind`; only some variants carry a
// top-level `message`, so a UI must narrow before displaying.
export function formatGenerateError(error: GenerateError): string {
  switch (error.kind) {
    case "model":
      return `model error: ${error.error.error.message}`;
    case "tool":
      return `tool error (${error.error.name}): ${error.error.message}`;
    case "parse":
      return `parse error: ${error.message}`;
    default: {
      const exhaustive: never = error;
      return String(exhaustive);
    }
  }
}
