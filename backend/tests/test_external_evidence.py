"""External Evidence Check.

Two things are under test here and they matter differently.

The first is ordinary: the provider is called correctly, its answer is
normalised, and every failure mode produces a clean, typed error rather than a
stack trace or a leaked credential.

The second is the safety property the feature exists under. External evidence
is advisory. It must never verify anything, never change a check result, a
migration state, a plan or commit eligibility, and never carry a row value out
to a third party. Those tests are the reason this file is long.

Tavily is mocked throughout. Production code performs a real call; tests must
not, or the suite becomes dependent on somebody else's uptime and quota.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.evidence import tavily  # noqa: E402
from app.evidence.query_builder import (  # noqa: E402
    EvidenceContext,
    UnsafeEvidenceRequest,
    available_questions,
    build_query,
)

# --------------------------------------------------------------------------
# Fakes
# --------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status_code: int = 200, payload: Any = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self._text = text

    def json(self) -> Any:
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def tavily_payload(count: int = 2) -> dict[str, Any]:
    return {
        "results": [
            {
                "title": f"Acme CRM Identifier Format Documentation {index}",
                "url": f"https://docs.example.com/acme/identifiers-{index}",
                "content": "Customer identifiers are stored as fixed width character values.",
                "published_date": "2025-02-01",
            }
            for index in range(count)
        ]
    }


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch):
    """A credential is present. Its value never appears in any assertion."""
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test-key-do-not-log-2f8a91")
    return "tvly-test-key-do-not-log-2f8a91"


@pytest.fixture
def no_credential(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)


def patch_post(monkeypatch: pytest.MonkeyPatch, handler):
    import httpx

    monkeypatch.setattr(httpx, "post", handler)


# --------------------------------------------------------------------------
# The query boundary
# --------------------------------------------------------------------------


def context(**overrides: Any) -> EvidenceContext:
    base = {
        "source_column": "customer_id",
        "destination_column": "customer_id",
        "question": "leading_zeros",
    }
    base.update(overrides)
    return EvidenceContext(**base)  # type: ignore[arg-type]


def test_a_query_is_composed_from_metadata_only():
    query = build_query(
        context(
            source_type="text",
            destination_type="VARCHAR(20)",
            proposed_operation="cast_to_integer",
            source_system="Acme CRM",
        )
    )
    assert "customer_id" in query
    assert "Acme CRM" in query
    assert "cast to integer" in query


def test_query_length_is_bounded():
    query = build_query(
        context(
            source_system="A" * 60,
            ambiguity_reason="B" * 150,
            source_type="text",
            destination_type="VARCHAR(20)",
        )
    )
    assert len(query) <= settings.tavily_max_query_chars


def test_a_raw_row_value_cannot_be_sent_as_a_column_name():
    """The field that looks most like free text is the one most constrained."""
    with pytest.raises(UnsafeEvidenceRequest):
        build_query(context(source_column="00127, Amara Chen, amara.chen@example.com"))


def test_an_email_address_in_the_reason_is_refused():
    with pytest.raises(UnsafeEvidenceRequest) as exc:
        build_query(context(ambiguity_reason="check amara.chen@example.com"))
    assert "never sent" in str(exc.value)


def test_a_free_form_question_is_refused():
    """There is no search box. The operator picks a question; we write it."""
    with pytest.raises(UnsafeEvidenceRequest) as exc:
        build_query(context(question="anything I feel like searching for"))
    assert "Free text questions are not accepted" in str(exc.value)


def test_an_overlong_reason_is_refused():
    with pytest.raises(UnsafeEvidenceRequest):
        build_query(context(ambiguity_reason="x" * 500))


def test_every_offered_question_builds_a_query():
    for question in available_questions():
        assert build_query(context(question=question["id"]))


# --------------------------------------------------------------------------
# The provider call
# --------------------------------------------------------------------------


def test_a_successful_response_is_normalised(configured, monkeypatch):
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(200, tavily_payload(2)))

    sources = tavily.search("does customer_id preserve leading zeros")

    assert len(sources) == 2
    first = sources[0]
    assert first.url.startswith("https://")
    assert first.domain == "docs.example.com"
    assert first.title
    assert first.excerpt


def test_the_result_count_is_bounded(configured, monkeypatch):
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(200, tavily_payload(50)))
    sources = tavily.search("query", max_results=99)
    assert len(sources) <= settings.tavily_max_results


def test_each_excerpt_is_bounded(configured, monkeypatch):
    payload = {
        "results": [
            {
                "title": "Long",
                "url": "https://docs.example.com/a",
                "content": "word " * 5000,
            }
        ]
    }
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(200, payload))
    sources = tavily.search("query")
    assert len(sources[0].excerpt) <= settings.tavily_max_excerpt_chars + 1


def test_an_empty_result_set_is_not_an_error(configured, monkeypatch):
    """No evidence found and the provider failing are different answers."""
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(200, {"results": []}))
    assert tavily.search("query") == []


def test_a_missing_results_key_is_treated_as_empty(configured, monkeypatch):
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(200, {}))
    assert tavily.search("query") == []


def test_a_malformed_response_is_reported(configured, monkeypatch):
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(200, {"results": "nope"}))
    with pytest.raises(tavily.TavilyMalformedResponse):
        tavily.search("query")


def test_a_non_json_response_is_reported(configured, monkeypatch):
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(200, None))
    with pytest.raises(tavily.TavilyMalformedResponse):
        tavily.search("query")


def test_a_non_2xx_response_is_reported(configured, monkeypatch):
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(500, {}))
    with pytest.raises(tavily.TavilyUnavailable) as exc:
        tavily.search("query")
    assert "500" in str(exc.value)
    assert "review is unchanged" in str(exc.value)


def test_a_rejected_credential_reads_as_configuration(configured, monkeypatch):
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(401, {}))
    with pytest.raises(tavily.TavilyNotConfigured):
        tavily.search("query")


def test_a_timeout_is_reported_as_retryable(configured, monkeypatch):
    import httpx

    def timeout(*args: Any, **kwargs: Any):
        raise httpx.TimeoutException("timed out")

    patch_post(monkeypatch, timeout)
    with pytest.raises(tavily.TavilyUnavailable) as exc:
        tavily.search("query")
    assert "retried" in str(exc.value)


def test_a_missing_credential_is_refused_before_any_call(no_credential, monkeypatch):
    def explode(*args: Any, **kwargs: Any):
        raise AssertionError("no request may be made without a credential")

    patch_post(monkeypatch, explode)
    with pytest.raises(tavily.TavilyNotConfigured):
        tavily.search("query")


def test_a_non_http_url_never_becomes_a_link(configured, monkeypatch):
    """A provider returning javascript: must not produce a clickable source."""
    payload = {
        "results": [
            {"title": "bad", "url": "javascript:alert(1)", "content": "x"},
            {"title": "also bad", "url": "data:text/html,<script>", "content": "x"},
            {"title": "good", "url": "https://docs.example.com/a", "content": "x"},
        ]
    }
    patch_post(monkeypatch, lambda *a, **k: FakeResponse(200, payload))
    sources = tavily.search("query")
    assert [source.url for source in sources] == ["https://docs.example.com/a"]


def test_the_api_key_never_appears_in_an_error(configured, monkeypatch):
    """httpx puts the request in its exception string. The request has the key."""
    import httpx

    def transport_error(*args: Any, **kwargs: Any):
        raise httpx.ConnectError(f"failed sending Authorization: Bearer {configured}")

    patch_post(monkeypatch, transport_error)
    with pytest.raises(tavily.TavilyUnavailable) as exc:
        tavily.search("query")
    assert configured not in str(exc.value)
    assert "ConnectError" in str(exc.value)


def test_the_api_key_is_sent_as_a_header_and_not_in_the_body(configured, monkeypatch):
    captured: dict[str, Any] = {}

    def capture(url: str, **kwargs: Any):
        captured["url"] = url
        captured["json"] = kwargs.get("json")
        captured["headers"] = kwargs.get("headers")
        return FakeResponse(200, tavily_payload(1))

    patch_post(monkeypatch, capture)
    tavily.search("does customer_id preserve leading zeros")

    assert configured in captured["headers"]["Authorization"]
    assert configured not in str(captured["json"])
    assert configured not in captured["url"]


def test_the_outgoing_query_carries_no_row_values(configured, monkeypatch):
    """The whole point of the boundary, asserted on the wire."""
    captured: dict[str, Any] = {}

    def capture(url: str, **kwargs: Any):
        captured["json"] = kwargs.get("json")
        return FakeResponse(200, tavily_payload(1))

    patch_post(monkeypatch, capture)
    query = build_query(
        context(source_system="Acme CRM", ambiguity_reason="zero padded in source")
    )
    tavily.search(query)

    sent = str(captured["json"])
    for forbidden in ("00127", "amara.chen@example.com", "Amara Chen", "1200.50"):
        assert forbidden not in sent
