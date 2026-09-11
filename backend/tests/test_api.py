"""End to end API tests.

Marked `database` because every route touches PostgreSQL. They drive the whole
workflow through HTTP exactly as the frontend will:

    upload -> preview -> propose -> approve -> run -> verify -> repair
           -> rerun -> verify -> commit -> evidence

    make db-up migrate
    make test-db
"""

from __future__ import annotations

import os

import pytest

DATABASE_URL = os.environ.get("DATABASE_URL")

pytest.importorskip("fastapi", reason="fastapi is not installed")
pytest.importorskip("psycopg", reason="psycopg is not installed")

pytestmark = [
    pytest.mark.database,
    pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL is not set"),
]

from fastapi.testclient import TestClient  # noqa: E402

from app.api.main import app  # noqa: E402

CLEAN = b"""customer_id,full_name,email,signup_date,balance,region
00127,Amara Chen,amara.chen@example.com,2024-03-16,1200.50,APAC
00128,Diego Fernandez,diego.f@example.com,2024-03-15,980.00,EMEA
00129,Priya Natarajan,priya.n@example.com,2024-03-14,540.75,APAC
"""


@pytest.fixture
def client():
    """A client per test.

    Every successful request commits, by design, so isolation comes from the
    `clean_database` fixture in conftest rather than from a rollback here.
    """
    with TestClient(app) as test_client:
        yield test_client


def upload(client, payload=CLEAN, name="clean.csv"):
    response = client.post(
        "/api/migrations", files={"file": (name, payload, "text/csv")}
    )
    assert response.status_code == 201, response.text
    return response.json()["migration_id"]


def test_health_reports_honest_status(client):
    body = client.get("/health").json()
    assert body["database"]["connected"] is True
    # Configured is not the same as working, and the payload says so.
    assert "does not mean a call has succeeded" in body["nebius"]["note"]


def test_upload_returns_checksum_and_columns(client):
    response = client.post(
        "/api/migrations", files={"file": ("clean.csv", CLEAN, "text/csv")}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["row_count"] == 3
    assert body["checksum"].startswith("sha256:")
    assert "customer_id" in body["columns"]


def test_unsupported_file_type_is_rejected(client):
    response = client.post(
        "/api/migrations", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 422
    assert response.json()["kind"] == "parse"


def test_preview_returns_real_rows(client):
    migration_id = upload(client)
    body = client.get(f"/api/migrations/{migration_id}/preview").json()
    assert body["rows"][0]["values"]["customer_id"] == "00127"


def test_propose_flags_the_lossy_cast(client):
    migration_id = upload(client)
    body = client.post(
        f"/api/migrations/{migration_id}/plan/propose?profile=legacy"
    ).json()
    assert body["requires_acknowledgement"] is True
    assert "customer_id" in body["acknowledgement_columns"]


def test_approval_without_acknowledgement_is_refused(client):
    migration_id = upload(client)
    response = client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "legacy", "acknowledgements": []},
    )
    assert response.status_code == 409
    assert "not acknowledged" in response.json()["detail"]


def test_run_without_an_approved_plan_is_refused(client):
    migration_id = upload(client)
    response = client.post(f"/api/migrations/{migration_id}/run")
    assert response.status_code == 409
    assert "No approved plan" in response.json()["detail"]


def test_full_clean_workflow_reaches_commit(client):
    migration_id = upload(client)

    approve = client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    assert approve.status_code == 200, approve.text

    run = client.post(f"/api/migrations/{migration_id}/run").json()
    run_id = run["run_id"]
    assert run["accounting"]["staged_rows"] == 3

    verification = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/verify"
    ).json()
    assert verification["summary"]["failed"] == 0
    assert verification["state"] == "ready_to_commit"

    commit = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    ).json()
    assert commit["written"] == 3
    assert commit["written"] + commit["skipped"] == commit["expected"]


def test_legacy_cast_fails_verification_then_repairs(client):
    """The demonstration, driven entirely through HTTP."""
    migration_id = upload(client)

    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "legacy", "acknowledgements": ["customer_id"]},
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]
    verification = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/verify"
    ).json()

    identifier = next(
        c for c in verification["checks"] if c["check_id"] == "identifier_preservation"
    )
    assert identifier["status"] == "failed"
    # All three identifiers are zero padded, so all three are damaged.
    assert "3 row(s) differ" in identifier["observed"]

    blocked = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    )
    assert blocked.status_code == 409

    repair = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/repair/propose"
    ).json()
    assert repair["changes"][0]["after"] == "preserve_identifier_as_string"
    assert repair["rerun_source"] == "original uploaded file"

    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    rerun_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]
    assert rerun_id != run_id

    reverified = client.post(
        f"/api/migrations/{migration_id}/runs/{rerun_id}/verify"
    ).json()
    repaired = next(
        c for c in reverified["checks"] if c["check_id"] == "identifier_preservation"
    )
    assert repaired["status"] == "passed"

    committed = client.post(
        f"/api/migrations/{migration_id}/runs/{rerun_id}/commit", json={}
    ).json()
    assert committed["written"] == 3


