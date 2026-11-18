/**
 * Catchment MCP server (stdio). Build with `npm run mcp:build`, then point an MCP client at
 * `node app/dist-mcp/catchment-mcp.js`. Reads the committed metro files; no network, no key.
 *
 * Environment:
 *   CATCHMENT_URL   where the app is hosted, for "open in app" links (default http://localhost:5173/)
 *   CATCHMENT_DATA  directory of metro files (default: app/public/data next to this build)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Metro, buildMetro } from "../src/data/metro";
import type { IndexFile, MetroFile } from "../src/data/types";
import { createCatchmentServer } from "./tools";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.CATCHMENT_DATA ?? path.resolve(here, "..", "public", "data");
const appUrl = process.env.CATCHMENT_URL ?? "http://localhost:5173/";

const cache = new Map<string, Promise<Metro>>();
const loadMetro = (id: string) => {
  let p = cache.get(id);
  if (!p) {
    p = readFile(path.join(dataDir, `${id}.json`), "utf8").then((t) => buildMetro(JSON.parse(t) as MetroFile));
    cache.set(id, p);
  }
  return p;
};

const index = JSON.parse(await readFile(path.join(dataDir, "index.json"), "utf8")) as IndexFile;
const server = createCatchmentServer({ index, loadMetro, appUrl });
await server.connect(new StdioServerTransport());
// stdout is the protocol channel; diagnostics go to stderr.
console.error(`catchment-mcp ready · ${index.metros.length} metros · data ${dataDir}`);
