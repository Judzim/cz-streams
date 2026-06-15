import CryptoJS from "crypto-js";
import { parseHTML } from "linkedom";

import type { SearchResult, StreamDetails } from "../getTopItems.ts";
import type { Resolver } from "../getTopItems.ts";
import { sizeToBytes, timeToSeconds } from "../utils/convert.ts";
import commonHeaders, { type FetchOptions } from "../utils/headers.ts";

const headers = {
  ...commonHeaders,
  Referer: "https://sosac.tv/",
};

async function getSearchResults(title: string, fetchOptions: FetchOptions = {}) {
  const q = encodeURIComponent(title);
  const url = `https://sosac.tv/search/?q=${q}`;
  const res = await fetch(url, {
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    method: "GET",
    referrerPolicy: "strict-origin-when-cross-origin",
  });

  const html = await res.text();
  const { document } = parseHTML(html);

  const items = document.querySelectorAll(".video, .item, article, .search-result");
  const results: SearchResult[] = [...items]
    .map((el) => {
      const a = el.querySelector("a[href]") || el.querySelector("a.video-link");
      const path = a ? a.getAttribute("href") : null;
      const titleAttr = (a ? a.getAttribute("title") || a.textContent : null) || el.querySelector("h3")?.textContent || "";

      const durationStr = el.querySelector(".duration, .time")?.textContent?.trim() || "0:00";
      const sizeEl = el.querySelector(".size, .video-size");
      const sizeStr = (sizeEl && sizeEl.textContent && sizeEl.textContent.trim().toUpperCase()) || "";

      return {
        resolverId: path || "",
        title: titleAttr.trim(),
        detailPageUrl: path ? `https://sosac.tv${path}` : "",
        duration: timeToSeconds(durationStr),
        size: sizeStr ? sizeToBytes(sizeStr) : 0,
      } as SearchResult;
    })
    .filter((r) => r.resolverId);

  return results;
}

async function getResultStreamUrls(resolverId: string, fetchOptions: FetchOptions = {}): Promise<StreamDetails> {
  const detailPageUrl = resolverId.startsWith("http") ? resolverId : `https://sosac.tv${resolverId}`;
  const pageResponse = await fetch(detailPageUrl, {
    headers: {
      ...headers,
      ...(fetchOptions.headers ?? {}),
    },
    method: "GET",
    referrerPolicy: "strict-origin-when-cross-origin",
  });

  const pageHtml = await pageResponse.text();
  const { document } = parseHTML(pageHtml);

  let video = "";
  const subtitles: { id: string; url: string; lang: string }[] = [];

  // 1) Try <video> or <source> tags directly
  const videoEl = document.querySelector("video[src]") as Element | null;
  const sourceEl = document.querySelector("video source[src]") as Element | null;
  if (videoEl) {
    const src = videoEl.getAttribute("src") || videoEl.getAttribute("data-src");
    if (src) video = src;
  } else if (sourceEl) {
    const src = sourceEl.getAttribute("src") || sourceEl.getAttribute("data-src");
    if (src) video = src;
  }

  // 2) Look into scripts for sources/file/src patterns
  if (!video) {
    const scriptEls = document.querySelectorAll("script");
    const scripts = [...scriptEls].map((s) => s.textContent).filter(Boolean) as string[];

    for (const script of scripts) {
      try {
        // Try file: "https://..." pattern
        const fileMatch = /file\s*:\s*"((?:https?:)?\/\/[^"]+)"/s.exec(script);
        if (fileMatch && fileMatch[1]) {
          video = fileMatch[1];
          break;
        }
        // Try src: "https://..." pattern
        const srcMatch = /src\s*:\s*"((?:https?:)?\/\/[^"]+)"/s.exec(script);
        if (srcMatch && srcMatch[1]) {
          video = srcMatch[1];
          break;
        }
        // Try escaped patterns (e.g. file: "https:\\/\\/...")
        const escFileMatch = /file\s*:\s*"((?:https?:)?\\\/\\\/[^"]+)"/s.exec(script);
        if (escFileMatch) {
          video = escFileMatch[1].replace(/\\/g, "");
          break;
        }
        const escSrcMatch = /src\s*:\s*"((?:https?:)?\\\/\\\/[^"]+)"/s.exec(script);
        if (escSrcMatch) {
          video = escSrcMatch[1].replace(/\\/g, "");
          break;
        }
      } catch {
        // ignore script parse errors
      }
    }
  }

  // 3) Try encrypted payloads (Sosac uses AES obfuscation)
  if (!video) {
    const encMatch = pageHtml.match(/data-enc=["']([A-Za-z0-9+/=\n\r]+)["']/);
    if (encMatch) {
      try {
        const keyMatch = pageHtml.match(/data-key=["']([^"']+)["']/) || pageHtml.match(/var\s+key\s*=\s*'([^']+)'/);
        if (keyMatch) {
          const ct = encMatch[1];
          const key = keyMatch[1];
          const bytes = CryptoJS.AES.decrypt(ct, key);
          const decrypted = bytes.toString(CryptoJS.enc.Utf8);
          const urlMatch = decrypted && decrypted.match(/https?:\/\/[^\s'"\\]+/);
          if (urlMatch) video = urlMatch[0];
        }
      } catch {
        // ignore
      }
    }
  }

  // Subtitles from <track> elements
  const trackEls = document.querySelectorAll("track[src]");
  for (const t of trackEls) {
    const url = t.getAttribute("src") || "";
    subtitles.push({
      id: t.getAttribute("label") || t.getAttribute("srclang") || "sub",
      url,
      lang: t.getAttribute("srclang") || "",
    });
  }

  return { video, subtitles };
}

export function getResolver(): Resolver {
  return {
    resolverName: "Sosac",

    init: () => true,

    getConfigFields: () => [],

    validateConfig: async () => true,

    search: async (title, addonConfig) => {
      try {
        return await getSearchResults(title);
      } catch (e) {
        console.log("sosac search error", e);
        return [];
      }
    },

    resolve: async (resolverId, addonConfig) => {
      try {
        return await getResultStreamUrls(resolverId);
      } catch (e) {
        console.log("sosac resolve error", e);
        return { video: "" };
      }
    },
  };
}
