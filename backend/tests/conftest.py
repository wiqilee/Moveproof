"""Shared fixtures.

The important one is `clean_database`.

Tests marked `database` do not all roll back. The API tests drive the app
through `TestClient`, and the API commits once per successful request by
design, so those rows survive any rollback the test itself performs. A handful
of database tests also commit deliberately, because a lock contention test
cannot demonstrate anything inside a single transaction.

The result, before this fixture existed, was that committed customer rows
leaked from one test into the next. The next test then met a genuine
destination conflict, `commit_run` correctly failed closed, and ten tests
failed for a reason that had nothing to do with what they were testing.

Isolation belongs here rather than in the application. Truncating from
production code to keep tests happy would remove the very safety behaviour
those tests exist to prove.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DATABASE_URL = os.environ.get("DATABASE_URL")

# Order matters only for readability; CASCADE handles the dependencies.
TRUNCATE_SQL = """
TRUNCATE
    public.customers,
    moveproof.migrations
RESTART IDENTITY CASCADE;
"""


def _wipe() -> None:
    """Empty every table a test can write to, on its own connection.

    A separate connection is used on purpose. The test's own connection may be
    mid transaction, or may have been left in a failed state by an expected
    exception, and cleanup must succeed either way.
    """
    from app.db.connection import connect

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(TRUNCATE_SQL)
        conn.commit()


@pytest.fixture(scope="session")
def database_schema():
    """Apply the schema once for the whole session."""
    if not DATABASE_URL:
        pytest.skip("DATABASE_URL is not set")
    from app.db.migrations import apply_all

    apply_all(verbose=False)
    return True


@pytest.fixture(autouse=True)
def clean_database(request):
    """Give every database test an empty database, before and after.

    Cleaning afterwards as well as before means a failing test does not leave
    debris for the next one, and a developer inspecting the database after a
    run sees the state that test produced rather than an accumulation.

    Tests without the `database` marker never touch PostgreSQL, so this does
    nothing for them and the core suite still runs with no database at all.
    """
    if "database" not in request.keywords:
        yield
        return

    if not DATABASE_URL:
        pytest.skip("DATABASE_URL is not set")

    request.getfixturevalue("database_schema")
    _wipe()
    yield
    _wipe()


@pytest.fixture
def destination_rows():
    """Read the destination table. Used by tests that assert on commits."""

    def read() -> list[dict]:
        from app.db.connection import connect

        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT customer_id, email, balance, migration_id "
                    "FROM public.customers ORDER BY customer_id"
                )
                return [dict(row) for row in cur.fetchall()]

    return read
