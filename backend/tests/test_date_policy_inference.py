"""Regression tests for deterministic full-source date-policy inference."""

from types import SimpleNamespace
import uuid

from app.domain.types import DateFormatPolicy, Mapping, Operation
from app.services import pipeline


DATE_MAPPING = [
    Mapping("calibration_date", "calibration_date", Operation.PARSE_DATE)
]


def _rows(*dates: str):
    return [
        SimpleNamespace(values={"calibration_date": value})
        for value in dates
    ]


def test_full_source_canonical_iso_is_inferred(monkeypatch):
    rows = _rows(
        "2026-04-03",
        "2026-04-04",
        "2026-04-05",
        "2026-04-06",
        "2026-04-07",
    )
    monkeypatch.setattr(
        pipeline.repository,
        "load_source_rows",
        lambda conn, migration_id: rows,
    )

    result = pipeline._infer_source_date_policy(
        object(),
        uuid.uuid4(),
        DATE_MAPPING,
    )

    assert result is DateFormatPolicy.ISO


def test_ambiguity_after_model_sample_prevents_iso_inference(monkeypatch):
    """The first five rows look ISO; row six proves the dataset is not."""
    rows = _rows(
        "2026-04-03",
        "2026-04-04",
        "2026-04-05",
        "2026-04-06",
        "2026-04-07",
        "03/04/2026",
    )
    monkeypatch.setattr(
        pipeline.repository,
        "load_source_rows",
        lambda conn, migration_id: rows,
    )

    result = pipeline._infer_source_date_policy(
        object(),
        uuid.uuid4(),
        DATE_MAPPING,
    )

    assert result is None


def test_no_date_mapping_does_not_invent_a_policy(monkeypatch):
    monkeypatch.setattr(
        pipeline.repository,
        "load_source_rows",
        lambda conn, migration_id: _rows("2026-04-03"),
    )

    result = pipeline._infer_source_date_policy(
        object(),
        uuid.uuid4(),
        [Mapping("robot_id", "robot_id", Operation.CAST_TO_INTEGER)],
    )

    assert result is None
