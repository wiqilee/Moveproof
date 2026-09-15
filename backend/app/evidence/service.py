"""External Evidence Check.

The product question this answers is narrow and worth stating precisely.

MoveProof's verifier answers: did the approved migration contract hold? It
answers that from the data, deterministically, and nothing here changes that.

External Evidence Check answers a different question, and only for a human:
what should the contract be, when the dataset alone cannot say? A column of
values like `00127` proves the identifier is zero padded in this file. It does
not establish whether the zero is significant. Official documentation for the
source system might.

So this module fetches context. It never verifies anything. It cannot change a
check result, a migration state, a plan, or commit eligibility, and the
absence of those code paths is the guarantee rather than a promise in the
interface. Every result is labelled advisory, and the word "verified" is not
used for it anywhere.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg

from app.config import settings
from app.db import repository
from app.evidence import tavily
from app.evidence.query_builder import (
    EvidenceContext,
    UnsafeEvidenceRequest,
    build_query,
)

PROVIDER = "tavily"
EVENT_TYPE = "external_evidence_checked"

ADVISORY_NOTICE = (
    "Advisory evidence. These references were retrieved from an external "
    "search provider to help you interpret an ambiguous field. They have not "
    "been verified by MoveProof, they do not change any verification result, "
    "and the decision remains yours."
)


class EvidenceUnavailable(Exception):
    """The provider could not answer. The review is unchanged and retryable."""


class EvidenceNotConfigured(Exception):
    """No credential is present on the backend."""


def is_available() -> bool:
    return settings.tavily_configured


def check(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    context: EvidenceContext,
    requested_by: str | None = None,
) -> dict[str, Any]:
    """Run one external evidence check and record that it happened.

    Order matters. The migration is loaded first so an unknown id is a clean
    404 rather than a provider call for a record that does not exist. The
    query is built and sanitised before anything leaves. The audit event is
    written only after a successful call, so the trail records checks that
    actually occurred.
    """
    # 404 for an unknown migration, through the usual taxonomy.
    repository.load_migration(conn, migration_id)

    try:
        query = build_query(context)
    except UnsafeEvidenceRequest as exc:
        # A 422: the request content could not be processed. Distinct from a
        # workflow conflict, because nothing about the migration's state is
        # wrong here.
        raise ValueError(str(exc)) from exc

    try:
        sources = tavily.search(query)
    except tavily.TavilyNotConfigured as exc:
        raise EvidenceNotConfigured(str(exc)) from exc
    except (tavily.TavilyUnavailable, tavily.TavilyMalformedResponse) as exc:
        raise EvidenceUnavailable(str(exc)) from exc

    checked_at = datetime.now(timezone.utc)

    payload: dict[str, Any] = {
        "migration_id": str(migration_id),
        "context": {
            "source_column": context.source_column,
            "destination_column": context.destination_column,
            "source_type": context.source_type,
            "destination_type": context.destination_type,
            "proposed_operation": context.proposed_operation,
            "risk_category": context.risk_category,
            "source_system": context.source_system,
        },
        "question": context.question,
        "sanitized_query": query,
        "provider": PROVIDER,
        "checked_at": checked_at.isoformat(),
        "status": "results" if sources else "no_results",
        "result_count": len(sources),
        "sources": [source.as_dict() for source in sources],
        "advisory_notice": ADVISORY_NOTICE,
    }

    _record_event(conn, migration_id, payload, requested_by)
    return payload


def _record_event(
    conn: psycopg.Connection,
    migration_id: uuid.UUID,
    payload: dict[str, Any],
    requested_by: str | None,
) -> None:
    """Write the audit entry.

    Recorded: what was asked, what query left, which sources came back.

    Never recorded: the provider credential, uploaded rows, personal values,
    full data records or request headers. The metadata written here is built
    field by field from the payload rather than dumped wholesale, so a future
    addition to the response cannot start leaking into the audit trail by
    default.
    """
    metadata = {
        "provider": payload["provider"],
        "question": payload["question"],
        "sanitized_query": payload["sanitized_query"],
        "context": payload["context"],
        "result_count": payload["result_count"],
        "status": payload["status"],
        "sources": [
            {"title": source["title"], "url": source["url"], "domain": source["domain"]}
            for source in payload["sources"]
        ],
        "checked_at": payload["checked_at"],
        "requested_by": requested_by or settings.operator,
    }

    repository.log_event(
        conn,
        migration_id,
        None,
        "info",
        (
            f"External evidence checked for {payload['context']['source_column']}: "
            f"{payload['result_count']} advisory source(s) from {PROVIDER}"
        ),
        event_type=EVENT_TYPE,
        metadata=metadata,
    )


def history(conn: psycopg.Connection, migration_id: uuid.UUID) -> list[dict[str, Any]]:
    """Past evidence checks for one migration, newest first."""
    repository.load_migration(conn, migration_id)
    return repository.list_events_by_type(conn, migration_id, EVENT_TYPE)
