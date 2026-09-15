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

# A second dataset that shares no customer_id and no email with CLEAN, so both
# can sit in the destination at once without the fail-closed conflict policy
# refusing either. Isolation cannot be proved with two files that collide.
CLEAN_B = b"""customer_id,full_name,email,signup_date,balance,region
00701,Mei Watanabe,mei.watanabe@example.com,2024-04-02,310.25,APAC
00702,Idris Okafor,idris.okafor@example.com,2024-04-03,875.00,EMEA
"""

CLEAN_ROWS = 3
CLEAN_B_ROWS = 2


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
        "/events",
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


# =====================================================================
# Verified CSV export
#
# The dataset, not the evidence. The rule under test throughout is that a
# file labelled verified may only ever contain data that actually passed
# verification.
# =====================================================================


def approve_and_run(client, migration_id, profile="safe", acks=None):
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": profile, "acknowledgements": acks or []},
    )
    run_id = client.post(f"/api/migrations/{migration_id}/run").json()["run_id"]
    verification = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/verify"
    ).json()
    return run_id, verification


def read_csv(response):
    import csv as _csv
    import io

    return list(_csv.reader(io.StringIO(response.text)))


def test_export_is_refused_before_any_run(client):
    migration_id = upload(client)
    response = client.get(f"/api/migrations/{migration_id}/export/csv")
    assert response.status_code == 409
    assert response.json()["kind"] == "workflow"
    assert "No verified run" in response.json()["detail"]


def test_export_is_refused_when_verification_failed(client):
    """A failed run must never be downloadable as a verified dataset."""
    migration_id = upload(client)
    _, verification = approve_and_run(
        client, migration_id, profile="legacy", acks=["customer_id"]
    )
    assert verification["summary"]["failed"] > 0

    response = client.get(f"/api/migrations/{migration_id}/export/csv")
    assert response.status_code == 409
    assert response.json()["kind"] == "workflow"


def test_export_is_refused_when_a_run_was_staged_but_never_verified(client):
    migration_id = upload(client)
    client.post(
        f"/api/migrations/{migration_id}/plan/approve",
        json={"profile": "safe", "acknowledgements": []},
    )
    client.post(f"/api/migrations/{migration_id}/run")
    # Deliberately no verify call.

    response = client.get(f"/api/migrations/{migration_id}/export/csv")
    assert response.status_code == 409


def test_export_works_before_commit_when_ready_to_commit(client):
    migration_id = upload(client)
    _, verification = approve_and_run(client, migration_id)
    assert verification["state"] == "ready_to_commit"

    response = client.get(f"/api/migrations/{migration_id}/export/csv")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["x-moveproof-committed"] == "false"


def test_export_still_works_after_commit(client):
    migration_id = upload(client)
    run_id, _ = approve_and_run(client, migration_id)
    committed = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    ).json()

    response = client.get(f"/api/migrations/{migration_id}/export/csv")
    assert response.status_code == 200
    assert response.headers["x-moveproof-committed"] == "true"
    assert int(response.headers["x-moveproof-row-count"]) == committed["written"]


def test_exported_identifiers_keep_their_leading_zeros(client):
    migration_id = upload(client)
    approve_and_run(client, migration_id)

    rows = read_csv(client.get(f"/api/migrations/{migration_id}/export/csv"))
    identifiers = [r[0] for r in rows[1:]]
    assert "00127" in identifiers
    assert "127" not in identifiers


def test_exported_headers_come_from_the_destination_schema(client):
    migration_id = upload(client)
    approve_and_run(client, migration_id)

    schema = client.get("/api/schema/destination").json()
    rows = read_csv(client.get(f"/api/migrations/{migration_id}/export/csv"))
    assert rows[0] == [column["name"] for column in schema["columns"]]


def test_exported_row_count_matches_the_committable_rows(client):
    migration_id = upload(client)
    run_id, _ = approve_and_run(client, migration_id)

    evidence = client.get(
        f"/api/migrations/{migration_id}/evidence?run_id={run_id}"
    ).json()
    rows = read_csv(client.get(f"/api/migrations/{migration_id}/export/csv"))

    assert len(rows) - 1 == evidence["row_accounting"]["committable_rows"]


