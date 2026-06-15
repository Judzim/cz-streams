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
import { getAllResolvers } from "./src/utils/resolvers.ts";

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
    catalogs: [],
    resources: ["stream"],
    types: ["movie", "series"],
    name: "CZ Streams",
    description: "CZ/SK stream aggregator — vyhľadáva a streamuje filmy a seriály z Prehraj.to, HellSpy, SOSAC, WebShare a ďalších českých/slovenských zdrojov.",
    idPrefixes: ["tt"],
    logo: "https://play-lh.googleusercontent.com/qDMsLq4DWg_OHEX6YZvM1FRKnSmUhzYH-rYbWi4QBosX9xTDpO8hRUC-oPtNt6hoFX0=w256-h256-rw",
    behaviorHints: {
      configurable: true,
      configurationRequired: true,
    },
    config: userConfigDef,
  } satisfies Manifest;
}

const builder = new SDK.addonBuilder(getManifest());

builder.defineStreamHandler(async (props) => {
  const { type, id, config } = props as {
    type: ContentType;
    id: string;
    config: UserConfigData;
  };
  try {
    const [baseMeta, tmdbMeta] = await Promise.all([
      getMeta(type, id),
      getTmdbDetails(id, "cs"),
    ]);

    console.log(`Stream handler: type=${type}, id=${id}, baseMeta=${!!baseMeta}, tmdbMeta=${!!tmdbMeta}`);

    if (!baseMeta) {
      console.log(`Cinemeta has no data for ${type}/${id}, falling back to TMDB`);
      // If Cinemeta doesn't have it, build meta from TMDB data
      // getSearchTerms needs name, names, released, runtime
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
    // otherwise return no streams
    return { streams: [] };
  }
});

export const addonInterface = builder.getInterface();
