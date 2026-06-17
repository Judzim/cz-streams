import { readFileSync } from "fs";
import type { ContentType, Manifest } from "stremio-addon-sdk";
import SDK from "stremio-addon-sdk";

import { getTopItems } from "./src/getTopItems.ts";
import { getMeta } from "./src/meta.ts";
import { getTmdbDetails } from "./src/service/tmdb.ts";
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
      title: "Zoradenie výsledkov (default/size/quality)",
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
    description: "CZ/SK stream aggregator — vyhľadáva a streamuje filmy a seriály z Prehraj.to, HellSpy, SOSAC, WebShare a ďalších českých/slovenských zdrojov.",
    idPrefixes: ["tt", "czs"],
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

      // Check cache first
      const cacheKey = `search:${query.trim().toLowerCase()}`;
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
      const streams: any[] = [];

      for (const result of settled) {
        if (result.status !== "fulfilled") continue;
        const { resolver, results } = result.value;
        if (!results || results.length === 0) continue;

        // Limit per resolver
        const top = results.slice(0, 20);

        for (const r of top) {
          // Extract quality from title
          const t = r.title.toLowerCase();
          let quality = "";
          if (/2160p|4k|uhd|2160/.test(t)) quality = "4K";
          else if (/1440p|2k/.test(t)) quality = "2K";
          else if (/1080p|fullhd|1080/.test(t)) quality = "1080p";
          else if (/720p|\bhd\b/.test(t)) quality = "720p";
          else if (/480p/.test(t)) quality = "480p";

          const qualityScore = quality === "4K" ? 4 : quality === "2K" ? 3 : quality === "1080p" ? 2 : quality === "720p" ? 1 : 0;

          const sizeStr = r.size ? bytesToSize(r.size) : "";

          streams.push({
            url: `${getServerUrl()}/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(r.resolverId)}?config=${encodeURIComponent(JSON.stringify(config || {}))}`,
            name: r.title,
            description: [resolver.resolverName, quality, sizeStr].filter(Boolean).join(" • "),
            behaviorHints: {
              videoSize: r.size || 0,
            },
            _qualityScore: qualityScore,
          });
        }
      }

      // Sort streams based on user config
      const sortOrder = config?.sortOrder || "default";
      if (sortOrder === "size") {
        streams.sort((a: any, b: any) => (b.behaviorHints.videoSize || 0) - (a.behaviorHints.videoSize || 0));
      } else if (sortOrder === "quality") {
        streams.sort((a: any, b: any) => (b._qualityScore || 0) - (a._qualityScore || 0));
      }

      // Remove internal _qualityScore from output
      for (const s of streams) {
        delete s._qualityScore;
      }

      console.log(`Stream search: ${streams.length} streams for "${query}"`);

      // Cache results for 5 minutes (key is lowercased for better hit rate)
      cacheSet(cacheKey, streams);
      return { streams };
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
            videoSize: sizeBytes || detail.size || 0,
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
        } as any;
        const allResolvers = getAllResolvers();
        const topItems = await getTopItems(fallbackMeta, allResolvers, config || {});
        const streams = topItems.map((item) => ({
          url: item.video,
          name: `${item.resolverName}, (${bytesToSize(item.size)})`,
          description: item.title,
          subtitles: item.subtitles ?? undefined,
          behaviorHints: {
            videoSize: item.size,
            bingeGroup: `${item.resolverName}-${item.resolverId}`,
            ...(item.behaviorHints ?? {}),
            filename: item.title,
          },
        }));
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

    const streams = topItems.map((item) => ({
      url: item.video,
      name: `${item.resolverName}, (${bytesToSize(item.size)})`,
      description: item.title,
      subtitles: item.subtitles ?? undefined,
      behaviorHints: {
        videoSize: item.size,
        bingeGroup: `${item.resolverName}-${item.resolverId}`,
        ...(item.behaviorHints ?? {}),
        filename: item.title,
      },
    }));
    return {
      streams,
    };
  } catch (e) {
    console.error(e);
    return { streams: [] };
  }
});

export const addonInterface = builder.getInterface();
