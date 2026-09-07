// CZ Streams — Stremio addon pro české a slovenské zdroje streamování
//
// Copyright (C) 2025 Matej Suchon
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { readFileSync } from "fs";
import type { ContentType, Manifest } from "stremio-addon-sdk";
import SDK from "stremio-addon-sdk";

import { getTopItems } from "./src/getTopItems.ts";
import { getMeta } from "./src/meta.ts";
import { getTmdbDetails } from "./src/service/tmdb.ts";
import { applySortOrder, getItemQualityRank, getQualityLabel } from "./src/sort.ts";
import {
  type ConfigField,
  type UserConfigData,
} from "./src/userConfig/userConfig.ts";
import { bytesToSize } from "./src/utils/convert.ts";
import { getAllResolvers, getActiveResolvers } from "./src/utils/resolvers.ts";
import { getServerUrl } from "./src/utils/getServerUrl.ts";
import { get as cacheGet, set as cacheSet } from "./src/utils/cache.ts";

function getManifest() {
  const pkgData = readFileSync("./package.json", "utf8");
  const pkg = JSON.parse(pkgData);
  const allResolvers = getAllResolvers();
  const resolverConfigDefs = allResolvers.reduce(
    (defs, resolver) => [...defs, ...resolver.getConfigFields()],
    [] as ConfigField[],
  );

  const globalConfig: ConfigField[] = [
    {
      key: "sortOrder",
      type: "text" as const,
      title: "Zoradenie výsledkov (default/size/sizeAsc/quality)",
      default: "default",
    },
    {
      key: "disableGlobalSearch",
      type: "text" as const,
      title: "Skryť z globálneho vyhľadávania (true/false)",
      default: "false",
    },
  ];

  const config = [...resolverConfigDefs, ...globalConfig];

  return {
    id: "community.czstreams",
    version: pkg.version,
    catalogs: [
      {
        type: "movie" as const,
        id: "cz-streams-search",
        name: "CZ Streams",
        extra: [
          { name: "search", isRequired: true },
        ],
      },
    ],
    resources: ["stream", "catalog", "meta"],
    types: ["movie", "series"],
    name: "CZ Streams",
    description: "CZ/SK stream aggregator — vyhľadáva a streamuje filmy a seriály z Prehraj.to, HellSpy a WebShare.",
    idPrefixes: ["tt", "czs", "tmdb"],
    logo: "https://play-lh.googleusercontent.com/qDMsLq4DWg_OHEX6YZvM1FRKnSmUhzYH-rYbWi4QBosX9xTDpO8hRUC-oPtNt6hoFX0=w256-h256-rw",
    config: config as any,
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      configurationUrl: "/configure",
    },
  } satisfies Manifest;
}

const builder = new SDK.addonBuilder(getManifest());

// Internal stream shape used by the czs:search flow (extra fields stripped before output)
type SearchStream = {
  url: string;
  name: string;
  description: string;
  behaviorHints: { videoSize: number };
  _qualityScore?: number;
  _size?: number;
  _resolution?: number;
};