def test_export_after_a_repair_describes_the_repaired_run(client):
    """The damaged run must not be the one exported."""
    migration_id = upload(client)
    broken_run, verification = approve_and_run(
        client, migration_id, profile="legacy", acks=["customer_id"]
    )
    assert verification["summary"]["failed"] > 0

    repaired_run, repaired = approve_and_run(client, migration_id)
    assert repaired["summary"]["failed"] == 0
    assert repaired_run != broken_run

    response = client.get(f"/api/migrations/{migration_id}/export/csv")
    assert response.status_code == 200
    assert response.headers["x-moveproof-run-id"] == repaired_run

    identifiers = [r[0] for r in read_csv(response)[1:]]
    assert "00127" in identifiers


def test_export_for_an_absent_migration_is_404(client):
    response = client.get(f"/api/migrations/{ABSENT}/export/csv")
    assert response.status_code == 404
    assert response.json()["kind"] == "not_found"


def test_health_advertises_the_export_capability(client):
    body = client.get("/health").json()
    assert body["exports"]["verified_csv_available"] is True


# =====================================================================
# Delete and rollback, the backend contract the UI depends on
# =====================================================================


def test_deleting_an_uncommitted_migration_removes_it(client):
    migration_id = upload(client)
    approve_and_run(client, migration_id)

    assert client.delete(f"/api/migrations/{migration_id}").status_code == 204
    assert client.get(f"/api/migrations/{migration_id}").status_code == 404


def test_rollback_then_delete_removes_committed_destination_rows(client):
    """The sequence the committed flow in the UI performs."""
    migration_id = upload(client)
    run_id, _ = approve_and_run(client, migration_id)
    committed = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    ).json()
    assert committed["written"] == CLEAN_ROWS

    rolled = client.post(f"/api/migrations/{migration_id}/rollback").json()
    assert rolled["rows_removed"] == committed["written"]

    assert client.delete(f"/api/migrations/{migration_id}").status_code == 204
    assert client.get(f"/api/migrations/{migration_id}").status_code == 404

    # The identifiers are free again, so a later migration is not blocked by
    # rows nobody kept.
    again = upload(client)
    later_run, _ = approve_and_run(client, again)
    assert (
        client.post(
            f"/api/migrations/{again}/runs/{later_run}/commit", json={}
        ).status_code
        == 200
    )


def test_rollback_on_an_absent_migration_is_404(client):
    assert client.post(f"/api/migrations/{ABSENT}/rollback").status_code == 404


def test_export_is_refused_after_the_migration_is_deleted(client):
    migration_id = upload(client)
    approve_and_run(client, migration_id)
    client.delete(f"/api/migrations/{migration_id}")

    response = client.get(f"/api/migrations/{migration_id}/export/csv")
    assert response.status_code == 404


# =====================================================================
# Delete and rollback
#
# Removing rows from the destination is an accountable act with its own
# endpoint. Deletion never does it as a side effect.
# =====================================================================


def test_delete_succeeds_before_any_run(client):
    """A migration abandoned straight after upload is removable."""
    migration_id = upload(client)

    response = client.delete(f"/api/migrations/{migration_id}")
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert client.get(f"/api/migrations/{migration_id}").status_code == 404


def test_delete_succeeds_after_verification_without_commit(client):
    """Staged and verified is still uncommitted, so nothing is at stake."""
    migration_id = upload(client)
    approve_and_run(client, migration_id)

    assert client.delete(f"/api/migrations/{migration_id}").status_code == 204
    assert client.get(f"/api/migrations/{migration_id}/evidence").status_code == 404


def test_delete_is_refused_while_the_migration_is_committed(client):
    """The invariant this whole flow exists to protect.

    Deleting must not remove customer records as a side effect of discarding a
    workspace entry. The refusal is a workflow conflict, and the destination is
    left exactly as it was.
    """
    migration_id = upload(client)
    run_id, _ = approve_and_run(client, migration_id)
    committed = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    ).json()
    assert committed["written"] > 0

    response = client.delete(f"/api/migrations/{migration_id}")
    assert response.status_code == 409, response.text
    assert response.json()["kind"] == "workflow"
    assert "roll it back first" in response.json()["detail"].lower()

    # The record and its rows both survive the refusal.
    assert client.get(f"/api/migrations/{migration_id}").status_code == 200
    evidence = client.get(f"/api/migrations/{migration_id}/evidence").json()
    assert evidence["commit"]["written_rows"] == committed["written"]