def test_idempotency_key_prevents_a_second_staging(client):
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    headers = {"Idempotency-Key": "fixed-key"}
    first = client.post(f"/api/migrations/{migration_id}/run", headers=headers).json()
    second = client.post(f"/api/migrations/{migration_id}/run", headers=headers).json()

    assert first["run_id"] == second["run_id"]
    assert first["replayed"] is False
    assert second["replayed"] is True, "the second call must be reported as a replay"

    # The replay must not have staged a second copy of the rows.
    verification = client.post(
        f"/api/migrations/{migration_id}/runs/{first['run_id']}/verify"
    ).json()
    accounting = next(
        c for c in verification["checks"] if c["check_id"] == "row_accounting"
    )
    assert accounting["status"] == "passed"


def test_a_second_run_without_a_key_is_still_idempotent_per_plan(client):
    """The default key is derived from the migration and the plan version."""
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    first = client.post(f"/api/migrations/{migration_id}/run").json()
    second = client.post(f"/api/migrations/{migration_id}/run").json()
    assert first["run_id"] == second["run_id"]


def test_evidence_agrees_with_the_verification_endpoint(client):
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]
    verification = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/verify"
    ).json()
    evidence = client.get(
        f"/api/migrations/{migration_id}/evidence?run_id={run_id}"
    ).json()

    assert evidence["verification"]["summary"] == verification["summary"]
    assert evidence["source_file"]["checksum"].startswith("sha256:")
    assert evidence["contract"]["hash"] == evidence["plan"]["contract_hash"]
    assert evidence["row_accounting"]["source_rows"] == 3
    disclaimer = evidence["disclaimer"]
    assert "has been ruled out" in disclaimer, "the limits of a pass must be stated"
    assert "not cryptographic signatures" in disclaimer, (
        "an approval must not be described as a signature"
    )


def test_migration_list_reflects_real_records(client):
    migration_id = upload(client)
    body = client.get("/api/migrations").json()
    ids = [row["id"] for row in body["migrations"]]
    assert migration_id in ids


def test_search_finds_by_filename(client):
    upload(client, name="searchable_customers.csv")
    body = client.get("/api/migrations/search?q=searchable").json()
    assert any("searchable" in row["filename"] for row in body["results"])


def test_events_are_recorded(client):
    migration_id = upload(client)
    body = client.get(f"/api/migrations/{migration_id}/events").json()
    assert any("Uploaded" in event["message"] for event in body["events"])


def test_unknown_migration_returns_404(client):
    response = client.get("/api/migrations/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


def test_malformed_uuid_returns_400(client):
    response = client.get("/api/migrations/not-a-uuid")
    assert response.status_code == 400


# --- report exports -----------------------------------------------------


def test_health_reports_export_capabilities(client):
    body = client.get("/health").json()
    assert "pdf_available" in body["reports"]
    assert "available" in body["rust_verifier"]


def prepare_verified(client):
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]
    client.post(f"/api/migrations/{migration_id}/runs/{run_id}/verify")
    return migration_id, run_id


def test_pdf_export_returns_a_real_document(client):
    migration_id, run_id = prepare_verified(client)
    response = client.get(f"/api/migrations/{migration_id}/report/pdf?run_id={run_id}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF-")
    assert "attachment" in response.headers["content-disposition"]


def test_html_export_returns_a_document(client):
    migration_id, run_id = prepare_verified(client)
    response = client.get(f"/api/migrations/{migration_id}/report/html?run_id={run_id}")
    assert response.status_code == 200
    assert response.text.startswith("<!doctype html>")
    assert "Evidence report" in response.text


def test_all_three_exports_agree_on_the_counts(client):
    """The point of a canonical evidence object."""
    migration_id, run_id = prepare_verified(client)

    evidence = client.get(
        f"/api/migrations/{migration_id}/evidence?run_id={run_id}"
    ).json()
    html = client.get(
        f"/api/migrations/{migration_id}/report/html?run_id={run_id}"
    ).text
    pdf = client.get(f"/api/migrations/{migration_id}/report/pdf?run_id={run_id}").content

    summary = evidence["verification"]["summary"]
    assert f">{summary['passed']}<" in html
    assert evidence["source_file"]["checksum"] in html
    assert pdf.startswith(b"%PDF-")
    assert evidence["migration_id"][:8].encode() in pdf


