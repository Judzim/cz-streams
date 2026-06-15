import { ExternalId, MovieDb } from "moviedb-promise";
import { Cache } from "../utils/cache.ts";

const tmdbCache = new Cache<any>(60 * 60 * 1000); // 1 hour TTL

export async function getTmdbDetails<L extends string>(
  id: string,
  languageCode: L,
) {
  const cacheKey = `${id}:${languageCode}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached) return cached;

  try {
    const tmdb = new MovieDb("701719e8e565886203b9a0abbf01a11c");

    const data = await tmdb.find({
      external_source: ExternalId.ImdbId,
      id,
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
