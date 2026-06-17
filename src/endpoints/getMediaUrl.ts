import { type Request, type Response } from "express";

import { type UserConfigData } from "../userConfig/userConfig.ts";
import { getActiveResolvers, getAllResolvers } from "../utils/resolvers.ts";

/**
 * In-memory cache for resolved CDN URLs.
 * Key: resolverName:mediaId → { url, expires }
 * Cache ensures seek requests within the same stream use the same
 * CDN URL, because some resolvers return a new tokenized URL on each
 * resolve — seeking with a new token breaks playback.
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

  // Check cache first (seek requests hit this path)
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

    // CORS headers so the browser/player trusts the initial response
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges",
    );

    // 301 redirect to CDN URL — video streamuje priamo z CDN, nie cez server.
    // CDN (premiumcdn.net, onecdn1.net, webshare.cz) podporujú CORS aj Range,
    // takže seek a prehrávanie fungujú priamo z CDN bez zaťaženia servera.
    res.writeHead(301, { Location: mediaUrl });
    res.end();
  } catch (e) {
    console.error("Media redirect error:", e);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.write((e instanceof Error ? e.message : String(e)) + "\r\n\r\n");
    res.end();
  }
}
