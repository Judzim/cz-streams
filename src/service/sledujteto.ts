import type { Resolver, SearchResult, StreamDetails } from "../getTopItems.ts";
import { sizeToBytes, timeToSeconds } from "../utils/convert.ts";
import { extractCookies, headerCookies } from "../utils/cookies.ts";
import commonHeaders, { type FetchOptions } from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  accept: "application/json",
  referer: "https://www.sledujteto.cz/",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/**
 * Sledujte.to was rewritten to use a new Vue-based frontend.
 *
 * Search: GET /api/web/videos?search={query} → JSON with file list
 * Stream: POST {mirror}/services/add-file-link → {hash, link_id}
 *         Video URL: {mirror}/player/index/sledujteto/{hash} (with Range header)
 * Keepalive: POST /services/add-file-play every 30s (for premium enforcement)
 *            But the video URL itself works without keepalive!
 *
 * The mirror is typically data10.sledujteto.cz or similar CDN subdomain.
 * The hash is deterministic per file ID.
 */

interface ApiFile {
  id: number;
  name: string;
  filename: string;
  filesize: string;
  full_url: string;
  movie_duration: string;
  movie_resolution: string;
  movie_codec?: string;
  duration: string;
  is_premium: boolean;
  is_playback_enabled?: boolean;
}

const MIRROR_CACHE = new Map<number, string>();

/**
 * Discover the CDN mirror for a file by fetching its detail page
 * and extracting the `init()` call which contains the mirror URL.
 */
async function discoverMirror(fileId: number): Promise<string> {
  if (MIRROR_CACHE.has(fileId)) return MIRROR_CACHE.get(fileId)!;

  try {
    const resp = await fetch(
      `https://www.sledujteto.cz/file/${fileId}/`,
      {
        headers: {
          ...headers,
          accept: "text/html",
        },
        method: "GET",
      },
    );
    const html = await resp.text();

    // Extract mirror from ng-init: init(file_id, file_url, dl_url, mirror)
    const initMatch = html.match(
      /init\(\d+,\s*'([^']+)',\s*'[^']+',\s*'([^']+)'\)/,
    );
    if (initMatch) {
      const mirror = initMatch[2];
      MIRROR_CACHE.set(fileId, mirror);
      return mirror;
    }
  } catch {
    // fallback
  }

  const DEFAULT = "https://data10.sledujteto.cz";
  MIRROR_CACHE.set(fileId, DEFAULT);
  return DEFAULT;
}

async function getSearchResults(
  title: string,
): Promise<SearchResult[]> {
  const resp = await fetch(
    `https://www.sledujteto.cz/api/web/videos?search=${encodeURIComponent(title)}`,
    {
      headers,
      method: "GET",
    },
  );
  if (!resp.ok) return [];

  const data = (await resp.json()) as {
    status: string;
    data: { files: ApiFile[] };
  };
  if (data.status !== "success" || !data.data?.files) return [];

  return data.data.files
    .filter((f) => !f.is_premium) // skip premium-only files
    .map((file) => ({
      resolverId: String(file.id),
      title: file.name || file.filename || "Unknown",
      detailPageUrl: file.full_url || "",
      duration: timeToSeconds(file.movie_duration || file.duration || "0:00"),
      format: file.movie_resolution || "",
      size: sizeToBytes(file.filesize || "0"),
    }));
}

async function getResultStreamUrls(
  resolverId: string,
): Promise<StreamDetails> {
  const fileId = parseInt(resolverId, 10);
  if (isNaN(fileId)) return { video: "" };

  const mirror = await discoverMirror(fileId);

  // Get streaming hash
  const linkResp = await fetch(`${mirror}/services/add-file-link`, {
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify({ params: { id: fileId } }),
    method: "POST",
  });
  if (!linkResp.ok) return { video: "" };

  const linkData = (await linkResp.json()) as {
    hash?: string;
    video_url?: string;
    link_id?: number;
    is_playback_enabled?: boolean;
    subtitles?: Array<{ file: string; label: string; srclang: string }>;
  };
  if (!linkData.hash) return { video: "" };

  // Skip files where playback is explicitly disabled
  if (linkData.is_playback_enabled === false) {
    console.log(`SledujteTo: file ${fileId} playback disabled, skipping`);
    return { video: "" };
  }

  // Use video_url from add-file-link, or build from hash
  const video = linkData.video_url || `${mirror}/player/index/sledujteto/${linkData.hash}`;

  // Extract subtitles
  const subtitles: { id: string; url: string; lang: string }[] = [];
  if (linkData.subtitles && Array.isArray(linkData.subtitles)) {
    for (const sub of linkData.subtitles) {
      if (sub.file) {
        subtitles.push({
          id: sub.label || sub.srclang || "sub",
          url: sub.file,
          lang: sub.srclang || "",
        });
      }
    }
  }

  return {
    video,
    subtitles,
    behaviorHints: {
      // The video works with Range requests but the keepalive (add-file-play)
      // runs every 30s to enforce free play time limits
      notWebReady: true,
    } as any,
  };
}

export function getResolver(): Resolver {
  return {
    resolverName: "SledujteTo",

    init: () => true,

    getConfigFields: () => [],

    validateConfig: async () => {
      // Works without login for free content
      // Premium files are filtered out in search
      return true;
    },

    search: async (title) => {
      try {
        return await getSearchResults(title);
      } catch (e) {
        console.error("SledujteTo search error:", e);
        return [];
      }
    },

    resolve: async (resolverId) => {
      try {
        return await getResultStreamUrls(resolverId);
      } catch (e) {
        console.error("SledujteTo resolve error:", e);
        return { video: "" };
      }
    },
  };
}
