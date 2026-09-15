"""The Tavily client.

A thin wrapper over Tavily's search API. It does three things: call the
provider, bound what comes back, and make sure nothing sensitive escapes in
either direction.

The credential lives only in this process. It is read from the environment,
sent in an Authorization header, and never written into a response, an event,
a log line or an exception message. `TavilyError` messages are composed here
rather than passed through from the provider, because an upstream error body
can contain the request it was given, including its headers.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any

from app.config import settings

SEARCH_PATH = "/search"


class TavilyNotConfigured(Exception):
    """No credential is present. Never falls back to another provider."""


class TavilyUnavailable(Exception):
    """A timeout, a transport failure or an upstream error.

    The message is written here, not copied from the provider, so a response
    body that echoes the request cannot carry a key into a log.
    """


class TavilyMalformedResponse(Exception):
    """The provider answered with something this client cannot read."""


@dataclass(frozen=True)
class EvidenceSource:
    """One external reference, reduced to stable public fields."""

    title: str
    url: str
    domain: str
    excerpt: str
    published_at: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "url": self.url,
            "domain": self.domain,
            "excerpt": self.excerpt,
            "published_at": self.published_at,
        }


def _text(value: Any, limit: int) -> str:
    """Normalise and cap a provider string.

    Control characters are removed rather than escaped. A title is going into
    an interface and a report, and a stray control byte there is a rendering
    bug waiting to happen.
    """
    if value is None:
        return ""
    text = unicodedata.normalize("NFC", str(value)).strip()
    text = "".join(ch for ch in text if ch.isprintable() or ch == " ")
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0] + "…"
    return text


def _domain(url: str) -> str:
    """The host, for display. Never raises on a malformed URL."""
    from urllib.parse import urlparse

    try:
        host = urlparse(url).netloc
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _is_http_url(url: str) -> bool:
    """Only http and https reach the browser as a link.

    A provider returning a javascript: or data: URL would otherwise become a
    clickable link in a review screen.
    """
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def search(query: str, max_results: int | None = None) -> list[EvidenceSource]:
    """Ask Tavily one question and return bounded, typed sources.

    Raises rather than returning a partial answer, so a caller cannot mistake
    an upstream failure for "no evidence found". Those two mean very different
    things to somebody deciding whether a leading zero matters.
    """
    if not settings.tavily_configured:
        raise TavilyNotConfigured(
            "TAVILY_API_KEY is not set on the backend. External Evidence Check "
            "is unavailable until it is."
        )

    limit = max(1, min(max_results or settings.tavily_max_results,
                       settings.tavily_max_results))

    import httpx

    payload = {
        "query": query,
        "max_results": limit,
        "search_depth": "basic",
        "include_answer": False,
        "include_raw_content": False,
        "include_images": False,
    }

    try:
        response = httpx.post(
            f"{settings.tavily_base_url}{SEARCH_PATH}",
            json=payload,
            headers={
                "Authorization": f"Bearer {settings.tavily_api_key}",
                "Content-Type": "application/json",
            },
            timeout=settings.tavily_timeout_seconds,
        )
    except httpx.TimeoutException as exc:
        raise TavilyUnavailable(
            f"The external evidence provider did not respond within "
            f"{settings.tavily_timeout_seconds} seconds. Your review is "
            "unchanged and the check can be retried."
        ) from exc
    except httpx.HTTPError as exc:
        # The exception type is safe to name. Its string form is not, because
        # httpx includes the request, and the request carries the header.
        raise TavilyUnavailable(
            f"The external evidence provider could not be reached "
            f"({type(exc).__name__}). Your review is unchanged."
        ) from exc

    if response.status_code == 401 or response.status_code == 403:
        raise TavilyNotConfigured(
            "The external evidence provider rejected the credential. Check "
            "TAVILY_API_KEY on the backend."
        )
    if response.status_code >= 400:
        raise TavilyUnavailable(
            f"The external evidence provider returned status "
            f"{response.status_code}. Your review is unchanged."
        )

    try:
        body = response.json()
    except ValueError as exc:
        raise TavilyMalformedResponse(
            "The external evidence provider returned a response that is not JSON."
        ) from exc

    if not isinstance(body, dict):
        raise TavilyMalformedResponse(
            "The external evidence provider returned an unexpected response shape."
        )

    raw_results = body.get("results")
    if raw_results is None:
        return []
    if not isinstance(raw_results, list):
        raise TavilyMalformedResponse(
            "The external evidence provider returned an unexpected results shape."
        )

    sources: list[EvidenceSource] = []
    for entry in raw_results:
        if not isinstance(entry, dict):
            continue
        url = _text(entry.get("url"), 2048)
        if not _is_http_url(url):
            continue
        title = _text(entry.get("title"), 200) or _domain(url) or "Untitled source"
        excerpt = _text(entry.get("content"), settings.tavily_max_excerpt_chars)
        published = entry.get("published_date")
        sources.append(
            EvidenceSource(
                title=title,
                url=url,
                domain=_domain(url),
                excerpt=excerpt,
                published_at=_text(published, 40) or None,
            )
        )
        if len(sources) >= limit:
            break

    return sources
