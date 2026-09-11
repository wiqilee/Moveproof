"""Database connections.

psycopg 3 with parameterised SQL and no ORM. The choice is deliberate: every
statement this product runs against a customer's data should be readable in
one place, and Decimal round trips without an adapter guessing at precision.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

DEFAULT_URL = "postgresql://moveproof:moveproof_local_only@localhost:5433/moveproof"


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_URL)


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Open a connection with autocommit off.

    Every caller is therefore inside a transaction, and a failure rolls the
    whole unit of work back rather than leaving half a migration behind.
    """
    conn = psycopg.connect(database_url(), row_factory=dict_row, autocommit=False)
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@contextmanager
def transaction() -> Iterator[psycopg.Connection]:
    with connect() as conn:
        with conn.transaction():
            yield conn
