import type { Resolver, SearchResult, StreamDetails } from "../getTopItems.ts";
import { sizeToBytes } from "../utils/convert.ts";
import commonHeaders from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  Referer: "https://sosac.tv/",
};

/** Item from tv.sosac.to/jsonsearchapi.php */
interface SosacSearchItem {
  /** Title in multiple languages, e.g. {"cs": "Matrix", "en": "The Matrix", "sk": "..."} */
  n: Record<string, string>;
  /** Video key used for streaming */
  l: string;
  /** Year */
  y?: string;
  /** Quality */
  q?: string;
  /** Image ID */
  i?: string;
}

async function getSearchResults(
  title: string,
): Promise<SearchResult[]> {
  // Search via the JSON API on the old domain
  const url = `http://tv.sosac.to/jsonsearchapi.php?q=${encodeURIComponent(title)}`;
  const resp = await fetch(url, {
    headers,
    method: "GET",
  });
  if (!resp.ok) return [];

  const items = (await resp.json()) as SosacSearchItem[];
  if (!Array.isArray(items)) return [];

  const results: SearchResult[] = [];

  for (const item of items) {
    if (!item.l) continue;
    // Use Czech title if available, fall back to English
    const displayName = item.n?.cs || item.n?.sk || item.n?.en || Object.values(item.n || {})[0] || "Unknown";
    const quality = item.q || "";

    results.push({
      resolverId: item.l, // video key
      title: `${displayName}${quality ? ` [${quality}]` : ""}${item.y ? ` (${item.y})` : ""}`,
      detailPageUrl: `https://sosac.tv/watch/${item.l}`,
      duration: 0, // not available from search API
      format: quality,
      size: 0, // not available from search API
    });
  }

  return results;
}

async function getStreamUrlFromStreamuj(videoKey: string): Promise<string> {
  // Try HD first, fall back to original
  for (const quality of ["hd", "original"]) {
    try {
      const apiUrl = `https://www.streamuj.tv/json_api.php?action=video-link&URL=https://www.streamuj.tv/video/${videoKey}?streamuj=${quality}`;
      const resp = await fetch(apiUrl, {
        headers: {
          ...headers,
          Referer: "https://www.streamuj.tv/",
        },
        method: "GET",
      });
      if (!resp.ok) continue;

      const data = (await resp.json()) as { result: number; URL?: string };
      if (data.result !== 1 || !data.URL) continue;

      // Follow the authorized URL to get the actual MP4
      const authResp = await fetch(data.URL, {
        headers: {
          ...headers,
          Referer: "https://www.streamuj.tv/",
        },
        method: "GET",
        redirect: "manual", // don't auto-follow, we want the body
      });

      // If it redirects, follow it
      if (authResp.status >= 300 && authResp.status < 400) {
        const location = authResp.headers.get("location");
        if (location) return location;
      }

      // Otherwise the body contains the video URL as plain text
      const body = await authResp.text();
      if (body && body.startsWith("http")) {
        return body.trim();
      }
    } catch {
      // try next quality
    }
  }

  return "";
}

async function getResultStreamUrls(
  resolverId: string,
): Promise<StreamDetails> {
  // resolverId is the video key
  const videoKey = resolverId;
  if (!videoKey) return { video: "" };

  const video = await getStreamUrlFromStreamuj(videoKey);
  return { video, subtitles: [] };
}

/** Get file size from CDN via HEAD request (streamuj.tv doesn't include size in search API) */
async function getStreamSize(videoUrl: string): Promise<number> {
  try {
    const resp = await fetch(videoUrl, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    // Content-Range has: bytes start-end/total
    const cr = resp.headers.get("content-range");
    if (cr) {
      const total = cr.split("/")[1];
      if (total && !isNaN(Number(total))) return Number(total);
    }
    // Fallback to Content-Length
    const cl = resp.headers.get("content-length");
    if (cl) return Number(cl);
  } catch {
    // ignore
  }
  return 0;
}

export function getResolver(): Resolver {
  return {
    resolverName: "Sosac",

    init: () => true,

    getConfigFields: () => [],

    validateConfig: async () => true,

    search: async (title) => {
      try {
        return await getSearchResults(title);
      } catch (e) {
        console.error("Sosac search error:", e);
        return [];
      }
    },

    resolve: async (resolverId) => {
      try {
        const detail = await getResultStreamUrls(resolverId);
        // Try to get file size from CDN for display in stream list
        if (detail.video && !detail.size) {
          const size = await getStreamSize(detail.video);
          if (size > 0) detail.size = size;
        }
        return detail;
      } catch (e) {
        console.error("Sosac resolve error:", e);
        return { video: "" };
      }
    },
  };
}
