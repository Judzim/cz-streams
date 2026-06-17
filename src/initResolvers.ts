import { getResolver as getFastshareResolver } from "./service/fastshare.ts";
import { getResolver as getHellspyResolver } from "./service/hellspy.ts";
import { getResolver as getPrehrajtoResolver } from "./service/prehrajto.ts";
import { getResolver as getSledujtetoResolver } from "./service/sledujteto.ts";
import { getResolver as getSosacResolver } from "./service/sosac.ts";
import { getResolver as getWebshareResolver } from "./service/webshare.ts";

/** @typedef {import('./getTopItems.js').Resolver} Resolver */

export function initResolvers() {
  /** @type {Resolver[]} */
  const resolvers = [
    // Fastshare: free streaming removed by the site, only premium download works
    // getFastshareResolver(),

    // Hellspy: rewritten to use api.hellspy.to (public JSON API)
    getHellspyResolver(),

    // Prehraj.to: main resolver, supports premium login
    getPrehrajtoResolver(),

    // SledujteTo: rewritten to use new Vue API (search + add-file-link)
    getSledujtetoResolver(),

    // Sosac: rewritten to use tv.sosac.to JSON API + streamuj.tv
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
