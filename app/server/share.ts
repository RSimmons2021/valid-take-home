import { createHash } from "node:crypto";
import { LruCache } from "./guards.ts";

/**
 * Link previews. A plan lives in the URL hash, which never reaches a server, so a pasted
 * link can't unfurl by itself. "Copy link" therefore produces /s?h=<plan>&t=<title>&d=<summary>
 * (&img=<id>), and this module answers it with Open Graph tags and an instant redirect into
 * the app. The optional image is a map snapshot the browser uploaded; previews are kept in
 * memory (a restart falls back to the default card, never to a broken image).
 */

export const PREVIEW_MAX_BYTES = 600 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

export class PreviewStore {
  private readonly images = new LruCache<{ bytes: Buffer; type: string }>(200);

  /** Validate and store an uploaded image. Returns its id, or an error message. */
  put(dataUrl: unknown): { id: string } | { error: string } {
    if (typeof dataUrl !== "string") return { error: "Expected an image data URL." };
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return { error: "Expected a PNG or JPEG data URL." };
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > PREVIEW_MAX_BYTES) return { error: "Preview image too large." };
    const magic = m[1] === "png" ? PNG_MAGIC : JPEG_MAGIC;
    if (!bytes.subarray(0, magic.length).equals(magic)) return { error: "That isn't a valid image." };
    const id = createHash("sha256").update(bytes).digest("hex").slice(0, 20);
    this.images.set(id, { bytes, type: `image/${m[1]}` });
    return { id };
  }

  get(id: string): { bytes: Buffer; type: string } | undefined {
    return /^[a-f0-9]{20}$/.test(id) ? this.images.get(id) : undefined;
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The hash part of an app URL: only the characters our own encoder produces. */
export function safeHash(h: string | null): string {
  if (!h || h.length > 600) return "";
  return /^\/[a-z0-9-]+\?[A-Za-z0-9=&.,_%-]*$/.test(h) ? h : "";
}

export function sharePage(params: URLSearchParams, origin: string, hasImage: (id: string) => boolean): string {
  const hash = safeHash(params.get("h"));
  const title = (params.get("t") ?? "").slice(0, 120) || "Catchment · geo-targeting plan";
  const description = (params.get("d") ?? "").slice(0, 240) || "Find the neighbourhoods worth paying for, from Overture Maps data.";
  const img = params.get("img") ?? "";
  const image = /^[a-f0-9]{20}$/.test(img) && hasImage(img) ? `${origin}/api/previews/${img}.png` : `${origin}/og.png`;
  const target = `/${hash ? `#${hash}` : ""}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Catchment">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${escapeHtml(origin + target)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
</head>
<body><script>location.replace(${JSON.stringify(target)})</script><a href="${escapeHtml(target)}">Open the plan</a></body>
</html>`;
}
