from __future__ import annotations

import duckdb


def connect(remote: bool = False) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.sql("INSTALL spatial; LOAD spatial;")
    con.sql("INSTALL h3 FROM community; LOAD h3;")
    # Overture geometries are lon/lat; say so instead of relying on the version default.
    con.sql("SET geometry_always_xy = true;")
    if remote:
        con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
        # Overture is public: no credentials, and retry flaky reads rather than failing a build.
        con.sql("SET http_retries=8; SET http_retry_wait_ms=500; SET http_retry_backoff=2;")
    return con


def rows(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    rel = con.sql(sql)
    cols = rel.columns
    return [dict(zip(cols, r, strict=False)) for r in rel.fetchall()]


def scalar(con: duckdb.DuckDBPyConnection, sql: str):
    return con.sql(sql).fetchall()[0][0]
