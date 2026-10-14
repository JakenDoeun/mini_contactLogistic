// "Five wrong passwords in a row pause logins for a minute" (plan, Security). Counted per username as typed, so an
// unknown username is paused the same way and does not reveal whether the account exists.
// shortcut: counters live in this server process's memory and reset on restart; enough for the one web process. Move
// them to the database if a second web process is ever added.
export const FAILURES_BEFORE_PAUSE = 5;
export const PAUSE_MS = 60_000;
const MAX_KEYS = 10_000;

const attempts = new Map<string, { failures: number; pausedUntil: number }>();

/** Seconds left in a pause for this key, or 0. */
export function pausedFor(key: string, now: number): number {
  const a = attempts.get(key);
  return a && a.pausedUntil > now ? Math.ceil((a.pausedUntil - now) / 1000) : 0;
}

/** Records a failure; returns the pause in seconds if this failure started one, else 0. */
export function recordFailure(key: string, now: number): number {
  if (attempts.size >= MAX_KEYS && !attempts.has(key)) attempts.clear();
  const a = attempts.get(key) ?? { failures: 0, pausedUntil: 0 };
  a.failures += 1;
  if (a.failures >= FAILURES_BEFORE_PAUSE) {
    a.failures = 0;
    a.pausedUntil = now + PAUSE_MS;
  }
  attempts.set(key, a);
  return a.pausedUntil > now ? Math.ceil(PAUSE_MS / 1000) : 0;
}

export const clearFailures = (key: string) => attempts.delete(key);
export const resetAllPauses = () => attempts.clear();
