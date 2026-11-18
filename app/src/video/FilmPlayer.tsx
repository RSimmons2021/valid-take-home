import { useEffect, useRef, useState } from "react";
import { FILM, type FilmSpec, POSTER_T, drawFrame, filmFontsReady } from "./film";

/** Keep the kit on a still frame. Only the open preview draws continuously. */
export function FilmPlayer({ spec, label }: { spec: FilmSpec; label: string }) {
  const poster = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void filmFontsReady().then(() => {
      if (!live) return;
      const context = poster.current?.getContext("2d");
      if (context) drawFrame(context, POSTER_T, spec);
    });
    return () => {
      live = false;
    };
  }, [spec]);

  return (
    <>
      <button
        type="button"
        className="film"
        aria-label={`Enlarge video for ${label}`}
        aria-haspopup="dialog"
        data-tip="Play enlarged preview"
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        <canvas ref={poster} width={FILM.width} height={FILM.height} aria-hidden="true" />
        <span className="film__play" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M8 5.5v13l10.5-6.5z" />
          </svg>
        </span>
      </button>
      {open && <FilmPreview spec={spec} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

function FilmPreview({ spec, label, onClose }: { spec: FilmSpec; label: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef(0);
  const [playback, setPlayback] = useState<"playing" | "paused" | "ended">("playing");

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => {
    if (playback !== "playing") return;
    const context = canvas.current?.getContext("2d");
    if (!context) return;

    const start = performance.now() - playhead.current * 1000;
    let frame = requestAnimationFrame(function tick(now) {
      playhead.current = Math.min((now - start) / 1000, FILM.seconds);
      drawFrame(context, playhead.current, spec);
      if (playhead.current < FILM.seconds) frame = requestAnimationFrame(tick);
      else setPlayback("ended");
    });
    return () => cancelAnimationFrame(frame);
  }, [playback, spec]);

  const dismiss = () => {
    // Close before unmounting so the browser can restore focus to the thumbnail.
    dialog.current?.close();
    onClose();
  };

  const togglePlayback = () => {
    if (playback === "ended") playhead.current = 0;
    setPlayback(playback === "playing" ? "paused" : "playing");
  };

  return (
    <dialog
      ref={dialog}
      className="modal film-preview"
      aria-label={`Video preview for ${label}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
      onClose={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div className="film-preview__body">
        <header className="film-preview__header">
          <h3>{label}</h3>
          <button
            type="button"
            className="iconbtn"
            aria-label="Close video preview"
            data-tip="Close video preview"
            onClick={dismiss}
          >
            ×
          </button>
        </header>
        <canvas ref={canvas} width={FILM.width} height={FILM.height} aria-hidden="true" />
        <button type="button" className="btn btn--ghost film-preview__playback" onClick={togglePlayback}>
          {playback === "playing" ? "Pause video" : playback === "paused" ? "Resume video" : "Replay video"}
        </button>
      </div>
    </dialog>
  );
}
