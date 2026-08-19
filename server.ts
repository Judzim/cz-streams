#!/usr/bin/env node

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  // Don't exit — keep server running
});

import { type Express, type Request, type Response } from "express";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import SDK from "stremio-addon-sdk";

import { addonInterface } from "./addon.ts";
import cleanupHandler from "./src/endpoints/cleanup.ts";
import configureHandler from "./src/endpoints/configure.ts";
import mediaHandler from "./src/endpoints/getMediaUrl.ts";
import testHandler from "./src/endpoints/test.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

let koFiLogoCache: Buffer | null = null;
function getKoFiLogo(): Buffer {
  if (!koFiLogoCache) {
    koFiLogoCache = readFileSync(join(__dirname, "ko-fi-logo.jpg"));
  }
  return koFiLogoCache;
}

(
  SDK.serveHTTP(addonInterface, {
    port: process.env.PORT ? Number(process.env.PORT) : 52932,
  }) as any as Promise<{ server: Express; url: string }>
)
  .then(({ server }) => {
    // grab SDK's existing 'request' listeners
    const originalListeners = server.listeners("request").slice();

    // remove them and install a wrapper that handles custom routes first
    server.removeAllListeners("request");
    server.on("request", async (req: Request, res: Response) => {
      try {
        // Ko-fi logo (static file)
        if (req.url === "/ko-fi-logo.jpg") {
          res.writeHead(200, { "Content-Type": "image/jpeg" });
          res.end(getKoFiLogo());
          return;
        }

        // Manifest — vlastný handler: SDK by pri config v URL vymazal
        // behaviorHints.configurable (config button by zmizol zo Stremia).
        // My ho vraciame VŽDY, aby config button ostal viditeľný (ako TorrentSK).
        if (req.url && req.url.endsWith("/manifest.json")) {
          const manifest = JSON.parse(JSON.stringify(addonInterface.manifest));
          manifest.behaviorHints = {
            ...manifest.behaviorHints,
            configurable: true,
          };
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify(manifest));
          return;
        }

        // Konfiguračná stránka — musí chytiť aj /{config}/configure (Stremio
        // otvára configurationUrl relatívne k base URL addonu, ktorý môže mať
        // config prefix). Posledný segment cesty je "configure".
        const pathSegments = (req.url ?? "").split("?")[0].split("/").filter(Boolean);
        if (pathSegments.length > 0 && pathSegments[pathSegments.length - 1] === "configure") {
          configureHandler(req, res);
          return;
        }

        if (req.url && req.url.startsWith("/media/")) {
          mediaHandler(req, res);
          return;
        }

        if (req.url && req.url.startsWith("/test/")) {
          await testHandler(req, res);
          return;
        }

        if (req.url && req.url.startsWith("/clean/")) {
          await cleanupHandler(req, res);
          return;
        }

        // fallback to the original SDK listeners
        for (const l of originalListeners) {
          l.call(server, req, res);
        }
      } catch (e) {
        // Mask config v URL (obsahuje heslá userov — WebShare/PrehrajTo)
        let url = req.url ?? "";
        url = url.replace(/([?&]config=)[^&]+/, "$1***");
        console.error(`Error on request ${url}`, e);
      }
    });
  })
  .catch((err: Error) => {
    console.error("Failed to start server:", err);
  });
