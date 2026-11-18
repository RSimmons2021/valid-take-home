"""Pinned inputs for a build: the Overture release, the metros we ship, and the grid.

Everything that changes the output lives here, so a diff of this file explains a diff of the data.
"""

from __future__ import annotations

from dataclasses import dataclass

RELEASE = "2026-10-21.0"
SCHEMA = "2.0.0"
S3_ROOT = f"s3://overturemaps-us-west-2/release/{RELEASE}"

# The release before RELEASE. Places are diffed against it by GERS id ("what changed in my pins").
PREVIOUS_RELEASE = "2026-09-23.0"
PREVIOUS_S3_ROOT = f"s3://overturemaps-us-west-2/release/{PREVIOUS_RELEASE}"

# H3 resolution 9: ~0.1 km² cells, ~175 m edge. Small enough to see a block-level
# difference, large enough that a cell usually holds dozens of addresses.
H3_RES = 9

# Places below this confidence are dropped. Overture scores existence, not quality;
# 0.5 keeps ~85% of San Francisco while cutting most of the long tail of stale listings.
MIN_CONFIDENCE = 0.5

# Two places with the same normalised name inside this distance are treated as one
# listing coming from two sources.
DEDUPE_METERS = 40.0


@dataclass(frozen=True)
class Metro:
    id: str
    name: str
    region: str
    bbox: tuple[float, float, float, float]  # xmin, ymin, xmax, ymax (lon/lat)
    center: tuple[float, float]  # lon, lat
    zoom: float

    @property
    def where(self) -> str:
        """Overlap predicate on Overture's bbox struct (lets DuckDB prune row groups)."""
        xmin, ymin, xmax, ymax = self.bbox
        return f"bbox.xmin < {xmax} AND bbox.xmax > {xmin} AND bbox.ymin < {ymax} AND bbox.ymax > {ymin}"


METROS: dict[str, Metro] = {
    m.id: m
    for m in [
        Metro(
            "sf-bay",
            "San Francisco & Oakland",
            "California",
            (-122.53, 37.70, -122.15, 37.90),
            (-122.33, 37.79),
            11.4,
        ),
        Metro(
            "austin",
            "Austin",
            "Texas",
            (-97.94, 30.13, -97.56, 30.52),
            (-97.75, 30.30),
            11.0,
        ),
        Metro(
            "chicago",
            "Chicago",
            "Illinois",
            (-87.94, 41.64, -87.52, 42.07),
            (-87.68, 41.86),
            10.6,
        ),
        Metro(
            "denver",
            "Denver",
            "Colorado",
            (-105.11, 39.61, -104.80, 39.86),
            (-104.96, 39.73),
            11.0,
        ),
    ]
}