def test_rollback_then_delete_is_the_supported_sequence(client):
    """Rollback removes the rows and records it. Delete then removes the record."""
    migration_id = upload(client)
    run_id, _ = approve_and_run(client, migration_id)
    committed = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    ).json()

    rolled = client.post(f"/api/migrations/{migration_id}/rollback")
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["rows_removed"] == committed["written"]

    # The rollback is recorded before the record is destroyed.
    events = client.get(f"/api/migrations/{migration_id}/events").json()["events"]
    assert any("Rolled back" in event["message"] for event in events)

    assert client.delete(f"/api/migrations/{migration_id}").status_code == 204
    assert client.get(f"/api/migrations/{migration_id}").status_code == 404

    # The identifiers are free again, so a later migration is not blocked.
    again = upload(client)
    later_run, _ = approve_and_run(client, again)
    assert (
        client.post(f"/api/migrations/{again}/runs/{later_run}/commit", json={}).status_code
        == 200
    )


def test_delete_is_404_for_an_unknown_migration(client):
    """Absence is not a conflict. Nothing conflicts with a record never created."""
    response = client.delete(f"/api/migrations/{ABSENT}")
    assert response.status_code == 404, response.text
    assert response.json()["kind"] == "not_found"


def test_rollback_is_404_for_an_unknown_migration(client):
    response = client.post(f"/api/migrations/{ABSENT}/rollback")
    assert response.status_code == 404, response.text
    assert response.json()["kind"] == "not_found"


