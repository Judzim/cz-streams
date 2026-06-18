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

        if (req.url && req.url.startsWith("/configure")) {
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
        console.error(`Error on request ${req.url}`, e);
      }
    });
  })
  .catch((err: Error) => {
    console.error("Failed to start server:", err);
  });
