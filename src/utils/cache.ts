// Simple in-memory TTL cache for search results
// Survives between requests, clears on server restart (acceptable for temporal search data)

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// --- Class API (used by tmdb.ts) ---
export class Cache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T): void {
    this.store.set(key, { data, expiresAt: Date.now() + this.ttlMs });
  }
}

// --- Singleton functions (used for search result caching) ---

const globalStore = new Map<string, CacheEntry<any>>();
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function get<T>(key: string): T | null {
  const entry = globalStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    globalStore.delete(key);
    return null;
  }
  return entry.data as T;
}

export function set<T>(key: string, data: T, ttlMs: number = DEFAULT_TTL_MS): void {
  globalStore.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function clear(): void {
  globalStore.clear();
}

/** Periodically evict expired entries to prevent unbounded growth */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
export function startCleanup(intervalMs: number = 60_000): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of globalStore) {
      if (now > entry.expiresAt) globalStore.delete(key);
    }
    // Prevent unbounded memory if cache grows unexpectedly
    if (globalStore.size > 5000) {
      const entries = [...globalStore].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toDelete = entries.slice(0, entries.length - 3000);
      for (const [key] of toDelete) globalStore.delete(key);
    }
  }, intervalMs);
}
