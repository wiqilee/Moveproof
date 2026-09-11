#!/usr/bin/env python3
"""Standalone Nebius Token Factory smoke test.

Deliberately independent of the rest of the backend. Run it the moment you have
a key, without waiting for PostgreSQL, the API or the frontend, because Token
Factory access is the one hackathon requirement that decides eligibility.

    export NEBIUS_API_KEY=...        # never commit this, never log it
    python scripts/nebius_smoke_test.py

The key is read from the environment only. Nothing here prints it, and nothing
writes it to a file.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.nebius.client import (  # noqa: E402
    NebiusClient,
    NebiusConfig,
    NebiusNotConfigured,
    NebiusUnavailable,
)

NVIDIA_HINTS = ("nemotron", "nvidia", "llama-3", "nemo")

SYSTEM_PROMPT = (
    "You map spreadsheet columns onto a database schema. Reply with a JSON "
    "object only. No prose, no markdown fence."
)

USER_PROMPT = """Source columns: customer_id, full_name, email, signup_date, balance
Destination schema:
  customer_id VARCHAR(20) NOT NULL UNIQUE
  full_name VARCHAR(255) NOT NULL
  email VARCHAR(255) NOT NULL UNIQUE
  signup_date DATE NOT NULL
  balance NUMERIC(12,2) NOT NULL

Sample rows:
  00127, Amara Chen, amara.chen@example.com, 03/04/2024, 1200.50
  00128, Diego Fernandez, diego.f@example.com, 2024-03-15, 980.00

Reply with:
{"mappings": [{"source": "...", "destination": "...", "operation": "...", "risk": "..." }]}
Allowed operations: preserve_identifier_as_string, cast_to_integer,
cast_to_decimal, normalize_whitespace, rename_field, parse_date, null_handling.
"""


def masked(key: str) -> str:
    if len(key) < 8:
        return "set"
    return f"{key[:4]}...{key[-4:]}"


def main() -> int:
    print("MoveProof, Nebius Token Factory smoke test")
    print("-" * 52)

    raw_key = os.environ.get("NEBIUS_API_KEY", "").strip()
    if not raw_key:
        print("BLOCKED: NEBIUS_API_KEY is not set.")
        print()
        print("  export NEBIUS_API_KEY='your-key'")
        print("  python scripts/nebius_smoke_test.py")
        print()
        print("Everything else in this repository runs without it.")
        return 2

    print(f"key:      {masked(raw_key)}")
    base_url = os.environ.get("NEBIUS_BASE_URL", "https://api.studio.nebius.com/v1")
    print(f"base url: {base_url}")

    # --- step 1, list the catalogue -------------------------------------
    print()
    print("step 1: list models reachable from this account")
    try:
        config = NebiusConfig(
            api_key=raw_key,
            base_url=base_url,
            model_id=os.environ.get("NEBIUS_MODEL_ID", "placeholder"),
        )
        client = NebiusClient(config)
        models = client.list_models()
    except NebiusUnavailable as exc:
        print(f"  FAILED, transport error: {exc}")
        return 1
    except Exception as exc:
        print(f"  FAILED: {type(exc).__name__}: {exc}")
        return 1

    ids = sorted(model.get("id", "") for model in models)
    print(f"  {len(ids)} model(s) visible")

    candidates = [i for i in ids if any(hint in i.lower() for hint in NVIDIA_HINTS)]
    if candidates:
        print("  NVIDIA candidates:")
        for candidate in candidates:
            print(f"    {candidate}")
    else:
        print("  No obvious NVIDIA model in the list. Full catalogue:")
        for model_id in ids[:40]:
            print(f"    {model_id}")

    # --- step 2, a real inference call -----------------------------------
    model_id = os.environ.get("NEBIUS_MODEL_ID", "").strip()
    if not model_id:
        if not candidates:
            print()
            print("BLOCKED: set NEBIUS_MODEL_ID to one of the ids above and rerun.")
            return 2
        model_id = candidates[0]
        print()
        print(f"  NEBIUS_MODEL_ID not set, trying {model_id}")

    print()
    print(f"step 2: request a mapping proposal from {model_id}")
    client.config.model_id = model_id
    try:
        reply = client.complete_json(SYSTEM_PROMPT, USER_PROMPT, max_tokens=800)
    except NebiusUnavailable as exc:
        print(f"  FAILED: {exc}")
        return 1
    except Exception as exc:
        print(f"  FAILED: {type(exc).__name__}: {exc}")
        return 1

    print(f"  model:      {reply['model']}")
    print(f"  request id: {reply['request_id']}")
    print(f"  usage:      {reply['usage']}")
    print()
    print("  parsed reply:")
    print(json.dumps(reply["content"], indent=2)[:1200])

    print()
    print("-" * 52)
    print("PASSED. A real runtime call to Token Factory succeeded.")
    print(f"Record this in the submission: model {reply['model']}")
    print()
    print("Add to backend/.env:")
    print(f"  NEBIUS_MODEL_ID={model_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
