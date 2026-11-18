"""catchment — build the app's data from Overture.

    uv run python -m catchment extract [metro ...]   # download raw slices (cached)
    uv run python -m catchment build   [metro ...]   # clean, aggregate, write app/public/data
    uv run python -m catchment all     [metro ...]   # both

With no metros, every metro in config.METROS is processed.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .aggregate import build_metro, write_index
from .config import METROS, RELEASE
from .extract import extract

OUT = Path(__file__).resolve().parents[2] / "app" / "public" / "data"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="catchment", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("command", choices=["extract", "build", "all"])
    p.add_argument("metros", nargs="*", help=f"any of: {', '.join(METROS)}")
    p.add_argument("--force", action="store_true", help="re-download raw slices")
    p.add_argument("--out", type=Path, default=OUT)
    a = p.parse_args(argv)

    unknown = [m for m in a.metros if m not in METROS]
    if unknown:
        p.error(f"unknown metro(s): {', '.join(unknown)}")
    targets = [METROS[m] for m in (a.metros or METROS)]
    print(f"Overture {RELEASE} · {len(targets)} metro(s)")

    entries: dict[str, dict] = {}
    index_file = a.out / "index.json"
    if index_file.exists():
        entries = {m["id"]: m for m in json.loads(index_file.read_text())["metros"]}

    for metro in targets:
        t0 = time.time()
        print(f"\n{metro.name}")
        if a.command in ("extract", "all"):
            extract(metro, force=a.force)
        if a.command in ("build", "all"):
            entries[metro.id] = build_metro(metro, a.out)
        print(f"  done in {time.time() - t0:.0f}s")

    if a.command in ("build", "all"):
        ordered = [entries[m] for m in METROS if m in entries]
        write_index(ordered, a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
