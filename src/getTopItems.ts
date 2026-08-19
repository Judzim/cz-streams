import type { Meta } from "./meta.ts";
import { computeScore } from "./score.ts";
import { applySortOrder } from "./sort.ts";
import type { ConfigField, UserConfigData } from "./userConfig/userConfig.ts";
import { cartesian } from "./utils/cartesian.ts";
import { deduplicateByProp } from "./utils/deduplicateByProp.ts";
import { getServerUrl } from "./utils/getServerUrl.ts";
import { getActiveResolvers } from "./utils/resolvers.ts";

export type SearchResult = {
  resolverId: string;
  title: string;
  detailPageUrl: string;
  duration: number;
  format?: string;
  size: number;
  /** Real streamable resolution (px height, e.g. 1080) — set by resolver.enrich when available */
  resolution?: number;
};

export type ScoredSearchResult = SearchResult & {
  resolverName: string;
  score: number;
};

export type StreamDetails = Partial<SearchResult> & {
  video: string;
  subtitles?: { id: string; url: string; lang: string }[];
  behaviorHints?: {
    countryWhitelist?: string[] | undefined;
    notWebReady?: boolean | undefined;
    group?: string | undefined;
    videoSize?: number | undefined;
    filename?: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    headers?: any;
  };
};

export type StreamResult = ScoredSearchResult & StreamDetails;

export type Resolver = {
  resolverName: string;
  init: () => boolean;
  getConfigFields: () => ConfigField[];
  validateConfig: (config: UserConfigData) => Promise<boolean>;
  search: (title: string, config: UserConfigData) => Promise<SearchResult[]>;
  /** Optional: enrich search results with extra metadata (e.g. real resolution) before sorting */
  enrich?: (results: SearchResult[], config: UserConfigData) => Promise<SearchResult[]>;
  resolve: (
    resolverId: string,
    config: UserConfigData,
  ) => Promise<StreamDetails>;
  cleanup?: () => Promise<void>;
  debug?: () => unknown;
};

export async function getTopItems(
  meta: Meta,
  allResolvers: Resolver[],
  config: UserConfigData,
): Promise<StreamResult[]> {
  const resolvers = await getActiveResolvers(allResolvers, config);
  const searchTerms = getSearchTerms(meta);

  const scoredSearchResultPromises = cartesian(resolvers, searchTerms).map(
    async ([resolver, searchTerm]) => {
      const searchResults = await resolver.search(searchTerm, config);
      const scoredSearchResults = searchResults
        .map((r) => ({
          resolverName: resolver.resolverName,
          score: computeScore(meta, r),
          ...r,
        }))
        .filter((r) => r.score > 0);

      scoredSearchResults.sort(compareScores);
      const topItems: ScoredSearchResult[] =
        scoredSearchResults.length > 30
          ? scoredSearchResults.slice(0, 30)
          : scoredSearchResults;

      // Optional per-resolver enrichment (e.g. HellSpy real resolution) before merge/sort
      if (resolver.enrich) {
        await resolver.enrich(topItems, config);
      }
      return topItems;
    },
  );

  const searchResults = deduplicateByProp(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await Promise.allSettled(scoredSearchResultPromises as Promise<any>[]))
      .map((r) => (r.status === "fulfilled" && r.value ? r.value : null))
      .filter((r) => Array.isArray(r))
      .flat(),
    "resolverId",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as any as ScoredSearchResult[];

  const results = searchResults.map(
    (searchResult: StreamResult): StreamResult => {
      const resolver = resolvers.find(
        (r) => searchResult.resolverName === r.resolverName,
      );
      if (!resolver) {
        return null;
      }
      const data = {
        video: `${getServerUrl()}/media/${encodeURIComponent(resolver.resolverName)}/${encodeURIComponent(searchResult.resolverId)}?config=${encodeURIComponent(JSON.stringify(config))}`,
        // ...(await resolver.resolve(searchResult.resolverId, config)),
      };
      return {
        ...searchResult,
        ...data,
      };
    },
  );
  results.sort(compareScores);

  // Apply user's sortOrder config (default/size/sizeAsc/quality) on top of relevance
  return applySortOrder(results, config?.sortOrder);
}

/**
 * @param {Meta} meta
 * @returns {string[]}
 */
function getSearchTerms(meta: Meta): string[] {
  /** @type {string[]} */
  const searches: string[] = [];

  if (meta.episode) {
    const eps = String(meta.episode.season).padStart(2, "0");
    const epn = String(meta.episode.number).padStart(2, "0");

    searches.push(
      ...Object.values(meta.names).flatMap((name) => [
        `${name} S${eps}E${epn}`,
        `${name} ${eps}x${epn}`,
      ]),
    );
  } else {
    const releaseYear = meta.released ? new Date(meta.released).getFullYear() : null;
    searches.push(
      ...Object.values(meta.names).flatMap((name: string) => {
        const terms = [name]; // always search by title alone
        if (releaseYear && !isNaN(releaseYear) && releaseYear > 1900) {
          terms.push(`${name} ${releaseYear}`);
        }
        return terms;
      }),
    );
  }
  return searches;
}

function compareScores(a: StreamResult, b: StreamResult) {
  return b.score - a.score;
}
