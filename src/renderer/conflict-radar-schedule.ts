export const CONFLICT_RADAR_REFRESH_MS = 30_000;

/** One immediate check and a bounded interval while its caller is active. */
export function startConflictRadarRefresh(running: boolean, check: () => void): () => void {
  if (!running) return () => undefined;
  check();
  const timer = globalThis.setInterval(check, CONFLICT_RADAR_REFRESH_MS);
  return () => globalThis.clearInterval(timer);
}