// --- Meta handler (for czs: prefixed catalog results) ---
builder.defineMetaHandler(async (props) => {
  const { type, id } = props as {
    type: ContentType;
    id: string;
  };

  try {
    if (id.startsWith("czs:search:") || id.startsWith("czs%3Asearch%3A") || decodeURIComponent(id).startsWith("czs:search:")) {
      const decodedId = id.startsWith("czs%3A") ? decodeURIComponent(id) : id;
      const rawQuery = decodedId.slice("czs:search:".length);
      const query = decodeURIComponent(rawQuery);

      return {
        meta: {
          id: id,
          type: type,
          name: "Filmy a seriály",
          poster: "https://prehraj.to/favicon.ico",
          background: "https://prehraj.to/favicon.ico",
          posterShape: "regular" as const,
          description: query ? `Hľadať: ${query}` : "Prehľadávať filmy a seriály",
        },
      };
    }

    if (id.startsWith("czs:") || id.startsWith("czs%3A") || decodeURIComponent(id).startsWith("czs:")) {
      const decodedId = id.startsWith("czs%3A") ? decodeURIComponent(id) : id;
      const parts = decodedId.split(":");
      const resolverName = parts[1] || "";
      // Extract a display name from the rest of the ID (URL-encoded path)
      const rawPath = parts.slice(2).join(":");
      const path = decodeURIComponent(rawPath);
      // Derive a human-readable name from the URL path
      const name = path
        .replace(/^\//, "")
        .split("/")[0]
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
        .replace(/https?:\/\/.*/, "")
        .trim() || `${resolverName} stream`;

      return {
        meta: {
          id: id,
          type: type,
          name: name,
          poster: "https://prehraj.to/favicon.ico",
          background: "https://prehraj.to/favicon.ico",
          posterShape: "regular" as const,
          description: `Stream from ${resolverName}`,
        },
      };
    }
  } catch (e) {
    console.error("Meta handler error:", e);
  }

  // For tt: IDs, proxy to Cinemeta
  return { meta: null };
});

// --- Catalog handler (single search item) ---
builder.defineCatalogHandler(async (props) => {
  const { type, extra, config } = props as {
    type: ContentType;
    id: string;
    extra: Record<string, string>;
    config: UserConfigData;
  };
  const search = extra?.search;
  if (!search || !search.trim()) {
    return { metas: [] };
  }

  // Check if global search results are disabled
  if (config?.disableGlobalSearch === "true") {
    console.log(`Catalog search disabled for global search, query="${search}"`);
    return { metas: [] };
  }

  console.log(`Catalog search: type=${type}, query="${search}"`);

  // Return a single item that acts as a search container
  return {
    metas: [{
      id: `czs:search:${encodeURIComponent(search.trim())}`,
      type: type,
      name: "Filmy a seriály",
      poster: "https://prehraj.to/favicon.ico",
      posterShape: "regular" as const,
      description: `🔍 ${search.trim()}`,
    }],
  };
});

// --- Stream handler (IMDb + czs: direct) ---
builder.defineStreamHandler(async (props) => {
  const { type, id, config } = props as {
    type: ContentType;
    id: string;
    config: UserConfigData;
  };

  try {
    // Handle czs:search: prefixed IDs (from single-item catalog search)
    if (id.startsWith("czs:search:") || id.startsWith("czs%3Asearch%3A") || decodeURIComponent(id).startsWith("czs:search:")) {
      const decodedId = id.startsWith("czs%3A") ? decodeURIComponent(id) : id;
      const rawQuery = decodedId.slice("czs:search:".length);
      const query = decodeURIComponent(rawQuery);

      if (!query.trim()) {
        return { streams: [] };
      }

      console.log(`Stream search: query="${query}"`);

      // Check cache first — include sortOrder in the key so switching sort order
      // doesn't return another order's cached list
      const cacheKey = `search:${query.trim().toLowerCase()}:${config?.sortOrder || "default"}`;
      const cached = cacheGet<any[]>(cacheKey);
      if (cached) {
        console.log(`Cache hit: ${cached.length} streams for "${query}"`);
        return { streams: cached };
      }

      const allResolvers = getAllResolvers();
      const activeResolvers = await getActiveResolvers(allResolvers, config || {});

      // Search all resolvers in parallel
      const searchPromises = activeResolvers.map(async (resolver) => {
        try {
          const results = await resolver.search(query, config || {});
          return { resolver, results };
        } catch (e) {
          console.error(`Resolver ${resolver.resolverName} search error:`, e);
          return { resolver, results: [] as any[] };
        }
      });

      const settled = await Promise.allSettled(searchPromises);
      const streams: SearchStream[] = [];

      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        const { resolver, results } = result.value;
        if (!results || results.length === 0) continue;

        // Optional enrichment (HellSpy real streamable resolution) before building streams
        const enriched = resolver.enrich
          ? await resolver.enrich(results, config || {})
          : results;

        // Per-resolver: pre-apply the user's sort + cap at 20, so one source
        // (e.g. HellSpy's 64 results) can't drown the others before the final sort
        const top = applySortOrder(
          enriched.map((r) => ({ ref: r, title: r.title, size: r.size || 0, resolution: r.resolution || 0 })),
          config?.sortOrder,
        ).slice(0, 20).map((o) => o.ref);

        for (const r of top) {
          const qualityRank = getItemQualityRank(r);
          const quality = getQualityLabel(qualityRank);
          const sizeStr = r.size ? bytesToSize(r.size) : "";

          streams.push({
            url: `${getServerUrl()}/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(r.resolverId)}?config=${encodeURIComponent(JSON.stringify(config || {}))}`,
            name: r.title,
            description: [resolver.resolverName, quality, sizeStr].filter(Boolean).join(" • "),
            behaviorHints: {
              videoSize: Math.round(r.size || 0),
            },
            // internal fields for sorting (stripped before output)
            _qualityScore: qualityRank,
            _size: r.size || 0,
            _resolution: r.resolution || 0,
          });
        }
      }

      // Sort ALL results by user config, then cap total (per-resolver pre-slice
      // would drop big/better files before size/quality sorting had a say)
      const sortedStreams = applySortOrder(
        streams.map((s) => ({ ref: s, title: s.name, size: s._size || 0, resolution: s._resolution || 0 })),
        config?.sortOrder,
      ).slice(0, 30).map((o) => o.ref);

      // Remove internal fields from output
      for (const s of sortedStreams) {
        delete s._qualityScore;
        delete s._size;
      }

      console.log(`Stream search: ${sortedStreams.length} streams for "${query}"`);

      // Cache results for 5 minutes (key is lowercased for better hit rate)
      cacheSet(cacheKey, sortedStreams);
      return { streams: sortedStreams };
    }

    // Handle czs: prefixed IDs (from old-style catalog results)
    // The ID may still be URL-encoded (%2F for / in the path)
    if (id.startsWith("czs:") || id.startsWith("czs%3A") || decodeURIComponent(id).startsWith("czs:")) {
      const decodedId = id.startsWith("czs%3A") ? decodeURIComponent(id) : id;
      const parts = decodedId.split(":");
      if (parts.length < 3) {
        console.error(`Invalid czs ID format: ${id}`);
        return { streams: [] };
      }
      const resolverName = parts[1];
      // resolverId may still contain URL-encoded chars (%2F etc.) — decode it
      const resolverId = decodeURIComponent(parts.slice(2, parts.length >= 5 ? parts.length - 2 : parts.length).join(":"));
      const quality = parts.length >= 5 ? parts[parts.length - 2] : "";
      const sizeBytes = parts.length >= 5 ? parseInt(parts[parts.length - 1]) || 0 : 0;
      console.log(`Stream handler czs: resolver=${resolverName}, id=${resolverId}`);

      const allResolvers = getAllResolvers();
      const resolver = allResolvers.find((r) => r.resolverName === resolverName);
      if (!resolver) {
        console.error(`Resolver not found: ${resolverName}`);
        return { streams: [] };
      }

      const detail = await resolver.resolve(resolverId, config || {});
      if (!detail.video) {
        return { streams: [] };
      }

      const nameParts = [resolverName];
      if (quality) nameParts.push(quality);
      if (sizeBytes > 0) nameParts.push(bytesToSize(sizeBytes));

      return {
        streams: [{
          url: detail.video,
          name: nameParts.join(", "),
          description: [detail.title || "", quality, sizeBytes > 0 ? bytesToSize(sizeBytes) : ""].filter(Boolean).join(" • "),
          subtitles: detail.subtitles ?? undefined,
          behaviorHints: {
            videoSize: Math.round(sizeBytes || detail.size || 0),
            ...(detail.behaviorHints ?? {}),
          },
        }],
      };
    }

    // Standard flow: use Cinemeta + TMDB to search all resolvers
    const [baseMeta, tmdbMeta] = await Promise.all([
      getMeta(type, id),
      getTmdbDetails(id, "cs"),
    ]);

    console.log(`Stream handler: type=${type}, id=${id}, baseMeta=${!!baseMeta}, tmdbMeta=${!!tmdbMeta}`);

    if (!baseMeta) {
      console.log(`Cinemeta has no data for ${type}/${id}, falling back to TMDB`);
      if (tmdbMeta) {
        const fallbackMeta = {
          id: id,
          type: type,
          name: tmdbMeta.title || tmdbMeta.name || "Unknown",
          names: tmdbMeta.names || { en: tmdbMeta.title || tmdbMeta.name || "Unknown" },
          released: tmdbMeta.release_date || tmdbMeta.first_air_date || "",
          runtime: "0",
          genres: [],
          poster: "",
          background: "",
          description: tmdbMeta.overview || "",
          imdb_id: id,
          popularity: 0,
          videos: [],
          trailers: [],
          links: [],
          behaviorHints: [],
          award: "",
          cast: [],
          country: "",
          director: [],
          writer: [],
          dvdRelease: "",
          logo: "",
          slug: id,
          releaseInfo: (tmdbMeta.release_date || tmdbMeta.first_air_date || "").split("-")[0] || "",
          year: (tmdbMeta.release_date || tmdbMeta.first_air_date || "").split("-")[0] || "",
          popularities: { moviedb: 0, stremio: 0, trakt: 0, stremio_lib: 0 },
          ...(type === "series" && id.includes(":")
            ? (() => {
                // IMDb: tt1234567:1:1 → [tt, 1, 1] (season=[1], ep=[2])
                // TMDB: tmdb:295879:1:1 → [tmdb, 295879, 1, 1] (season=[2], ep=[3])
                const parts = id.split(":");
                const hasPrefix = parts[0] !== "tt";
                const season = parseInt(parts[hasPrefix ? 2 : 1]);
                const number = parseInt(parts[hasPrefix ? 3 : 2]);
                if (isNaN(season) || isNaN(number)) return {};
                return {
                  episode: { season, number } as { season: number; number: number },
                };
              })()
            : {}),
        } as any;
        const allResolvers = getAllResolvers();
        const topItems = await getTopItems(fallbackMeta, allResolvers, config || {});
        const streams = topItems.map((item) => {
          const quality = getQualityLabel(getItemQualityRank(item));
          const sizePart = item.size > 0 ? `, (${bytesToSize(item.size)})` : "";
          return {
            url: item.video,
            name: `${item.resolverName}${sizePart}${quality ? ` • ${quality}` : ""}`,
            description: item.title,
            subtitles: item.subtitles ?? undefined,
            behaviorHints: {
              videoSize: Math.round(item.size || 0),
              bingeGroup: `${item.resolverName}-${item.resolverId}`,
              ...(item.behaviorHints ?? {}),
              filename: item.title,
            },
          };
        });
        return { streams };
      }
      console.error(`TMDB also has no data for ${id}`);
      return { streams: [] };
    }

    const meta = {
      ...baseMeta,
      names: {
        en: baseMeta.name || "Unknown",
        ...(tmdbMeta?.names || {}),
      },
    };

    const allResolvers = getAllResolvers();
    console.log(`Active resolvers: ${allResolvers.length}`);

    const topItems = await getTopItems(meta, allResolvers, config || {});

    const streams = topItems.map((item) => {
      const quality = getQualityLabel(getItemQualityRank(item));
      const sizePart = item.size > 0 ? `, (${bytesToSize(item.size)})` : "";
      return {
        url: item.video,
        name: `${item.resolverName}${sizePart}${quality ? ` • ${quality}` : ""}`,
        description: item.title,
        subtitles: item.subtitles ?? undefined,
        behaviorHints: {
          videoSize: Math.round(item.size || 0),
          bingeGroup: `${item.resolverName}-${item.resolverId}`,
          ...(item.behaviorHints ?? {}),
          filename: item.title,
        },
      };
    });
    return {
      streams,
    };
  } catch (e) {
    console.error(e);
    return { streams: [] };
  }
});

export const addonInterface = builder.getInterface();
