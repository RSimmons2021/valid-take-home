/**
 * Browser side of the AI API. Types mirror server/ai/*. The browser never holds a key:
 * it only talks to this app's own /api, which may not exist on a static deploy (then
 * `health()` reports AI as unavailable and the UI hides it).
 */

export interface Usage {
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
}

export interface PlanProposal {
  supported: boolean;
  name: string;
  summary: string;
  weights: { factor: string; weight: -2 | -1 | 1 | 2; reason: string }[];
  competitor: string | null;
  note: string;
}

export interface Angle {
  angle: string;
  headline: string;
  body: string;
  /** prompt for an AI video model: 9:16, no place names or signage */
  scene: string;
  cites: { id: string; name: string; kind: string }[];
}

export interface BriefResponse {
  plan: PlanProposal;
  usage: Usage;
  cached: boolean;
}

export interface AnglesResponse {
  angles: Angle[];
  rejected: string[];
  grounded: number;
  usage: Usage;
  cached: boolean;
}

export interface AnglesRequest {
  metroId: string;
  lat: number;
  lon: number;
  radiusMi: number;
  weights: Record<string, number>;
  business: { name: string; summary: string };
  area: { hood: string | null; city: string | null };
  attempt: number;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TIMEOUT_MS = 40_000; // the server times out at 25 s (+1 retry); this only catches a dead connection

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).catch((e: unknown) => {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof DOMException && e.name === "TimeoutError") throw new ApiError("The request timed out. Try again.", "timeout", 0);
    throw new ApiError("Couldn't reach the server.", "network", 0);
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status}).`, err?.code ?? "http_error", res.status);
  }
  return data as T;
}

export async function health(): Promise<{ ai: boolean; model: string | null }> {
  try {
    const res = await fetch("./api/health", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ai: false, model: null };
    const data = await res.json();
    return { ai: !!data.ai, model: data.model ?? null };
  } catch {
    return { ai: false, model: null }; // static host: no API
  }
}

export const suggestPlan = (brief: string, signal?: AbortSignal) => post<BriefResponse>("./api/brief", { brief }, signal);

export const writeAngles = (req: AnglesRequest, signal?: AbortSignal) => post<AnglesResponse>("./api/angles", req, signal);

/** "gpt-6.1-terra · 7.4 s · $0.002" or "cached · instant" */
export function usageLine(u: Usage, cached: boolean): string {
  if (cached) return `${u.model} · cached, instant · no cost`;
  const cost = u.costUsd < 0.01 ? `$${u.costUsd.toFixed(4)}` : `$${u.costUsd.toFixed(3)}`;
  return `${u.model} · ${(u.ms / 1000).toFixed(1)} s · ${cost}`;
}
