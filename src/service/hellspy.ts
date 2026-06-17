import type { Resolver, SearchResult, StreamDetails } from "../getTopItems.ts";
import { sizeToBytes } from "../utils/convert.ts";
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

  const best = resolutions[0];
  let videoUrl = data.conversions[String(best)];

  // Ensure full URL
  if (videoUrl.startsWith("//")) videoUrl = "https:" + videoUrl;

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
