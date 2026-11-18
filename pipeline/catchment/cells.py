"""Small pure helpers over H3 cells (kept free of DuckDB so they are trivial to test)."""

from __future__ import annotations

import re
from collections import Counter

import h3

_ZIP5 = re.compile(r"^\s*(\d{5})(?:[-\s]?\d{4})?\s*$")


def zip5(code: str | None) -> str | None:
    """Normalise a US postcode ('94110-1234', ' 94110 ') to five digits, else None."""
    if not code:
        return None
    m = _ZIP5.match(code)
    return m.group(1) if m else None


def fill_from_neighbors(ids: list[str], values: list[str | None], max_k: int = 3) -> list[str | None]:
    """Give unlabelled cells the most common label among the nearest labelled ring.

    Rings are searched outward one at a time (k = 1..max_k) so a cell takes its label
    from its closest neighbours, not from a larger area that happens to have more cells.
    Ties break on the label's sort order, so the result is deterministic.
    """
    known = {c: v for c, v in zip(ids, values, strict=False) if v is not None}
    out = list(values)
    for i, (cell, v) in enumerate(zip(ids, values, strict=False)):
        if v is not None:
            continue
        for k in range(1, max_k + 1):
            ring = [known[n] for n in h3.grid_ring(cell, k) if n in known]
            if ring:
                counts = Counter(ring)
                best = max(counts.values())
                out[i] = min(label for label, n in counts.items() if n == best)
                break
    return out
