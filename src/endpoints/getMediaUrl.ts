import { type Request, type Response } from "express";

import { type UserConfigData } from "../userConfig/userConfig.ts";
import { getActiveResolvers, getAllResolvers } from "../utils/resolvers.ts";

const NL = "\r\n\r\n";

/** Headers NOT to forward from the CDN response to the client */
const SKIP_HEADERS = new Set([
  "set-cookie",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "content-encoding",
]);

/**
 * In-memory cache for resolved CDN URLs.
 * Key: resolverName:mediaId → { url, expires }
 * Cache ensures seek requests within the same stream use the same
 * CDN URL, because some CDNs (streamuj.tv) return a new tokenized
 * URL on each resolve — seeking with a new token breaks playback.
 */
const URL_CACHE = new Map<string, { url: string; expires: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds — long enough for seek operations

function getCachedUrl(key: string): string | null {
  const entry = URL_CACHE.get(key);
  if (entry && Date.now() < entry.expires) return entry.url;
  URL_CACHE.delete(key);
  return null;
}

function setCachedUrl(key: string, url: string) {
  URL_CACHE.set(key, { url, expires: Date.now() + CACHE_TTL_MS });
  // Simple cleanup: if cache grows too large, clear old entries
  if (URL_CACHE.size > 100) {
    const now = Date.now();
    for (const [k, v] of URL_CACHE) {
      if (now > v.expires) URL_CACHE.delete(k);
    }
  }
}

async function getMediaUrl(
  resolver: string,
  id: string,
  config: UserConfigData,
): Promise<string> {
  const cacheKey = `${resolver}:${id}`;

  // Check cache first
  const cached = getCachedUrl(cacheKey);
  if (cached) {
    return cached;
  }

  // Resolve fresh
  const allResolvers = getAllResolvers();
  const activeResolvers = await getActiveResolvers(allResolvers, config);
  const selectedResolver = activeResolvers.find(
    (r) => r.resolverName === resolver,
  );
  if (!selectedResolver) {
    throw new Error("Resolver not found: " + resolver);
  }
  const detail = await selectedResolver.resolve(id, config);
  const videoUrl = detail.video;

  // Cache the result for subsequent seek requests
  if (videoUrl) {
    setCachedUrl(cacheKey, videoUrl);
  }

  return videoUrl;
}

export default async function handler(req: Request, res: Response) {
  try {
    const url = new URL(req.protocol + "://" + req.hostname + req.url);
    const configJSON = url.searchParams.get("config");
    const config = configJSON ? JSON.parse(configJSON) : {};
    const pathParts = url.pathname.split("/");
    const resolverName = decodeURIComponent(pathParts[2]);
    const mediaId = decodeURIComponent(pathParts[3]);

    // Attempt to get cached URL early (before awaiting resolve)
    // so seek requests skip the resolve altogether
    const cacheKey = `${resolverName}:${mediaId}`;
    let mediaUrl = getCachedUrl(cacheKey);

    if (!mediaUrl) {
      mediaUrl = await getMediaUrl(resolverName, mediaId, config);
    }

    if (!mediaUrl) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No video URL resolved for " + mediaId);
      return;
    }

    // Fetch from CDN with browser-like headers
    const fetchHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      Accept: "*/*",
      "Accept-Language": "en-GB,en;q=0.9,cs;q=0.8,sk;q=0.7",
    };

    // Forward Range header for seeking support in ExoPlayer.
    // HellSpy, PrehrajTo, WebShare: forward Range normally.
    if (req.headers.range) {
      fetchHeaders["Range"] = req.headers.range as string;
    }

    const cdnResp = await fetch(mediaUrl, { method: "GET", headers: fetchHeaders });

    // Build response headers (forward CDN headers, skip internal ones)
    const respHeaders: Record<string, string> = {};
    for (const [key, value] of cdnResp.headers) {
      if (!SKIP_HEADERS.has(key.toLowerCase())) {
        respHeaders[key] = value;
      }
    }

    // Ensure CORS headers for cross-origin requests
    respHeaders["Access-Control-Allow-Origin"] = "*";
    respHeaders["Access-Control-Expose-Headers"] =
      "Content-Length, Content-Range, Accept-Ranges";

    res.writeHead(cdnResp.status, respHeaders);

    // Pipe CDN response body directly to the client
    const reader = cdnResp.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (e) {
    console.error("Media proxy error:", e);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.write((e instanceof Error ? e.message : String(e)) + NL);
    res.end();
  }
}
