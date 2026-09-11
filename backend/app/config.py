"""Runtime configuration.

Every value is read from the environment with a safe default for local work.
Nothing here has a default that would be dangerous in production: the database
points at localhost, uploads are capped, and the Nebius key has no default at
all so a missing credential fails loudly instead of silently degrading.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _list_env(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name, "")
    if not raw.strip():
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass
class Settings:
    database_url: str = field(
        default_factory=lambda: os.environ.get(
            "DATABASE_URL",
            "postgresql://moveproof:moveproof_local_only@localhost:5433/moveproof",
        )
    )
    max_upload_bytes: int = field(
        default_factory=lambda: _int_env("MAX_UPLOAD_BYTES", 25 * 1024 * 1024)
    )
    request_timeout_seconds: int = field(
        default_factory=lambda: _int_env("REQUEST_TIMEOUT_SECONDS", 60)
    )
    # Rows sent to the model. A schema summary plus a small sample is enough to
    # propose a mapping, and the interface says that is all that leaves the
    # backend, so the code has to enforce it.
    model_sample_rows: int = field(
        default_factory=lambda: _int_env("MODEL_SAMPLE_ROWS", 5)
    )
    cors_origins: list[str] = field(
        default_factory=lambda: _list_env(
            "CORS_ORIGINS", ["http://localhost:3000", "http://127.0.0.1:3000"]
        )
    )
    operator: str = field(
        default_factory=lambda: os.environ.get("MOVEPROOF_OPERATOR", "operator")
    )

    @property
    def nebius_configured(self) -> bool:
        return bool(os.environ.get("NEBIUS_API_KEY")) and bool(
            os.environ.get("NEBIUS_MODEL_ID")
        )


settings = Settings()
