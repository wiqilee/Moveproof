"""The bridge to the Rust verifier.

A subprocess boundary. The binary reads JSON on stdin and writes JSON on
stdout, which keeps the interface narrow enough to test from either side and
avoids matching build toolchains between the two languages.

The important behaviour here is the fallback. When the binary is missing or
fails, reconciliation reports `not_verified` with the reason. It never reports
`passed` and it never silently substitutes the Python implementation as though
Rust had run, because a check that did not run is not a check that succeeded.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Mapping

TIMEOUT_SECONDS = 120

_REPO_ROOT = Path(__file__).resolve().parents[3]
_CANDIDATES = (
    _REPO_ROOT / "rust-verifier" / "target" / "release" / "moveproof-verifier",
    _REPO_ROOT / "rust-verifier" / "target" / "debug" / "moveproof-verifier",
)


class RustVerifierUnavailable(Exception):
    """The binary is not built or not reachable."""


class RustVerifierFailed(Exception):
    """The binary ran and reported an error."""


def binary_path() -> Path | None:
    """Locate the binary, preferring an explicit override."""
    override = os.environ.get("MOVEPROOF_VERIFIER_BIN", "").strip()
    if override:
        candidate = Path(override)
        return candidate if candidate.exists() else None

    for candidate in _CANDIDATES:
        if candidate.exists():
            return candidate

    found = shutil.which("moveproof-verifier")
    return Path(found) if found else None


def is_available() -> bool:
    return binary_path() is not None


def _encode_value(value: Any) -> dict[str, Any]:
    """Tag a Python value so Rust applies the same rule to it.

    The tag is what stops a decimal and an identifier being treated alike. A
    decimal is normalised numerically; an identifier never is.
    """
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "bool", "value": value}
    if isinstance(value, Decimal):
        return {"type": "decimal", "value": str(value)}
    if isinstance(value, int):
        return {"type": "int", "value": value}
    if isinstance(value, (datetime, date)):
        return {"type": "date", "value": value.isoformat()}
    if isinstance(value, float):
        raise TypeError(
            "Floats are not canonicalisable. Use Decimal for exact quantities."
        )
    return {"type": "text", "value": str(value)}


def encode_row(row: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    return {name: _encode_value(value) for name, value in row.items()}


def _invoke(command: str, payload: dict[str, Any]) -> dict[str, Any]:
    path = binary_path()
    if path is None:
        raise RustVerifierUnavailable(
            "The Rust verifier is not built. Run `cargo build --release` in "
            "rust-verifier, or set MOVEPROOF_VERIFIER_BIN."
        )

    try:
        completed = subprocess.run(
            [str(path), command],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RustVerifierFailed(
            f"The Rust verifier did not finish within {TIMEOUT_SECONDS} seconds."
        ) from exc
    except OSError as exc:
        raise RustVerifierUnavailable(f"The Rust verifier could not be run: {exc}") from exc

    if not completed.stdout.strip():
        raise RustVerifierFailed(
            f"The Rust verifier produced no output. stderr: {completed.stderr.strip()}"
        )

    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RustVerifierFailed(
            f"The Rust verifier returned output that is not JSON: {completed.stdout[:200]}"
        ) from exc

    if completed.returncode != 0 or "error" in parsed:
        raise RustVerifierFailed(parsed.get("error", f"exit code {completed.returncode}"))

    return parsed


def version() -> dict[str, Any]:
    return _invoke("version", {})


def hash_row(row: Mapping[str, Any], fields: list[str] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"row": encode_row(row)}
    if fields is not None:
        payload["fields"] = fields
    return _invoke("hash", payload)


def dataset_hash(rows: list[Mapping[str, Any]], fields: list[str] | None = None) -> str:
    payload: dict[str, Any] = {"rows": [encode_row(row) for row in rows]}
    if fields is not None:
        payload["fields"] = fields
    return _invoke("dataset", payload)["dataset_hash"]


def reconcile(
    source: Mapping[str, Mapping[str, Any]],
    destination: Mapping[str, Mapping[str, Any]],
    fields: list[str],
) -> dict[str, Any]:
    payload = {
        "fields": fields,
        "source": {key: encode_row(row) for key, row in source.items()},
        "destination": {key: encode_row(row) for key, row in destination.items()},
    }
    return _invoke("reconcile", payload)
