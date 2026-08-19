import { ExternalId, MovieDb } from "moviedb-promise";
import { Cache } from "../utils/cache.ts";

const tmdbCache = new Cache<any>(60 * 60 * 1000); // 1 hour TTL

/**
 * Strip season/episode suffix from an ID.
 * "tt1234567:1:1" → "tt1234567", "tmdb:295879:1:1" → "tmdb:295879",
 * "tvdb:466037:1:1" → "tvdb:466037", "tt1234567" → "tt1234567"
 */
function stripSeriesSuffix(id: string): string {
  // Pre tmdb:/tvdb: prefixy odrežeme len sezónu/epizódu (:1:1), nie celý prefix
  const tmdbMatch = id.match(/^(tmdb:\d+)(?::\d+)*/);
  if (tmdbMatch) return tmdbMatch[1];
  const tvdbMatch = id.match(/^(tvdb[-: ]?\d+)(?::\d+)*/);
  if (tvdbMatch) return tvdbMatch[1];
  return id.split(":")[0];
}

export async function getTmdbDetails<L extends string>(
  id: string,
  languageCode: L,
) {
  const cleanId = stripSeriesSuffix(id);
  const cacheKey = `${cleanId}:${languageCode}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached) return cached;

  try {
    const tmdb = new MovieDb("701719e8e565886203b9a0abbf01a11c");

    // Priamy TMDB ID formát (tmdb:295879) — z AioMetadata/TVDB addonov.
    // Voláme /tv/{id} alebo /movie/{id} priamo, nie find podľa IMDb.
    const tmdbDirectMatch = cleanId.match(/^tmdb:(\d+)$/);
    if (tmdbDirectMatch) {
      const tmdbId = Number(tmdbDirectMatch[1]);
      const isSeries = id.includes(":") || cleanId.startsWith("tmdb:");
      let result: any;
      if (id.split(":")[0] === cleanId && !id.includes(":")) {
        // movie type (bez sezón) — skúsime movie aj tv
        result = (await tmdb.movieInfo({ id: tmdbId, language: languageCode })) as any;
        if (!result?.title) {
          result = (await tmdb.tvInfo({ id: tmdbId, language: languageCode })) as any;
        }
      } else {
        result = (await tmdb.tvInfo({ id: tmdbId, language: languageCode })) as any;
      }
      if (!result?.id) return undefined;

      const finalResult = {
        ...result,
        names: {
          [languageCode]: result.title || result.name,
          ...(result.original_title || result.original_name
            ? {
                [result.original_language || "en"]:
                  result.original_title || result.original_name,
              }
            : {}),
        } as Record<L, string> & Record<string, string>,
      };
      tmdbCache.set(cacheKey, finalResult);
      return finalResult;
    }

    const data = await tmdb.find({
      external_source: ExternalId.ImdbId,
      id: cleanId,
      language: languageCode,
    });

    const result = data.movie_results.at(0);
    if (!result) {
      const tvResult = data.tv_results?.at(0);
      if (tvResult) {
        // Handle TV series
        const result2 = {
          ...tvResult,
          names: {
            [languageCode]: tvResult.name,
            ...(tvResult.original_name && tvResult.original_language
              ? { [tvResult.original_language]: tvResult.original_name }
              : {}),
          } as Record<L, string> & Record<string, string>,
        };
        tmdbCache.set(cacheKey, result2);
        return result2;
      }
      return undefined;
    }

    const title = result.title;
    const origTitle = result.original_title;
    const origLng = result.original_language;
    const hasOriginalTitle = Boolean(origTitle && origLng);

    const finalResult = {
      ...result,
      names: {
        [languageCode]: title,
        ...(hasOriginalTitle
          ? {
              [origLng]: origTitle,
            }
          : {}),
      } as Record<L, string> & Record<string, string>,
    };

    tmdbCache.set(cacheKey, finalResult);
    return finalResult;
  } catch {
    return undefined;
  }
}
