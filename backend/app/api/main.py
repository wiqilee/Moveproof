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


@app.get("/api/schema/destination")
def get_destination_schema() -> dict[str, Any]:
    return pipeline.destination_schema()


# ---------------------------------------------------------------- migrations


@app.post("/api/migrations", status_code=201)
async def create_migration(
    file: UploadFile = File(...), conn=Depends(db)
) -> dict[str, Any]:
    raw = await file.read()
    return pipeline.upload(
        conn,
        raw,
        file.filename or "upload.csv",
        content_type=file.content_type or "application/octet-stream",
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
    rows = repository.list_events(conn, _uuid(migration_id, "migration_id"))
    return {
        "events": [
            {
                "run_id": str(row["run_id"]) if row["run_id"] else None,
                "level": row["level"],
                "message": row["message"],
                "created_at": row["created_at"].isoformat(),
            }
            for row in rows
        ]
    }


@app.delete("/api/migrations/{migration_id}", status_code=204)
def delete_migration(migration_id: str, conn=Depends(db)) -> Response:
    """Delete a migration and everything derived from it.

    Cascades remove source rows, plans, runs, staged rows, checks and events.
    Committed destination rows are removed first so nothing is orphaned.
    """
    mid = _uuid(migration_id, "migration_id")
    repository.rollback_migration(conn, mid)
    with conn.cursor() as cur:
        cur.execute("DELETE FROM moveproof.migrations WHERE id = %s", (mid,))
    return Response(status_code=204)


# ---------------------------------------------------------------- planning


@app.post("/api/migrations/{migration_id}/plan/propose")
def propose(
    migration_id: str,
    profile: str = Query(default="safe", pattern="^(safe|legacy|model)$"),
    conn=Depends(db),
) -> dict[str, Any]:
    return pipeline.propose_plan(conn, _uuid(migration_id, "migration_id"), profile)


@app.post("/api/migrations/{migration_id}/plan/approve")
def approve(
    migration_id: str, body: dict[str, Any], conn=Depends(db)
) -> dict[str, Any]:
    return pipeline.approve_plan(
        conn,
        _uuid(migration_id, "migration_id"),
        profile=body.get("profile", "safe"),
        acknowledgements=body.get("acknowledgements", []),
        date_format_policy=body.get("date_format_policy"),
        required_field_policy=body.get("required_field_policy"),
        conflict_policy=body.get("conflict_policy"),
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


@app.get("/api/migrations/{migration_id}/evidence")
def evidence(
    migration_id: str, run_id: str | None = None, conn=Depends(db)
) -> dict[str, Any]:
    return pipeline.evidence(
        conn,
        _uuid(migration_id, "migration_id"),
        _uuid(run_id, "run_id") if run_id else None,
    )