# --- regressions from the first real database run -----------------------


def test_unreadable_file_is_a_content_error_not_a_conflict(client):
    """422 rather than 409.

    409 means the request conflicts with the current state of the resource.
    A file the parser cannot read is a problem with the request content, and
    the frontend distinguishes the two by the `kind` field.
    """
    response = client.post(
        "/api/migrations", files={"file": ("data.bin", b"\x00\x01", "application/octet-stream")}
    )
    assert response.status_code == 422
    assert response.json()["kind"] == "parse"


def test_a_malformed_csv_is_also_a_content_error(client):
    bad = b"customer_id,full_name\n00127,Amara Chen,extra\n"
    response = client.post("/api/migrations", files={"file": ("bad.csv", bad, "text/csv")})
    assert response.status_code == 422
    assert "malformed" in response.json()["detail"]


def test_check_evidence_uses_the_field_key_everywhere(client):
    """One serialisation for evidence, across every surface.

    The attribute is called field_name in Python and `field` on the wire. A
    mismatch here previously raised a KeyError that the exception handler
    reported as a 404, so the reports looked like missing routes.
    """
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "legacy", "acknowledgements": ["customer_id"]},
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]

    verification = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/verify"
    ).json()
    failed = next(c for c in verification["checks"] if c["status"] == "failed")
    assert "field" in failed["evidence"][0]

    stored = client.get(
        f"/api/migrations/{migration_id}/runs/{run_id}/verification"
    ).json()
    stored_failed = next(c for c in stored["checks"] if c["status"] == "failed")
    assert "field" in stored_failed["evidence"][0]

    evidence = client.get(
        f"/api/migrations/{migration_id}/evidence?run_id={run_id}"
    ).json()
    assert "field" in evidence["discrepancies"][0]


def test_a_missing_record_is_404_and_a_bug_is_not(client):
    """404 must mean the record does not exist, nothing else."""
    missing = client.get("/api/migrations/00000000-0000-0000-0000-000000000000/report.pdf")
    assert missing.status_code == 404
    assert missing.json()["kind"] == "not_found"


def test_clean_migration_reconciles_every_row(client):
    """A correct migration must not fail reconciliation.

    Reconciliation compares identity preserving columns as text on both
    sides. Comparing a cast value against the text it came from reported a
    difference on a correct migration, which is the opposite of useful.
    """
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]
    verification = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/verify"
    ).json()

    assert verification["summary"]["failed"] == 0, [
        c["observed"] for c in verification["checks"] if c["status"] == "failed"
    ]


def test_commit_reports_only_the_rows_it_wrote(client, destination_rows):
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]
    client.post(f"/api/migrations/{migration_id}/runs/{run_id}/verify")
    outcome = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    ).json()

    rows = destination_rows()
    assert outcome["written"] == len(rows)
    assert outcome["written"] + outcome["skipped"] == outcome["expected"]


def test_dotted_report_aliases_still_resolve(client):
    """The original .pdf and .html paths remain registered.

    They were the canonical contract for one release. Breaking them silently
    would strand any link already saved or shared.
    """
    migration_id, run_id = prepare_verified(client)

    pdf = client.get(f"/api/migrations/{migration_id}/report.pdf?run_id={run_id}")
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-")

    html = client.get(f"/api/migrations/{migration_id}/report.html?run_id={run_id}")
    assert html.status_code == 200
    assert html.text.startswith("<!doctype html>")


def test_discrepancy_evidence_uses_the_documented_shape(client):
    """Every discrepancy carries row_key, field, source_value, destination_value.

    A missing `field` key is what turned the report endpoints into a 500 on
    the first real database run.
    """
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "legacy", "acknowledgements": ["customer_id"]},
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]
    client.post(f"/api/migrations/{migration_id}/runs/{run_id}/verify")

    evidence = client.get(
        f"/api/migrations/{migration_id}/evidence?run_id={run_id}"
    ).json()

    assert evidence["discrepancies"], "the legacy cast must produce discrepancies"
    for entry in evidence["discrepancies"]:
        assert set(entry) >= {
            "check_id",
            "check_name",
            "status",
            "row_key",
            "field",
            "source_value",
            "destination_value",
        }

    # And the renderers must survive them.
    assert client.get(
        f"/api/migrations/{migration_id}/report/html?run_id={run_id}"
    ).status_code == 200
    assert client.get(
        f"/api/migrations/{migration_id}/report/pdf?run_id={run_id}"
    ).status_code == 200


# =====================================================================
# Status code taxonomy
#
# Four answers that must never be confused with one another:
#
#   404  the record does not exist
#   409  the record exists but the workflow is not in that state
#   422  the request content could not be processed
#   500  a bug in this application, never disguised as any of the above
# =====================================================================

