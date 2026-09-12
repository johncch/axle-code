/**
 * Restart protocol, shared by the TUI, the entrypoint, and the bin supervisor.
 *
 * A restart is "quit with intent": the app saves the autosave exactly as it
 * does on /exit, then asks Ink to exit with a sentinel value. The entrypoint
 * recognises the sentinel and exits with RESTART_EXIT_CODE, which the bin
 * supervisor treats as "respawn instead of returning to the shell" — so the
 * TTY never goes back to the shell mid-restart, and the fresh process resumes
 * the conversation through the normal autosave path.
 *
 * Restarts are blocked while a turn is running (the App refuses /restart and
 * /settings until the conversation is idle) — no queueing, no deferral.
 */

/** Exit code meaning "restart me" (EX_TEMPFAIL by convention). */
export const RESTART_EXIT_CODE = 75;

/** Value passed through Ink's `exit(value)` → `waitUntilExit()` to mark an
 * intentional restart, distinguishing it from a plain quit (`exit()`). */
export const RESTART_SENTINEL = "axle-code:restart";

export function isRestartRequest(value: unknown): boolean {
  return value === RESTART_SENTINEL;
}
