import type { Resolver, SearchResult, StreamDetails } from "../getTopItems.ts";
import commonHeaders from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  accept: "application/json",
  referer: "https://www.hellspy.to/",
};

const API_BASE = "https://api.hellspy.to/gw";

/** HellSpy search result item from /gw/search */
interface GWSearchVideo {
  id: number;
  title: string;
  fileHash: string;
  size: number;
  duration: number;
  /** e.g. "1920x1080" */
  resolution?: string;
}

/** HellSpy video detail from /gw/video/{id}/{hash} */
interface GWVideoDetail {
  id: number;
  fileHash: string;
  filename: string;
  size: number;
  /** Quality → URL map, e.g. { "720": "https://...mp4", "1080": "https://..." } */
  conversions: Record<string, string>;
  subtitles?: Array<{ language: string; link: string }>;
}

async function getSearchResults(
  title: string,
): Promise<SearchResult[]> {
  const url = `${API_BASE}/search?query=${encodeURIComponent(title)}&offset=0&limit=64`;
  const resp = await fetch(url, {
    headers,
    method: "GET",
  });
  if (!resp.ok) {
    console.error(`HellSpy search API error: ${resp.status}`);
    return [];
  }
  const data = (await resp.json()) as {
    items: GWSearchVideo[];
    nextOffset: number;
  };
  if (!data.items || !Array.isArray(data.items)) return [];

  return data.items.map((video) => ({
    resolverId: `${video.id}/${video.fileHash}`,
    title: video.title,
    detailPageUrl: `https://www.hellspy.to/video/${video.id}`,
    duration: video.duration || 0,
    format: video.resolution || "",
    size: video.size || 0,
  }));
}

// --- Resolution enrichment -------------------------------------------------
//
// The search API does NOT return resolution — but the detail endpoint does
// (conversions: quality → playback URL, capped at 1080p). We fetch details in
// parallel for the top results of a query and attach the real streamable
// resolution so quality sorting reflects what actually plays, not the
// (often overstated) title claim.

const ENRICH_MAX = 30;
const DETAIL_TTL_MS = 5 * 60 * 1000;

type DetailSummary = {
  bestRes: number;
  expiresAt: number;
};

const detailCache = new Map<string, DetailSummary>();

function getDetailSummary(videoId: string, fileHash: string): DetailSummary | null {
  const key = `${videoId}/${fileHash}`;
  const entry = detailCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    detailCache.delete(key);
    return null;
  }
  return entry;
}

async function fetchDetailSummary(videoId: string, fileHash: string): Promise<DetailSummary | null> {
  const cached = getDetailSummary(videoId, fileHash);
  if (cached) return cached;

  try {
    const resp = await fetch(`${API_BASE}/video/${videoId}/${fileHash}`, {
      headers,
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as GWVideoDetail;
    const resolutions = Object.keys(data.conversions || {})
      .map(Number)
      .filter((n) => !isNaN(n));
    const summary: DetailSummary = {
      bestRes: resolutions.length ? Math.max(...resolutions) : 0,
      expiresAt: Date.now() + DETAIL_TTL_MS,
    };
    detailCache.set(`${videoId}/${fileHash}`, summary);
    return summary;
  } catch {
    return null;
  }
}

/** Attach real streamable resolution to up to ENRICH_MAX results (parallel detail fetches). */
async function enrichResults(
  results: SearchResult[],
): Promise<SearchResult[]> {
  const targets = results.slice(0, ENRICH_MAX);
  await Promise.all(
    targets.map(async (r) => {
      const [videoId, fileHash] = r.resolverId.split("/");
      if (!videoId || !fileHash) return;
      const summary = await fetchDetailSummary(videoId, fileHash);
      if (summary?.bestRes) {
        r.resolution = summary.bestRes;
      }
    }),
  );
  return results;
}

async function getResultStreamUrls(
  resolverId: string,
): Promise<StreamDetails> {
  // resolverId format: "{videoId}/{fileHash}"
  const [videoId, fileHash] = resolverId.split("/");
  if (!videoId || !fileHash) {
    return { video: "" };
  }

  // Fetch video detail to get conversion URLs
  const url = `${API_BASE}/video/${videoId}/${fileHash}`;
  const resp = await fetch(url, {
    headers,
    method: "GET",
  });
  if (!resp.ok) {
    console.error(`HellSpy detail API error: ${resp.status}`);
    return { video: "" };
  }

  const data = (await resp.json()) as GWVideoDetail;
  if (!data.conversions || typeof data.conversions !== "object") {
    return { video: "" };
  }

  // Pick the best quality conversion
  // conversions keys are numeric strings like "360", "480", "720", "1080"
  const resolutions = Object.keys(data.conversions)
    .map(Number)
    .filter((n) => !isNaN(n))
    .sort((a, b) => b - a);

  if (resolutions.length === 0) {
    return { video: "" };
  }

  // Try qualities from best to worst, return first working one
  let videoUrl = "";
  for (const res of resolutions) {
    const candidate = data.conversions[String(res)];
    const fullUrl = candidate.startsWith("//") ? "https:" + candidate : candidate;

    try {
      const testResp = await fetch(fullUrl, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(3000),
      });
      if (testResp.ok && testResp.headers.get("content-type")?.includes("video")) {
        videoUrl = fullUrl;
        break;
      }
    } catch {
      // try next quality
    }
  }

  // Fallback: if no quality responded, use the best quality anyway
  if (!videoUrl) {
    const best = resolutions[0];
    videoUrl = data.conversions[String(best)];
    if (videoUrl.startsWith("//")) videoUrl = "https:" + videoUrl;
  }

  // Extract subtitles
  const subtitles: { id: string; url: string; lang: string }[] = [];
  if (data.subtitles && Array.isArray(data.subtitles)) {
    for (const sub of data.subtitles) {
      if (sub.link) {
        subtitles.push({
          id: sub.language || "sub",
          url: sub.link.startsWith("//") ? "https:" + sub.link : sub.link,
          lang: sub.language || "",
        });
      }
    }
  }

  return {
    video: videoUrl,
    subtitles,
    behaviorHints: {
      videoSize: data.size || 0,
    },
  };
}

export function getResolver(): Resolver {
  return {
    resolverName: "HellspyTo",

    init: () => true,

    getConfigFields: () => [],

    validateConfig: async () => true,

    search: async (title) => {
      try {
        return await getSearchResults(title);
      } catch (e) {
        console.error("HellSpy search error:", e);
        return [];
      }
    },

    enrich: async (results) => {
      try {
        return await enrichResults(results);
      } catch (e) {
        console.error("HellSpy enrich error:", e);
        return results;
      }
    },

    resolve: async (resolverId) => {
      try {
        return await getResultStreamUrls(resolverId);
      } catch (e) {
        console.error("HellSpy resolve error:", e);
        return { video: "" };
      }
    },
  };
}
