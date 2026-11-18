import { describe, expect, it } from "vitest";
import { PreviewStore, safeHash, sharePage } from "./share.ts";

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64")}`;

describe("link previews", () => {
  it("stores real PNGs and rejects anything else", () => {
    const s = new PreviewStore();
    const r = s.put(PNG);
    expect("id" in r && s.get(r.id)?.type).toBe("image/png");
    expect(s.put("data:image/png;base64,aGVsbG8=")).toEqual({ error: "That isn't a valid image." });
    expect(s.put("data:image/svg+xml;base64,PHN2Zz4=")).toEqual({ error: "Expected a PNG or JPEG data URL." });
    expect(s.put(42)).toEqual({ error: "Expected an image data URL." });
  });

  it("only accepts plan hashes our own encoder produces", () => {
    expect(safeHash("/sf-bay?p=pet-care&w=homes.1,pet_life.2&n=8&r=1.5&min=25")).not.toBe("");
    expect(safeHash('/x?p="><script>')).toBe("");
    expect(safeHash("javascript:alert(1)")).toBe("");
  });

  it("escapes titles and falls back to the default card", () => {
    const html = sharePage(new URLSearchParams({ h: "/sf-bay?p=pet-care&n=8", t: '<img src=x onerror=alert(1)> plan', img: "0".repeat(20) }), "https://c.test", () => false);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain('content="https://c.test/og.png"');
    expect(html).toContain('location.replace("/#/sf-bay?p=pet-care&n=8")');
  });

  it("uses the uploaded snapshot when it exists", () => {
    const html = sharePage(new URLSearchParams({ img: "a".repeat(20) }), "https://c.test", () => true);
    expect(html).toContain(`https://c.test/api/previews/${"a".repeat(20)}.png`);
  });
});
