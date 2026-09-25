"""The MoveProof HTTP API.

Routes are deliberately thin. Every decision lives in app.services.pipeline, so
the workflow behaves identically whether it is driven by this API, a test or a
script.

Errors map to status codes that mean something, and the four answers below
must never be confused with one another:

    NotFound             404, the record does not exist
    PipelineError        409, the record exists but the workflow is not in
                         that state
    CommitRefused        409, a safety gate stopped the commit
    SourceIntegrityError 409, stored bytes no longer match their checksum
    ParseError           422, the request content could not be processed
    SourceUnavailable    503, the authoritative source is unreachable
    anything else        500, a bug in this application

Only `repository.NotFound` is mapped to 404. The builtin `LookupError` is
deliberately not handled: `KeyError` and `IndexError` inherit from it, and a
blanket handler once turned an internal serialisation fault into a missing
record report, which made a real bug look like a dead route for an entire
release.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response

from app.config import settings
from app.db import repository
from app.db.connection import connect
from app.db.repository import (
    CommitRefused,
    NotFound,
    SourceIntegrityError,
    SourceUnavailable,
)
from app.evidence.query_builder import EvidenceContext, available_questions
from app.evidence.service import (
    EvidenceNotConfigured,
    EvidenceUnavailable,
    check as run_evidence_check,
    history as evidence_history,
    is_available as evidence_available,
)
from app.domain.profiles import UnknownDestinationProfile, resolve as resolve_profile
from app.ingest.parser import ParseError
from app.services import pipeline
from app.services.pipeline import PipelineError

app = FastAPI(
    title="MoveProof API",
    version="0.4.0",
    description="Move data. Prove what changed.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)


def db():
    """One connection and one transaction per request.

    Committing here rather than inside the service keeps a request atomic: if a
    later step raises, nothing the earlier steps wrote survives.
    """
    with connect() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def _uuid(value: str, label: str = "id") -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} is not a valid UUID") from None


@app.exception_handler(PipelineError)
async def _pipeline_error(request: Request, exc: PipelineError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc), "kind": "workflow"})


@app.exception_handler(CommitRefused)
async def _commit_refused(request: Request, exc: CommitRefused) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc), "kind": "commit_gate"})


@app.exception_handler(ParseError)
async def _parse_error(request: Request, exc: ParseError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc), "kind": "parse"})


@app.exception_handler(SourceIntegrityError)
async def _integrity_error(request: Request, exc: SourceIntegrityError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc), "kind": "integrity"})


@app.exception_handler(EvidenceNotConfigured)
async def _evidence_not_configured(
    request: Request, exc: EvidenceNotConfigured
) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc), "kind": "evidence_unavailable"},
    )


@app.exception_handler(EvidenceUnavailable)
async def _evidence_unavailable(request: Request, exc: EvidenceUnavailable) -> JSONResponse:
    """502, because the failure is upstream rather than in this request.

    Distinct from a workflow conflict: nothing about the migration is wrong,
    the external provider simply did not answer.
    """
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc), "kind": "evidence_unavailable"},
    )


@app.exception_handler(SourceUnavailable)
async def _source_unavailable(request: Request, exc: SourceUnavailable) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": str(exc), "kind": "source"})


@app.exception_handler(NotFound)
async def _not_found(request: Request, exc: NotFound) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc), "kind": "not_found"})


# ---------------------------------------------------------------- meta


def _pdf_available() -> bool:
    try:
        import reportlab  # noqa: F401
    except ImportError:
        return False
    return True


def _rust_available() -> bool:
    from app.verify import rust_bridge

    return rust_bridge.is_available()


@app.get("/health")
def health() -> dict[str, Any]:
    """Liveness plus an honest statement of what is actually wired up."""
    database_ok = False
    detail = None
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                database_ok = cur.fetchone()["ok"] == 1
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"

    return {
        "status": "ok" if database_ok else "degraded",
        "database": {"connected": database_ok, "detail": detail},
        "nebius": {
            "configured": settings.nebius_configured,
            "note": (
                "Configured means a key and model id are present. It does not "
                "mean a call has succeeded."
            ),
        },
        "exports": {
            # The button is shown when the backend says the route exists, not
            # because the frontend assumes it does.
            "verified_csv_available": True,
        },
        "external_evidence": {
            "available": evidence_available(),
            "provider": "tavily",
            "note": (
                "Advisory context for a human reviewer. It never verifies "
                "anything and never changes a check result."
            ),
        },
        "reports": {
            # The frontend disables the PDF action when this is false rather
            # than offering a button that leads to an error.
            "pdf_available": _pdf_available(),
            "html_available": True,
            "json_available": True,
        },
        "rust_verifier": {
            "available": _rust_available(),
            "note": (
                "When false, canonical reconciliation reports not verified. It "
                "is never reported as passed."
            ),
        },
        "limits": {
            "max_upload_bytes": settings.max_upload_bytes,
            "model_sample_rows": settings.model_sample_rows,
        },
    }


@app.get("/api/schema/profiles")
def list_destination_profiles() -> dict[str, Any]:
    """Every destination a migration may target.

    New endpoint rather than a change to the existing one, so a client that
    only knows about the customer schema keeps working untouched.
    """
    return pipeline.destination_profiles()


@app.get("/api/schema/destination")
def get_destination_schema(profile: str | None = None) -> dict[str, Any]:
    """The schema for one destination.

    `profile` is optional. Omitting it returns the customer schema, which is
    what this endpoint has always returned, so existing callers are unaffected.
    An unknown profile is a 422: it is a problem with the request rather than
    with the state of any resource.
    """
    try:
        return pipeline.destination_schema(profile)
    except UnknownDestinationProfile as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ---------------------------------------------------------------- migrations


@app.post("/api/migrations", status_code=201)
async def create_migration(
    file: UploadFile = File(...),
    destination_profile: str | None = Query(
        default=None,
        description=(
            "Destination to migrate into. Omitted means customers_v1, so an "
            "existing client keeps its current behaviour."
        ),
    ),
    conn=Depends(db),
) -> dict[str, Any]:
    raw = await file.read()
    try:
        resolve_profile(destination_profile)
    except UnknownDestinationProfile as exc:
        # Refused before the bytes are stored, so an unknown destination never
        # produces a half-created migration.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return pipeline.upload(
        conn,
        raw,
        file.filename or "upload.csv",
        content_type=file.content_type or "application/octet-stream",
        destination_profile=destination_profile,
    )


@app.get("/api/migrations")
def list_migrations(
    limit: int = Query(default=100, ge=1, le=500), conn=Depends(db)
) -> dict[str, Any]:
    rows = repository.list_migrations(conn, limit)
    return {
        "migrations": [
            {
                "id": str(row["id"]),
                "filename": row["filename"],
                "checksum": row["checksum"],
                "row_count": row["row_count"],
                "state": row["state"],
                # Null for migrations recorded before profiles existed. The
                # backend reads that absence as customers_v1; the field is
                # additive so an older client simply ignores it.
                "destination_profile": row.get("destination_profile"),
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
                "latest_plan_version": row["latest_plan_version"],
                "approved_plan_version": row["approved_plan_version"],
                "latest_run_id": str(row["latest_run_id"]) if row["latest_run_id"] else None,
                "verified_at": row["latest_run_verified_at"].isoformat()
                if row["latest_run_verified_at"]
                else None,
                "committed_at": row["committed_at"].isoformat()
                if row["committed_at"]
                else None,
            }
            for row in rows
        ]
    }


@app.get("/api/migrations/search")
def search(q: str = Query(min_length=1), conn=Depends(db)) -> dict[str, Any]:
    rows = repository.search_migrations(conn, q)
    return {
        "results": [
            {
                "id": str(row["id"]),
                "filename": row["filename"],
                "state": row["state"],
            }
            for row in rows
        ]
    }


@app.get("/api/migrations/{migration_id}")
def get_migration(migration_id: str, conn=Depends(db)) -> dict[str, Any]:
    mid = _uuid(migration_id, "migration_id")
    migration = repository.load_migration(conn, mid)
    plans = repository.list_plans(conn, mid)
    return {
        "id": str(migration["id"]),
        "filename": migration["filename"],
        "checksum": migration["checksum"],
        "row_count": migration["row_count"],
        "columns": migration["source_columns"],
        "state": migration["state"],
        "destination_profile": migration.get("destination_profile"),
        "created_at": migration["created_at"].isoformat(),
        "plans": [
            {
                "version": plan["version"],
                "proposed_by": plan["proposed_by"],
                "approved_by": plan["approved_by"],
                "approved_at": plan["approved_at"].isoformat()
                if plan["approved_at"]
                else None,
                "acknowledgements": plan["acknowledgements"],
                "conflict_policy": plan["conflict_policy"],
            }
            for plan in plans
        ],
        "latest_run_id": str(repository.latest_run_id(conn, mid) or "") or None,
    }


@app.get("/api/migrations/{migration_id}/preview")
def preview(
    migration_id: str, limit: int = Query(default=50, ge=1, le=500), conn=Depends(db)
) -> dict[str, Any]:
    return pipeline.preview(conn, _uuid(migration_id, "migration_id"), limit)


@app.get("/api/migrations/{migration_id}/events")
def events(migration_id: str, conn=Depends(db)) -> dict[str, Any]:
    """The audit events for one migration.

    Existence is established first. Without it, a migration that was never
    created and one that simply has no events both answer 200 with an empty
    list, which reads as "nothing happened" rather than "no such record". A
    deleted migration would keep answering 200 forever, for the same reason.
    """
    mid = _uuid(migration_id, "migration_id")
    repository.load_migration(conn, mid)

    rows = repository.list_events(conn, mid)
    return {
        "events": [
            {
                "run_id": str(row["run_id"]) if row["run_id"] else None,
                "level": row["level"],
                "message": row["message"],
                "created_at": row["created_at"].isoformat(),
                # Structured audit fields. Null for older plain events, so
                # existing consumers see only additive keys. The metadata is
                # what the writer chose to record: model ids and reasons for
                # routing, titles and URLs for evidence. It never holds row
                # values or credentials, because no writer puts them there.
                "event_type": row.get("event_type"),
                "metadata": row.get("metadata"),
            }
            for row in rows
        ]
    }


@app.delete("/api/migrations/{migration_id}", status_code=204)
def delete_migration(migration_id: str, conn=Depends(db)) -> Response:
    """Delete a migration and its derived data.

    Cascades take the source file, source rows, plans, runs, staged rows,
    checks, transformation errors, approvals, commits and events.

    The destination is untouched. A committed migration must be rolled back
    first, through its own endpoint, so removing customer records is always an
    act somebody asked for by name rather than a side effect of tidying up.

        204  the record existed, was not committed, and is now gone
        404  the record never existed
        409  the record is committed; roll it back first
    """
    pipeline.delete_migration(conn, _uuid(migration_id, "migration_id"))
    return Response(status_code=204)


# ---------------------------------------------------------------- planning


@app.post("/api/migrations/{migration_id}/plan/propose")
def propose(
    migration_id: str,
    source: str = Query(
        default="safe",
        pattern="^(safe|legacy|model)$",
        alias="profile",
        description="Where the proposal comes from, not where it is going.",
    ),
    conn=Depends(db),
) -> dict[str, Any]:
    return pipeline.propose_plan(conn, _uuid(migration_id, "migration_id"), source)


@app.post("/api/migrations/{migration_id}/plan/approve")
def approve(
    migration_id: str, body: dict[str, Any], conn=Depends(db)
) -> dict[str, Any]:
    """Approve a proposal.

    `proposal_version` and `proposal_hash` come straight from the propose
    response and bind this approval to the exact plan the reviewer saw. They
    are required for a model-drafted proposal, because there is no way to
    reconstruct one; the deterministic baselines may still be approved by
    naming `source` alone.

    Everything else in the body is a human decision, not a plan: which lossy
    operations were acknowledged, how an ambiguous date is to be read, and how
    an ambiguous decimal column is to be read. No mapping arrives from the
    browser.
    """
    proposal_version = body.get("proposal_version")
    return pipeline.approve_plan(
        conn,
        _uuid(migration_id, "migration_id"),
        source=body.get("source", body.get("profile", "safe")),
        acknowledgements=body.get("acknowledgements", []),
        date_format_policy=body.get("date_format_policy"),
        required_field_policy=body.get("required_field_policy"),
        conflict_policy=body.get("conflict_policy"),
        proposal_version=int(proposal_version)
        if proposal_version is not None
        else None,
        proposal_hash=body.get("proposal_hash"),
        decimal_conventions=body.get("decimal_conventions"),
    )


# ---------------------------------------------------------------- execution


@app.post("/api/migrations/{migration_id}/run")
def run(
    migration_id: str, request: Request, conn=Depends(db)
) -> dict[str, Any]:
    key = request.headers.get("Idempotency-Key")
    return pipeline.execute(conn, _uuid(migration_id, "migration_id"), key)


@app.post("/api/migrations/{migration_id}/runs/{run_id}/verify")
def verify(migration_id: str, run_id: str, conn=Depends(db)) -> dict[str, Any]:
    return pipeline.verify(
        conn, _uuid(migration_id, "migration_id"), _uuid(run_id, "run_id")
    )


@app.get("/api/migrations/{migration_id}/runs/{run_id}/verification")
def verification(migration_id: str, run_id: str, conn=Depends(db)) -> dict[str, Any]:
    # Establish that the migration and the run exist before reporting on
    # their checks, so "never created" and "created but never verified" do not
    # collapse into the same answer.
    repository.load_migration(conn, _uuid(migration_id, "migration_id"))
    repository.load_run(conn, _uuid(run_id, "run_id"))

    checks = repository.load_checks(conn, _uuid(run_id, "run_id"))
    if not checks:
        raise HTTPException(
            status_code=404, detail="No verification has been recorded for this run."
        )
    return {
        "run_id": run_id,
        "checks": [
            {
                "check_id": c["check_id"],
                "name": c["name"],
                "expected": c["expected"],
                "observed": c["observed"],
                "status": c["status"],
                "evidence": c["evidence"],
                "checked_at": c["checked_at"].isoformat(),
            }
            for c in checks
        ],
        "summary": {
            status: sum(1 for c in checks if c["status"] == status)
            for status in ("passed", "failed", "review", "not_verified")
        },
    }


@app.post("/api/migrations/{migration_id}/runs/{run_id}/repair/propose")
def repair(migration_id: str, run_id: str, conn=Depends(db)) -> dict[str, Any]:
    return pipeline.propose_repair(
        conn, _uuid(migration_id, "migration_id"), _uuid(run_id, "run_id")
    )


@app.post("/api/migrations/{migration_id}/runs/{run_id}/commit")
def commit(
    migration_id: str, run_id: str, body: dict[str, Any] | None = None, conn=Depends(db)
) -> dict[str, Any]:
    payload = body or {}
    return pipeline.commit(
        conn,
        _uuid(migration_id, "migration_id"),
        _uuid(run_id, "run_id"),
        conflict_policy=payload.get("conflict_policy"),
    )


@app.post("/api/migrations/{migration_id}/rollback")
def rollback(migration_id: str, conn=Depends(db)) -> dict[str, Any]:
    return pipeline.rollback(conn, _uuid(migration_id, "migration_id"))


# ---------------------------------------------------------------- evidence


@app.get("/api/migrations/{migration_id}/report/html", response_class=HTMLResponse)
@app.get("/api/migrations/{migration_id}/report.html", response_class=HTMLResponse)
def report_html(
    migration_id: str, run_id: str | None = None, conn=Depends(db)
) -> HTMLResponse:
    """The evidence report as a standalone HTML document."""
    from app.reports.html import build_html

    evidence = pipeline.evidence(
        conn,
        _uuid(migration_id, "migration_id"),
        _uuid(run_id, "run_id") if run_id else None,
    )
    return HTMLResponse(content=build_html(evidence))


@app.get("/api/migrations/{migration_id}/report/pdf")
@app.get("/api/migrations/{migration_id}/report.pdf")
def report_pdf(
    migration_id: str, run_id: str | None = None, conn=Depends(db)
) -> Response:
    """The evidence report as a PDF.

    Rendered from the same canonical object as the HTML view and the JSON
    export, so the three cannot disagree about a single value.
    """
    if not _pdf_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "PDF generation is unavailable because reportlab is not "
                "installed. Run pip install -r requirements.txt."
            ),
        )

    from app.reports.pdf import build_pdf

    evidence = pipeline.evidence(
        conn,
        _uuid(migration_id, "migration_id"),
        _uuid(run_id, "run_id") if run_id else None,
    )
    payload = build_pdf(evidence)
    short = evidence["migration_id"][:8]
    return Response(
        content=payload,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="moveproof-evidence-{short}.pdf"'
        },
    )


@app.get("/api/migrations/{migration_id}/export/csv")
def export_verified_csv(migration_id: str, conn=Depends(db)) -> Response:
    """The verified transformed dataset as CSV.

    Distinct from the evidence reports. Those describe what happened; this is
    the data itself, exactly as it passed verification.

    Available once a run is verified with nothing mandatory outstanding, and
    still available after commit. A failed or unverified run is refused with a
    workflow error rather than exported under a name that says verified.
    """
    csv_text, filename, manifest = pipeline.export_verified_csv(
        conn, _uuid(migration_id, "migration_id")
    )
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # The caller can tell which run the file describes without opening
            # it, which matters when a migration has been rerun after a repair.
            "X-MoveProof-Run-Id": manifest["run_id"],
            "X-MoveProof-Plan-Version": str(manifest["plan_version"]),
            "X-MoveProof-Row-Count": str(manifest["row_count"]),
            "X-MoveProof-Committed": "true" if manifest["committed"] else "false",
            "Access-Control-Expose-Headers": (
                "Content-Disposition, X-MoveProof-Run-Id, X-MoveProof-Plan-Version, "
                "X-MoveProof-Row-Count, X-MoveProof-Committed"
            ),
        },
    )


@app.get("/api/evidence/questions")
def evidence_questions() -> dict[str, Any]:
    """The questions a reviewer may ask.

    The interface offers these rather than a text box. Free-form search would
    make it possible to send a row value to an external provider by accident.
    """
    return {"questions": available_questions(), "provider": "tavily"}


@app.post("/api/migrations/{migration_id}/external-evidence")
def external_evidence(
    migration_id: str, body: dict[str, Any], conn=Depends(db)
) -> dict[str, Any]:
    """Fetch advisory external context for one ambiguous field.

    Advisory only. This never verifies anything, never changes a check result,
    a migration state, a plan or commit eligibility, and says so in its own
    response.

        200  advisory sources, possibly an empty list
        404  the migration does not exist
        422  the request carries something that must not be sent outward
        502  the provider did not answer; the review is unchanged
        503  no provider credential is configured on the backend
    """
    mid = _uuid(migration_id, "migration_id")

    try:
        context = EvidenceContext(
            source_column=str(body.get("source_column", "")),
            destination_column=str(body.get("destination_column", "")),
            question=str(body.get("question", "")),
            source_type=body.get("source_type"),
            destination_type=body.get("destination_type"),
            proposed_operation=body.get("proposed_operation"),
            risk_category=body.get("risk_category"),
            ambiguity_reason=body.get("ambiguity_reason"),
            source_system=body.get("source_system"),
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=422, detail=f"Malformed evidence request: {exc}"
        ) from exc

    try:
        return run_evidence_check(conn, mid, context)
    except ValueError as exc:
        # Raised by the query boundary when the request carries something it
        # will not send to an external provider.
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/migrations/{migration_id}/external-evidence")
def external_evidence_history(migration_id: str, conn=Depends(db)) -> dict[str, Any]:
    """Past evidence checks for this migration, newest first."""
    rows = evidence_history(conn, _uuid(migration_id, "migration_id"))
    return {
        "checks": [
            {
                "message": row["message"],
                "metadata": row["metadata"],
                "checked_at": row["created_at"].isoformat(),
            }
            for row in rows
        ]
    }


@app.get("/api/migrations/{migration_id}/evidence")
def evidence(
    migration_id: str, run_id: str | None = None, conn=Depends(db)
) -> dict[str, Any]:
    return pipeline.evidence(
        conn,
        _uuid(migration_id, "migration_id"),
        _uuid(run_id, "run_id") if run_id else None,
    )
