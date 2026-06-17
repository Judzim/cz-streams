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
  "content-encoding", // we let the client handle it
]);

async function getMediaUrl(
  resolver: string,
  id: string,
  config: UserConfigData,
): Promise<string> {
  const allResolvers = getAllResolvers();
  const activeResolvers = await getActiveResolvers(allResolvers, config);
  const selectedResolver = activeResolvers.find(
    (r) => r.resolverName === resolver,
  );
  if (!selectedResolver) {
    throw new Error("Resolver not found: " + resolver);
  }
  const detail = await selectedResolver.resolve(id, config);
  return detail.video;
}

export default async function handler(req: Request, res: Response) {
  try {
    const url = new URL(req.protocol + "://" + req.hostname + req.url);
    const configJSON = url.searchParams.get("config");
    const config = configJSON ? JSON.parse(configJSON) : {};
    const pathParts = url.pathname.split("/");
    const resolverName = decodeURIComponent(pathParts[2]);
    const mediaId = decodeURIComponent(pathParts[3]);

    const mediaUrl = await getMediaUrl(resolverName, mediaId, config);
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

    // Forward Range header for seeking support in ExoPlayer
    if (req.headers.range) {
      fetchHeaders["Range"] = req.headers.range as string;
      console.log(`Range request: ${req.headers.range} for ${resolverName}/${mediaId}`);
    }

    const cdnResp = await fetch(mediaUrl, { method: "GET", headers: fetchHeaders });

    // Build response headers (forward CDN headers, skip internal ones)
    const respHeaders: Record<string, string> = {};
    for (const [key, value] of cdnResp.headers) {
      if (!SKIP_HEADERS.has(key.toLowerCase())) {
        respHeaders[key] = value;
      }
    }
    // Explicit CORS headers
    respHeaders["Access-Control-Allow-Origin"] = "*";
    respHeaders["Access-Control-Expose-Headers"] = "Content-Length, Content-Range, Accept-Ranges";

    res.writeHead(cdnResp.status, respHeaders);

    // Pipe CDN response body to Stremio client
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
    // If headers already sent, we can't send an error response
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.write((e instanceof Error ? e.message : String(e)) + NL);
    res.end();
  }
}
