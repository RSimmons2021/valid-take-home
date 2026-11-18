import { FILM, type FilmSpec, drawFrame, filmFontsReady } from "./film";

export interface EncodedFilm {
  blob: Blob;
  ext: "mp4" | "webm";
}

/**
 * Encode a film to a file, in the browser, faster than real time: every frame is drawn
 * and handed to the platform's video encoder (WebCodecs) through Mediabunny. MP4 with
 * H.264 is what Meta and Google expect; where the browser can't encode H.264, it falls
 * back to VP9 in WebM. Mediabunny loads only here, so it costs nothing until a download.
 */
export async function encodeFilm(spec: FilmSpec, onProgress?: (share: number) => void): Promise<EncodedFilm> {
  const mb = await import("mediabunny");
  await filmFontsReady();
  const { width, height, fps, seconds } = FILM;
  const avc = await mb.canEncodeVideo("avc", { width, height });
  const codec = avc ? "avc" : (await mb.canEncodeVideo("vp9", { width, height })) ? "vp9" : null;
  if (!codec) throw new Error("This browser can't encode video. Try a recent Chrome, Edge or Safari.");
  const format = codec === "avc" ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat();
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format, target });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const source = new mb.CanvasSource(canvas, { codec, quality: mb.QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  const frames = fps * seconds;
  for (let i = 0; i < frames; i++) {
    drawFrame(ctx, i / fps, spec);
    await source.add(i / fps, 1 / fps);
    if (i % 10 === 0) onProgress?.(i / frames);
  }
  await output.finalize();
  onProgress?.(1);
  return { blob: new Blob([target.buffer!], { type: format.mimeType }), ext: codec === "avc" ? "mp4" : "webm" };
}
