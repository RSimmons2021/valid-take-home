import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeAll, describe, expect, it } from "vitest";
import { buildMetro } from "../src/data/metro";
import type { IndexFile, MetroFile } from "../src/data/types";
import { createCatchmentServer } from "./tools";

const index = JSON.parse(readFileSync("public/data/index.json", "utf8")) as IndexFile;
const sf = buildMetro(JSON.parse(readFileSync("public/data/sf-bay.json", "utf8")) as MetroFile);

let client: Client;
beforeAll(async () => {
  const server = createCatchmentServer({ index, loadMetro: async () => sf, appUrl: "https://catchment.test/" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const t = r.content[0].text;
  return { error: !!r.isError, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
};

describe("Catchment MCP server", () => {
  it("lists six read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["describe_factors", "design_lift_test", "explain_location", "export_targeting", "list_metros", "plan_targeting"],
    );
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("plans targeting with a link that reopens the same plan in the app", async () => {
    const r = await call("plan_targeting", { metro: "sf-bay", profile: "pet-care", pins: 4, radius_mi: 1.5 });
    expect(r.error).toBe(false);
    expect(r.json.pins).toHaveLength(4);
    expect(r.json.open_in_app).toMatch(/^https:\/\/catchment\.test\/#\/sf-bay\?p=pet-care&w=.*&n=4&r=1\.5&min=25$/);
  });

  it("accepts custom weights and rejects unknown factors with a useful message", async () => {
    expect((await call("plan_targeting", { metro: "sf-bay", weights: { homes: 1, families: 2 } })).error).toBe(false);
    const bad = await call("plan_targeting", { metro: "sf-bay", weights: { unicorns: 2 } });
    expect(bad.error).toBe(true);
    expect(bad.text).toMatch(/Unknown factor\(s\): unicorns/);
  });

  it("explains a location in plain terms", async () => {
    const r = await call("explain_location", { metro: "sf-bay", lat: 37.7502, lon: -122.4337, profile: "pet-care" });
    expect(r.json.verdict).toMatch(/fit|Mixed/);
    expect(r.json.why.length).toBeGreaterThan(0);
  });

  it("exports ZIPs and Google radius lines", async () => {
    const zips = await call("export_targeting", { metro: "sf-bay", profile: "pet-care", format: "zips" });
    expect(zips.text.split("\n").every((z) => /^\d{5}$/.test(z))).toBe(true);
    const radius = await call("export_targeting", { metro: "sf-bay", profile: "pet-care", format: "google_radius", pins: 2 });
    expect(radius.text.split("\n")).toHaveLength(2);
  });

  it("designs a lift test", async () => {
    const r = await call("design_lift_test", { metro: "sf-bay", profile: "pet-care", pins: 8 });
    expect(r.json.pairs.length).toBeGreaterThan(3);
    expect(["good", "fair", "weak"]).toContain(r.json.quality);
  });

  it("rejects an unknown metro", async () => {
    expect((await call("plan_targeting", { metro: "atlantis" })).text).toMatch(/Unknown metro/);
  });
});
