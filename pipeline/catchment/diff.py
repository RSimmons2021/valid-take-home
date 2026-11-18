"""What changed since the previous Overture release, matched by GERS id.

GERS ids are stable across releases, so a place can be followed from one month to the next:

- **added**: a kept, signal-bearing place whose id didn't exist in the previous release.
  Worded in the app as "new in Overture", not "opened": a new id can be a new business
  or a business a newly added source just contributed (the 2026-10 release added
  Uberall, Birdeye and OpenTravel).
- **closed**: a place whose status is now closed but wasn't in the previous release.
  That's a real status change for a known place, so the app can say "marked closed".

Ids that disappeared entirely aren't reported: removal can mean closure, a merge, or a
source dropping out, and we can't tell which.
"""

from __future__ import annotations

import duckdb

from . import signals as sig
from .db import rows, scalar

CLOSED = "('permanently_closed', 'temporarily_closed')"


def release_diff(con: duckdb.DuckDBPyConnection, prev_src: str) -> dict:
    """Needs `places_judged` (all current places with their drop reason) and `places_sig` (kept places with signal)."""
    con.sql(f"CREATE OR REPLACE TEMP TABLE prev AS SELECT id, operating_status AS prev_status FROM {prev_src}")
    added = rows(
        con,
        """
        SELECT ps.id, ps.name, ps.s, ps.lon, ps.lat
        FROM places_sig ps ANTI JOIN prev USING (id)
        WHERE ps.s IS NOT NULL AND ps.name IS NOT NULL
        ORDER BY ps.s, ps.id
        """,
    )
    closed = rows(
        con,
        f"""
        SELECT id, name, s, lon, lat FROM (
          SELECT j.id, j.name, j.lon, j.lat, {sig.signal_case_sql()} AS s
          FROM places_judged j JOIN prev USING (id)
          WHERE j.dropped = 'closed' AND coalesce(prev.prev_status, 'open') NOT IN {CLOSED}
        )
        WHERE s IS NOT NULL AND name IS NOT NULL
        ORDER BY s, id
        """,
    )
    totals = {
        "new_ids": scalar(
            con, "SELECT count(*) FROM places_judged j ANTI JOIN prev USING (id) WHERE j.dropped IS NULL"
        ),
        "newly_closed": scalar(
            con,
            f"SELECT count(*) FROM places_judged j JOIN prev USING (id) "
            f"WHERE j.dropped = 'closed' AND coalesce(prev.prev_status, 'open') NOT IN {CLOSED}",
        ),
    }

    def columns(rs: list[dict]) -> dict:
        return {
            "id": [r["id"] for r in rs],
            "name": [r["name"] for r in rs],
            "signal": [r["s"] for r in rs],
            "lon": [round(r["lon"], 5) for r in rs],
            "lat": [round(r["lat"], 5) for r in rs],
        }

    return {"added": columns(added), "closed": columns(closed), "totals": totals}
