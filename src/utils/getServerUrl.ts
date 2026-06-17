export function getServerUrl(hostHint?: string) {
  // Allow override via env vars (for Beamup or other deployments)
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.BEAMUP_URL) return process.env.BEAMUP_URL;
  // Use the provided host hint, or fall back to localhost with the configured port
  if (hostHint) return hostHint;
  const port = process.env.PORT ? Number(process.env.PORT) : 52932;
  return `http://127.0.0.1:${port}`;
}
