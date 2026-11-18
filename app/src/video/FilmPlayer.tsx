import { useEffect, useRef, useState } from "react";
import { FILM, type FilmSpec, POSTER_T, drawFrame, filmFontsReady } from "./film";

/**
 * Plays a film live in a canvas: the same frames the export encodes, drawn on demand, so
 * a preview costs nothing. It rests on a poster frame (title and places showing) and plays
 * when asked; only the playing film animates, so a list of them stays light.
 */
export function FilmPlayer({ spec, label, playing, onPlayingChange }: { spec: FilmSpec; label: string; playing: boolean; onPlayingChange: (on: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ended, setEnded] = useState(false);

  // Poster: draw once fonts are in, so the title doesn't flash in a fallback face.
  useEffect(() => {
    let live = true;
    void filmFontsReady().then(() => {
      const c = ref.current?.getContext("2d");
      // after a play-through, rest on the close (who, where, the action) rather than jumping back
      if (live && c && !playing) drawFrame(c, ended ? FILM.seconds : POSTER_T, spec);
    });
    return () => {
      live = false;
    };
  }, [spec, playing, ended]);

  useEffect(() => {
    if (!playing) return;
    const c = ref.current?.getContext("2d");
    if (!c) return;
    setEnded(false);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      drawFrame(c, Math.min(t, FILM.seconds), spec);
      if (t < FILM.seconds) raf = requestAnimationFrame(tick);
      else {
        setEnded(true);
        onPlayingChange(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, spec, onPlayingChange]);

  return (
    <button
      type="button"
      className={`film${playing ? " film--playing" : ""}`}
      aria-label={`${playing ? "Pause" : ended ? "Replay" : "Play"} the video for ${label}`}
      aria-pressed={playing}
      onClick={() => onPlayingChange(!playing)}
    >
      <canvas ref={ref} width={FILM.width} height={FILM.height} />
      {!playing && (
        <span className="film__play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M8 5.5v13l10.5-6.5z" />
          </svg>
        </span>
      )}
    </button>
  );
}