def test_rollback_removes_only_this_migrations_destination_rows(client):
    """Two migrations committed at once. Rolling one back leaves the other whole.

    The two datasets share no identifier and no email, so both commit under the
    fail-closed conflict policy rather than one having to be cleared first.

    The proof that B's rows survive is deliberately indirect and stronger than
    reading a stored number back: a third migration carrying B's identifiers is
    refused by the conflict policy, which can only happen if those rows are
    genuinely still in the destination. A's identifiers, meanwhile, commit
    again freely.
    """
    # 1 and 2: both migrations commit.
    a = upload(client, CLEAN, "a.csv")
    a_run, _ = approve_and_run(client, a)
    a_commit = client.post(f"/api/migrations/{a}/runs/{a_run}/commit", json={}).json()
    assert a_commit["written"] == CLEAN_ROWS

    b = upload(client, CLEAN_B, "b.csv")
    b_run, _ = approve_and_run(client, b)
    b_commit = client.post(f"/api/migrations/{b}/runs/{b_run}/commit", json={}).json()
    assert b_commit["written"] == CLEAN_B_ROWS
    assert b_commit["skipped"] == 0, "B must not collide with A"

    # 3: both sets are in the destination at the same time.
    for migration_id, expected in ((a, CLEAN_ROWS), (b, CLEAN_B_ROWS)):
        evidence = client.get(f"/api/migrations/{migration_id}/evidence").json()
        assert evidence["commit"]["written_rows"] == expected
        assert evidence["state"] == "committed"

    # 4 and 5: rolling A back removes exactly A's rows.
    rolled = client.post(f"/api/migrations/{a}/rollback")
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["rows_removed"] == CLEAN_ROWS

    # 6: B's rows are untouched. A fresh migration carrying B's identifiers is
    # still refused, which is only possible while those rows remain.
    b_again = upload(client, CLEAN_B, "b-again.csv")
    b_again_run, _ = approve_and_run(client, b_again)
    blocked = client.post(
        f"/api/migrations/{b_again}/runs/{b_again_run}/commit", json={}
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["kind"] == "commit_gate"
    assert "00701" in blocked.json()["detail"]

    # A's identifiers are free again, so the same file commits a second time.
    a_again = upload(client, CLEAN, "a-again.csv")
    a_again_run, _ = approve_and_run(client, a_again)
    recommitted = client.post(
        f"/api/migrations/{a_again}/runs/{a_again_run}/commit", json={}
    )
    assert recommitted.status_code == 200, recommitted.text
    assert recommitted.json()["written"] == CLEAN_ROWS

    # 7: B is still committed, with its commit record unchanged.
    b_evidence = client.get(f"/api/migrations/{b}/evidence").json()
    assert b_evidence["state"] == "committed"
    assert b_evidence["commit"]["written_rows"] == CLEAN_B_ROWS
    assert b_evidence["commit"]["skipped_rows"] == 0

    # 8: A recorded the rollback, and its state moved with it.
    a_detail = client.get(f"/api/migrations/{a}").json()
    assert a_detail["state"] == "rolled_back"
    a_events = client.get(f"/api/migrations/{a}/events").json()["events"]
    assert any(
        f"Rolled back {CLEAN_ROWS} row(s)" in event["message"] for event in a_events
    )


def test_two_migrations_with_distinct_identifiers_both_commit(client):
    """The precondition the isolation test depends on.

    If this fails, the isolation test above is proving nothing, so it is
    asserted separately rather than assumed.
    """
    a = upload(client, CLEAN, "a.csv")
    a_run, _ = approve_and_run(client, a)
    assert (
        client.post(f"/api/migrations/{a}/runs/{a_run}/commit", json={}).status_code
        == 200
    )

    b = upload(client, CLEAN_B, "b.csv")
    b_run, _ = approve_and_run(client, b)
    response = client.post(f"/api/migrations/{b}/runs/{b_run}/commit", json={})
    assert response.status_code == 200, response.text
    assert response.json()["skipped"] == 0


def test_delete_after_rollback_leaves_other_migrations_alone(client):
    keep = upload(client)
    approve_and_run(client, keep)

    discard = upload(client)
    assert client.delete(f"/api/migrations/{discard}").status_code == 204

    assert client.get(f"/api/migrations/{keep}").status_code == 200
    assert client.get(f"/api/migrations/{keep}/evidence").status_code == 200


def test_deletion_writes_no_event_for_the_record_it_destroys(client):
    """An audit row inserted microseconds before its own cascade has no reader.

    Asserted through the observable consequence: the delete succeeds and the
    events are gone with everything else.
    """
    migration_id = upload(client)
    approve_and_run(client, migration_id)
    assert client.get(f"/api/migrations/{migration_id}/events").status_code == 200

    assert client.delete(f"/api/migrations/{migration_id}").status_code == 204
    assert client.get(f"/api/migrations/{migration_id}/events").status_code == 404


# =====================================================================
# External Evidence Check
#
# Advisory context for a human reviewer. It must never verify anything or
# change any state the verifier owns.
# =====================================================================

EVIDENCE_BODY = {
    "source_column": "customer_id",
    "destination_column": "customer_id",
    "question": "leading_zeros",
    "source_type": "text",
    "destination_type": "VARCHAR(20)",
    "proposed_operation": "cast_to_integer",
    "risk_category": "identifier_loss",
    "source_system": "Acme CRM",
}


def fake_tavily(monkeypatch, results=2, fail=None):
    """Patch the provider. Production calls it for real; tests never do."""
    import httpx

    class _Response:
        status_code = 200

        def json(self):
            return {
                "results": [
                    {
                        "title": f"Acme CRM Identifier Format Documentation {i}",
                        "url": f"https://docs.example.com/acme/{i}",
                        "content": "Customer identifiers are fixed width character values.",
                    }
                    for i in range(results)
                ]
            }

    def handler(*args, **kwargs):
        if fail is not None:
            raise fail
        return _Response()

    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test-key")
    monkeypatch.setattr(httpx, "post", handler)


def test_health_advertises_external_evidence(client):
    body = client.get("/health").json()
    assert "available" in body["external_evidence"]
    assert body["external_evidence"]["provider"] == "tavily"
    assert "never verifies" in body["external_evidence"]["note"]


def test_the_offered_questions_are_a_fixed_list(client):
    body = client.get("/api/evidence/questions").json()
    ids = {question["id"] for question in body["questions"]}
    assert "leading_zeros" in ids
    assert all(question["label"] for question in body["questions"])


def test_external_evidence_returns_advisory_sources(client, monkeypatch):
    fake_tavily(monkeypatch)
    migration_id = upload(client)

    response = client.post(
        f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["provider"] == "tavily"
    assert body["result_count"] == 2
    assert body["status"] == "results"
    assert "customer_id" in body["sanitized_query"]
    assert all(source["url"].startswith("https://") for source in body["sources"])

    # The label must say advisory, and must not claim verification.
    assert "Advisory evidence" in body["advisory_notice"]
    assert "not been verified" in body["advisory_notice"]


def test_an_unknown_migration_is_404(client, monkeypatch):
    fake_tavily(monkeypatch)
    response = client.post(
        f"/api/migrations/{ABSENT}/external-evidence", json=EVIDENCE_BODY
    )
    assert response.status_code == 404
    assert response.json()["kind"] == "not_found"


def test_a_row_value_in_the_request_is_422(client, monkeypatch):
    fake_tavily(monkeypatch)
    migration_id = upload(client)
    body = {**EVIDENCE_BODY, "source_column": "00127, Amara Chen, a@example.com"}

    response = client.post(
        f"/api/migrations/{migration_id}/external-evidence", json=body
    )
    assert response.status_code == 422


def test_a_free_form_question_is_422(client, monkeypatch):
    fake_tavily(monkeypatch)
    migration_id = upload(client)
    body = {**EVIDENCE_BODY, "question": "search the web for anything"}

    response = client.post(
        f"/api/migrations/{migration_id}/external-evidence", json=body
    )
    assert response.status_code == 422


def test_a_missing_credential_is_503(client, monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    migration_id = upload(client)

    response = client.post(
        f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY
    )
    assert response.status_code == 503
    assert response.json()["kind"] == "evidence_unavailable"


def test_an_upstream_failure_is_502(client, monkeypatch):
    import httpx

    fake_tavily(monkeypatch, fail=httpx.TimeoutException("slow"))
    migration_id = upload(client)

    response = client.post(
        f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY
    )
    assert response.status_code == 502
    assert response.json()["kind"] == "evidence_unavailable"
    assert "unchanged" in response.json()["detail"]


def test_the_api_key_never_appears_in_the_response(client, monkeypatch):
    fake_tavily(monkeypatch)
    migration_id = upload(client)

    response = client.post(
        f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY
    )
    assert "tvly-test-key" not in response.text


def test_the_check_is_recorded_in_the_audit_trail(client, monkeypatch):
    fake_tavily(monkeypatch)
    migration_id = upload(client)
    client.post(f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY)

    history = client.get(f"/api/migrations/{migration_id}/external-evidence").json()
    assert len(history["checks"]) == 1
    metadata = history["checks"][0]["metadata"]

    assert metadata["provider"] == "tavily"
    assert metadata["result_count"] == 2
    assert metadata["sanitized_query"]
    assert [source["url"] for source in metadata["sources"]]
    assert "tvly-test-key" not in str(metadata)


def test_the_audit_entry_records_no_row_values(client, monkeypatch):
    fake_tavily(monkeypatch)
    migration_id = upload(client)
    client.post(f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY)

    history = client.get(f"/api/migrations/{migration_id}/external-evidence").json()
    recorded = str(history["checks"][0])
    for forbidden in ("00127", "amara.chen@example.com", "Amara Chen", "1200.50"):
        assert forbidden not in recorded


def test_evidence_does_not_change_verification_results(client, monkeypatch):
    """The safety property. Asserted by comparing before and after."""
    fake_tavily(monkeypatch)
    migration_id = upload(client)
    run_id, _ = approve_and_run(client, migration_id, profile="legacy",
                                acks=["customer_id"])

    before = client.get(
        f"/api/migrations/{migration_id}/runs/{run_id}/verification"
    ).json()

    client.post(f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY)

    after = client.get(
        f"/api/migrations/{migration_id}/runs/{run_id}/verification"
    ).json()

    assert after["summary"] == before["summary"]
    assert [c["status"] for c in after["checks"]] == [c["status"] for c in before["checks"]]


def test_evidence_does_not_change_migration_state_or_commit_eligibility(
    client, monkeypatch
):
    fake_tavily(monkeypatch)
    migration_id = upload(client)
    run_id, _ = approve_and_run(client, migration_id, profile="legacy",
                                acks=["customer_id"])

    state_before = client.get(f"/api/migrations/{migration_id}").json()["state"]
    client.post(f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY)
    state_after = client.get(f"/api/migrations/{migration_id}").json()["state"]
    assert state_after == state_before

    # A failed verification is still a failed verification afterwards.
    blocked = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    )
    assert blocked.status_code == 409


def test_the_main_workflow_continues_when_the_provider_is_down(client, monkeypatch):
    """A third party being unavailable must not block a migration."""
    import httpx

    fake_tavily(monkeypatch, fail=httpx.ConnectError("down"))
    migration_id = upload(client)

    failed = client.post(
        f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY
    )
    assert failed.status_code == 502

    run_id, verification = approve_and_run(client, migration_id)
    assert verification["summary"]["failed"] == 0
    committed = client.post(
        f"/api/migrations/{migration_id}/runs/{run_id}/commit", json={}
    )
    assert committed.status_code == 200


def test_an_empty_result_set_is_reported_as_no_results(client, monkeypatch):
    fake_tavily(monkeypatch, results=0)
    migration_id = upload(client)

    body = client.post(
        f"/api/migrations/{migration_id}/external-evidence", json=EVIDENCE_BODY
    ).json()
    assert body["status"] == "no_results"
    assert body["sources"] == []
    assert body["advisory_notice"]
