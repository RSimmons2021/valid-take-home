import { currentBusiness, useAi } from "../ai/store";
import { mapIdle, snapshotMap } from "../map/snapshot";
import { useStore } from "../state/store";
import { compact } from "./format";

/**
 * The link "Copy link" copies. With the Catchment server, it's a /s link that unfurls in
 * Slack, iMessage or LinkedIn with a title, a one-line summary and a picture of this plan;
 * without a server (static hosting), it's the plain app URL, which still rebuilds the plan.
 */
export async function shareLink(): Promise<{ url: string; rich: boolean }> {
  const plain = location.href;
  const s = useStore.getState();
  if (!useAi.getState().server || !s.metro || !s.plan) return { url: plain, rich: false };

  const business = currentBusiness();
  const on = s.plan.homes ? Math.round((s.plan.onTargetHomes / s.plan.homes) * 100) : 0;
  const title = `${business.name} targeting in ${s.metro.info.name}`;
  const summary = `${s.plan.pins.length} pins · ${compact(s.plan.homes)} homes · ${on}% on target · built on Overture Maps ${s.metro.release}`;
  const params = new URLSearchParams({ h: location.hash.slice(1), t: title, d: summary });

  try {
    await mapIdle(1200);
    const image = snapshotMap(1200, 630, "image/jpeg", 0.8);
    if (image) {
      const res = await fetch("./api/previews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) params.set("img", (await res.json()).id);
    }
  } catch {
    /* the preview image is a nicety; the link works without it */
  }
  return { url: `${location.origin}/s?${params.toString()}`, rich: true };
}
