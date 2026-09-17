"""Nebius Token Factory client.

Inference runs on Nebius and nowhere else. Google Cloud in this architecture
provides hosting and storage only; routing model calls through Vertex AI or any
other provider would put the project outside the hackathon rules regardless of
output quality.

Model output is untrusted. This module returns parsed JSON and never executes
anything. Validation against the operation allowlist happens in
app.domain.plan.validate_plan, which every proposal passes through before a
human or the executor sees it.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

DEFAULT_BASE_URL = "https://api.studio.nebius.com/v1"
REQUEST_TIMEOUT_SECONDS = 60


class NebiusNotConfigured(Exception):
    """Raised when no credential is present. Never falls back to another provider."""


class NebiusUnavailable(Exception):
    """Raised on timeout or transport failure, so a caller can offer a retry."""


@dataclass
class NebiusConfig:
    api_key: str
    base_url: str
    model_id: str

    @classmethod
    def from_env(cls) -> "NebiusConfig":
        api_key = os.environ.get("NEBIUS_API_KEY", "").strip()
        if not api_key:
            raise NebiusNotConfigured(
                "NEBIUS_API_KEY is not set. Put it in backend/.env or export it. "
                "Never place it in a NEXT_PUBLIC_ variable."
            )
        model_id = os.environ.get("NEBIUS_MODEL_ID", "").strip()
        if not model_id:
            raise NebiusNotConfigured(
                "NEBIUS_MODEL_ID is not set. Run scripts/nebius_smoke_test.py "
                "to list the models your account can reach, then set one."
            )
        return cls(
            api_key=api_key,
            base_url=os.environ.get("NEBIUS_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
            model_id=model_id,
        )


def is_configured() -> bool:
    return bool(os.environ.get("NEBIUS_API_KEY")) and bool(
        os.environ.get("NEBIUS_MODEL_ID")
    )


class NebiusClient:
    def __init__(self, config: NebiusConfig | None = None) -> None:
        self.config = config or NebiusConfig.from_env()

    @classmethod
    def for_model(cls, model_id: str) -> "NebiusClient":
        """A client pinned to one model, sharing the configured credential.

        Used by the escalation path so a deeper proposal reaches a different
        model over the same authenticated boundary. Only the model id differs;
        the key, the base URL and the JSON-only contract are unchanged.
        """
        from dataclasses import replace

        return cls(replace(NebiusConfig.from_env(), model_id=model_id))

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json",
        }

    def list_models(self) -> list[dict[str, Any]]:
        import httpx

        try:
            response = httpx.get(
                f"{self.config.base_url}/models",
                headers=self._headers(),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise NebiusUnavailable(str(exc)) from exc
        response.raise_for_status()
        return response.json().get("data", [])

    def complete_json(
        self, system_prompt: str, user_prompt: str, max_tokens: int = 2000
    ) -> dict[str, Any]:
        """Ask for a JSON object and parse it.

        A reply that is not valid JSON is an error, not something to repair by
        guessing. The caller surfaces the failure and keeps the user's work.
        """
        import httpx

        payload = {
            "model": self.config.model_id,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
        }
        try:
            response = httpx.post(
                f"{self.config.base_url}/chat/completions",
                headers=self._headers(),
                json=payload,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise NebiusUnavailable(
                f"Token Factory did not respond: {exc}"
            ) from exc

        response.raise_for_status()
        body = response.json()
        content = body["choices"][0]["message"]["content"]

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise NebiusUnavailable(
                "The model returned text that is not valid JSON."
            ) from exc

        return {
            "content": parsed,
            "model": body.get("model", self.config.model_id),
            "request_id": body.get("id"),
            "usage": body.get("usage", {}),
        }
