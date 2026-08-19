// Shared quality detection + result sorting for CZ Streams.
//
// What data do resolvers give us?
//   - title (string)      → quality keywords (4K/UHD/2160p, 1080p, 720p, ...)
//   - size (bytes)        → HellSpy API (exact), PrehrajTo tag, WebShare API
//   - duration (seconds)  → HellSpy + PrehrajTo only (WebShare: undefined)
//   - format              → unreliable: HellSpy "1920x1080" sometimes, PrehrajTo undefined, WebShare MIME
//   - score (internal)    → relevance from ./score.ts
//
// So the only trustworthy sort dimensions are: relevance (score), size, quality (from title).

export type SortableItem = {
  title: string;
  size?: number;
  score?: number;
  /** Real streamable resolution in px height (e.g. 1080) when known */
  resolution?: number;
};

export type SortOrder = "default" | "size" | "sizeAsc" | "quality";

/** Map a real resolution (px height) to a quality rank: 4K > 2K > 1080p > 720p > unknown */
export function resolutionToRank(res?: number): number {
  if (!res || res <= 0) return 0;
  if (res >= 2160) return 4;
  if (res >= 1440) return 3;
  if (res >= 1080) return 2;
  if (res >= 720) return 1;
  return 0;
}

/** 4K > 2K > 1080p > 720p > 480p > unknown (from title keywords) */
export function getQualityRank(title: string): number {
  const t = title.toLowerCase();
  if (/2160p|4k|uhd|2160/.test(t)) return 4;
  if (/1440p|2k/.test(t)) return 3;
  if (/1080p|fullhd|1080/.test(t)) return 2;
  if (/720p|\bhd\b/.test(t)) return 1;
  if (/480p/.test(t)) return 0;
  return 0;
}

/**
 * Rank for an item: real measured resolution wins, title keywords are the
 * fallback (title claims are known to overstate — e.g. "UHD" that streams 1080p).
 */
export function getItemQualityRank(item: { title: string; resolution?: number }): number {
  const real = resolutionToRank(item.resolution);
  return real > 0 ? real : getQualityRank(item.title);
}

export function getQualityLabel(rank: number): string {
  return rank === 4 ? "4K" : rank === 3 ? "2K" : rank === 2 ? "1080p" : rank === 1 ? "720p" : "";
}

/**
 * Sort a copy of `items` according to the user's `sortOrder` config:
 *   - "default"  → relevance score (desc); stable → preserves order when no score
 *   - "size"     → largest first
 *   - "sizeAsc"  → smallest first
 *   - "quality"  → best quality first, ties broken by size (larger first)
 */
export function applySortOrder<T extends SortableItem>(
  items: T[],
  sortOrder?: string,
): T[] {
  const order = (sortOrder || "default") as SortOrder;
  const sorted = [...items];

  switch (order) {
    case "size":
      sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
      break;
    case "sizeAsc":
      sorted.sort((a, b) => (a.size || 0) - (b.size || 0));
      break;
    case "quality":
      sorted.sort((a, b) => {
        const q = getItemQualityRank(b) - getItemQualityRank(a);
        return q !== 0 ? q : (b.size || 0) - (a.size || 0);
      });
      break;
    case "default":
    default:
      sorted.sort((a, b) => (b.score || 0) - (a.score || 0));
      break;
  }

  return sorted;
}
