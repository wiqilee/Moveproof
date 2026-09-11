"""Schema migration runner.

Applies the numbered files in sql/ in order and records what has run. Small
enough to read in a minute, which matters more here than the features a
migration framework would add.
"""

from __future__ import annotations

import sys
from pathlib import Path

from app.db.connection import connect, database_url

SQL_DIR = Path(__file__).resolve().parents[2] / "sql"

BOOTSTRAP = """
CREATE SCHEMA IF NOT EXISTS moveproof;
CREATE TABLE IF NOT EXISTS moveproof.schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def apply_all(verbose: bool = True) -> list[str]:
    applied: list[str] = []
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(BOOTSTRAP)
            cur.execute("SELECT filename FROM moveproof.schema_migrations")
            done = {row["filename"] for row in cur.fetchall()}

            for path in sorted(SQL_DIR.glob("*.sql")):
                if path.name in done:
                    continue
                cur.execute(path.read_text(encoding="utf-8"))
                cur.execute(
                    "INSERT INTO moveproof.schema_migrations (filename) VALUES (%s)",
                    (path.name,),
                )
                applied.append(path.name)
                if verbose:
                    print(f"applied {path.name}")
        conn.commit()

    if verbose and not applied:
        print("schema already up to date")
    return applied


if __name__ == "__main__":
    print(f"connecting to {database_url().rsplit('@', 1)[-1]}")
    apply_all()
    sys.exit(0)
