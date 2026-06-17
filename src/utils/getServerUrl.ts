import { networkInterfaces } from "os";

let cachedUrl: string | null = null;

function detectLocalUrl(): string {
  // Allow override via env vars (for Beamup or other deployments)
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.BEAMUP_URL) return process.env.BEAMUP_URL;

  const port = process.env.PORT ? Number(process.env.PORT) : 52932;

  // Auto-detect non-loopback IP
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        // Prefer IPv4, skip loopback (127.0.0.1) and internal (docker etc.)
        if (net.family === "IPv4" && !net.internal) {
          return `http://${net.address}:${port}`;
        }
      }
    }
  } catch {
    // fallback
  }

  return `http://127.0.0.1:${port}`;
}

export function getServerUrl(hostHint?: string) {
  if (hostHint) return hostHint;
  if (!cachedUrl) cachedUrl = detectLocalUrl();
  return cachedUrl;
}
