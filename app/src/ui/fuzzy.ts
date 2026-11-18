/**
 * Subsequence match with a score: consecutive and word-start hits rank higher, so "lp"
 * finds "Lincoln Park" and "exp" finds "Export plan" first. Returns -1 for no match.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    score += found === prev + 1 ? 3 : 1;
    if (found === 0 || /[\s,·/(-]/.test(t[found - 1])) score += 2;
    prev = found;
    ti = found + 1;
  }
  return score - t.length * 0.01;
}
