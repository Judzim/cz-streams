import { getResolver as getHellspyResolver } from "./service/hellspy.ts";
import { getResolver as getPrehrajtoResolver } from "./service/prehrajto.ts";
import { getResolver as getSosacResolver } from "./service/sosac.ts";
import { getResolver as getWebshareResolver } from "./service/webshare.ts";

/** @typedef {import('./getTopItems.js').Resolver} Resolver */

export function initResolvers() {
  /** @type {Resolver[]} */
  const resolvers = [
    // Hellspy: public JSON API (api.hellspy.to), no login needed
    getHellspyResolver(),

    // Prehraj.to: main resolver, supports premium login for higher quality
    getPrehrajtoResolver(),

    // Sosac: tv.sosac.to JSON search + streamuj.tv CDN
    getSosacResolver(),

    // WebShare: requires login (configurable via Stremio UI)
    getWebshareResolver(),
  ];

  const activeResolvers = resolvers
    .map((resolver) => ({
      resolver,
      initialized: resolver.init(),
    }))
    .map((r) => (r.initialized ? r.resolver : null))
    .filter((r) => Boolean(r));
  return activeResolvers;
}
