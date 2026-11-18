import { Component, type ReactNode, useEffect, useState } from "react";
import { currentBusiness, useAi } from "../ai/store";
import { useStore } from "../state/store";

/**
 * The tab names the plan ("Pet care in Chicago · Catchment"), so a row of tabs or a
 * history list is readable, and a bookmark is self-describing.
 */
export function DocumentTitle() {
  const metro = useStore((s) => s.metro);
  useStore((s) => s.profileId);
  useAi((s) => s.applied);
  useEffect(() => {
    document.title = metro ? `${currentBusiness().name} in ${metro.info.name} · Catchment` : "Catchment · Geo-targeting plans from Overture data";
  });
  return null;
}

/** Says what still works without a connection, instead of letting tiles and AI fail silently. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline" role="status">
      You're offline. Scores, pins and exports keep working on the loaded city; new map tiles, other cities and AI need a connection.
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Last line of defence: if rendering throws, show what happened and a way out instead of a
 * blank page. The plan is in the URL, so reloading loses nothing.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Catchment crashed while rendering:", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something broke on this screen.</h1>
        <p>Your plan is safe: it lives in the link, so reloading brings it back exactly as it was.</p>
        <div className="crash__actions">
          <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
            Reload the plan
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void navigator.clipboard?.writeText(`${error.name}: ${error.message}\n${location.href}`)}>
            Copy error details
          </button>
        </div>
        <pre className="crash__detail">{error.message}</pre>
      </div>
    );
  }
}