ABSENT = "00000000-0000-0000-0000-000000000000"


@pytest.mark.parametrize(
    "path",
    [
        "/report/pdf",
        "/report/html",
        "/report.pdf",
        "/report.html",
        "/evidence",
        "/preview",
    ],
)
def test_absent_migration_is_404_on_every_read_route(client, path):
    """A migration that was never created is missing, not conflicted."""
    response = client.get(f"/api/migrations/{ABSENT}{path}")
    assert response.status_code == 404, response.text
    assert response.json()["kind"] == "not_found"


@pytest.mark.parametrize("path", ["/run", "/rollback"])
def test_absent_migration_is_404_on_write_routes(client, path):
    response = client.post(f"/api/migrations/{ABSENT}{path}")
    assert response.status_code == 404, response.text
    assert response.json()["kind"] == "not_found"


def test_absent_migration_is_404_on_plan_routes(client):
    proposed = client.post(f"/api/migrations/{ABSENT}/plan/propose?profile=safe")
    assert proposed.status_code == 404
    approved = client.post(
        f"/api/migrations/{ABSENT}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    assert approved.status_code == 404


def test_an_existing_migration_with_no_run_is_409_not_404(client):
    """The distinction the ordering bug erased.

    The record is real. The workflow simply has not reached the point where
    evidence exists. That is a conflict with current state, not absence.
    """
    migration_id = upload(client)

    evidence = client.get(f"/api/migrations/{migration_id}/evidence")
    assert evidence.status_code == 409, evidence.text
    assert evidence.json()["kind"] == "workflow"
    assert "has not been staged" in evidence.json()["detail"]

    report = client.get(f"/api/migrations/{migration_id}/report/pdf")
    assert report.status_code == 409


def test_an_existing_migration_without_an_approved_plan_is_409(client):
    migration_id = upload(client)
    response = client.post(f"/api/migrations/{migration_id}/run")
    assert response.status_code == 409
    assert response.json()["kind"] == "workflow"


def test_a_run_from_another_migration_is_404(client):
    """Reading someone else's evidence through a guessed id must not work."""
    first, run_id = prepare_verified(client)
    second = upload(client)

    response = client.get(f"/api/migrations/{second}/evidence?run_id={run_id}")
    assert response.status_code == 404
    assert "does not belong" in response.json()["detail"]


def test_an_absent_run_is_404(client):
    migration_id = upload(client)
    response = client.get(f"/api/migrations/{migration_id}/evidence?run_id={ABSENT}")
    assert response.status_code == 404


def test_a_malformed_uuid_is_400_not_404(client):
    """A bad identifier is a bad request. It says nothing about existence."""
    response = client.get("/api/migrations/not-a-uuid/report/pdf")
    assert response.status_code == 400


def test_an_unreadable_upload_is_422(client):
    response = client.post(
        "/api/migrations", files={"file": ("notes.txt", b"hello", "text/plain")}
    )
    assert response.status_code == 422
    assert response.json()["kind"] == "parse"


def test_a_key_error_is_not_reported_as_a_missing_record(client, monkeypatch):
    """The bug that made the report endpoints look like dead routes.

    KeyError and IndexError are subclasses of LookupError. A blanket handler
    on LookupError turned an internal serialisation fault into a 404, so a
    real bug was indistinguishable from a record that does not exist. Only
    repository.NotFound may produce a 404.
    """
    migration_id, run_id = prepare_verified(client)

    def exploding_build(*args, **kwargs):
        raise KeyError("field")

    monkeypatch.setattr("app.services.pipeline.build_evidence", exploding_build)

    with pytest.raises(KeyError):
        # TestClient re-raises server exceptions, which is the point: the
        # failure surfaces as a bug rather than being dressed up as a 404.
        client.get(f"/api/migrations/{migration_id}/evidence?run_id={run_id}")


@pytest.mark.parametrize(
    "suffix,content_type,head",
    [
        ("/report/pdf", "application/pdf", b"%PDF-"),
        ("/report.pdf", "application/pdf", b"%PDF-"),
    ],
)
def test_every_pdf_route_variant_returns_a_pdf(client, suffix, content_type, head):
    migration_id, run_id = prepare_verified(client)
    response = client.get(f"/api/migrations/{migration_id}{suffix}?run_id={run_id}")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == content_type
    assert response.content.startswith(head)


@pytest.mark.parametrize("suffix", ["/report/html", "/report.html"])
def test_every_html_route_variant_returns_html(client, suffix):
    migration_id, run_id = prepare_verified(client)
    response = client.get(f"/api/migrations/{migration_id}{suffix}?run_id={run_id}")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/html")
    assert response.text.startswith("<!doctype html>")
