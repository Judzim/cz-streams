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

function getManifest() {
  const pkgData = readFileSync("./package.json", "utf8");
  const pkg = JSON.parse(pkgData);
  const allResolvers = getAllResolvers();
  const userConfigDef = allResolvers.reduce(
    (defs, resolver) => [...defs, ...resolver.getConfigFields()],
    [] as ConfigField[],
  );

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
      {
        type: "series" as const,
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
    behaviorHints: {
      configurable: true,
      configurationRequired: true,
    },
    config: userConfigDef,
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

// --- Catalog handler (search mode) ---
builder.defineCatalogHandler(async (props) => {
  const { type, id, extra, config } = props as {
    type: ContentType;
    id: string;
    extra: Record<string, string>;
    config: UserConfigData;
  };
  const search = extra?.search;
  if (!search || !search.trim()) {
    return { metas: [] };
  }

  try {
    console.log(`Catalog search: type=${type}, query="${search}"`);
    const allResolvers = getAllResolvers();
    const activeResolvers = await getActiveResolvers(allResolvers, config || {});

    // Search all active resolvers in parallel
    const searchPromises = activeResolvers.map(async (resolver) => {
      try {
        const results = await resolver.search(search, config || {});
        return { resolver, results };
      } catch (e) {
        console.error(`Resolver ${resolver.resolverName} search error:`, e);
        return { resolver, results: [] as any[] };
      }
    });

    const settled = await Promise.allSettled(searchPromises);
    const metas: any[] = [];

    for (const result of settled) {
      if (result.status !== "fulfilled") continue;
      const { resolver, results } = result.value;
      if (!results || results.length === 0) continue;

      // Limit per resolver to avoid overwhelming Stremio
      const top = results.slice(0, 20);

      for (const r of top) {
        metas.push({
          id: `czs:${resolver.resolverName}:${encodeURIComponent(r.resolverId)}`,
          type: type,
          name: r.title,
          poster: r.detailPageUrl
            ? `https://prehraj.to/favicon.ico`
            : "https://prehraj.to/favicon.ico",
          posterShape: "regular" as const,
          description: r.size ? `${bytesToSize(r.size)}` : "",
        });
      }
    }

    console.log(`Catalog search: ${metas.length} results for "${search}"`);
    return { metas };
  } catch (e) {
    console.error("Catalog handler error:", e);
    return { metas: [] };
  }
});

// --- Stream handler (IMDb + czs: direct) ---
builder.defineStreamHandler(async (props) => {
  const { type, id, config } = props as {
    type: ContentType;
    id: string;
    config: UserConfigData;
  };

  try {
    // Handle czs: prefixed IDs (from catalog search results)
    // Also check URL-encoded variant (czs%3A...)
    if (id.startsWith("czs:") || id.startsWith("czs%3A") || decodeURIComponent(id).startsWith("czs:")) {
      const decodedId = id.startsWith("czs%3A") ? decodeURIComponent(id) : id;
      const parts = decodedId.split(":");
      if (parts.length < 3) {
        console.error(`Invalid czs ID format: ${id}`);
        return { streams: [] };
      }
      const resolverName = parts[1];
      const resolverId = parts.slice(2).join(":"); // resolverId may contain colons
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

      return {
        streams: [{
          url: detail.video,
          name: `${resolverName}`,
          description: detail.title || "",
          subtitles: detail.subtitles ?? undefined,
          behaviorHints: {
            videoSize: detail.size || 0,
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
