"""
providers/http_client.py

Responsibility: Raw HTTP transport layer.
- Wraps Python's stdlib urllib with a requests-like interface.
- Provides the is_key_specific_error() classifier used by all providers.

Design: This module has no knowledge of any LLM provider. It is a
pure infrastructure utility. Providers depend on it via composition,
never by subclassing (Dependency Inversion Principle).
"""

import json
import urllib.request
import urllib.error


class HttpResponse:
    """
    Value Object — a lightweight, provider-agnostic HTTP response.
    Mimics the requests.Response surface used downstream.
    """

    def __init__(self, status_code: int, text: str) -> None:
        self.status_code = status_code
        self.text = text

    def json(self) -> dict:
        return json.loads(self.text)

    def __repr__(self) -> str:
        return f"HttpResponse(status_code={self.status_code})"


_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

# Status codes that definitively indicate the API key itself is the problem.
_KEY_ERROR_STATUS_CODES = frozenset({401, 403, 429})

# Response-body substrings that indicate a key-level failure regardless of status.
_KEY_ERROR_INDICATORS = frozenset({
    "quota", "rate limit", "rate_limit", "exhausted",
    "insufficient_funds", "invalid api key", "invalid_api_key",
    "unauthorized", "key expired", "developer key",
})


def make_http_request(
    url: str,
    method: str = "GET",
    headers: dict | None = None,
    payload: dict | None = None,
    timeout: int = 30,
) -> HttpResponse:
    """
    Make an HTTP request using Python's built-in urllib.

    Returns an HttpResponse regardless of success or HTTP error status.
    Raises on network-level failures (timeouts, DNS errors, etc.) so
    callers can handle them separately from HTTP-level errors.
    """
    if headers is None:
        headers = {}

    data: bytes | None = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"

    if "User-Agent" not in headers:
        headers["User-Agent"] = _DEFAULT_USER_AGENT

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return HttpResponse(resp.getcode(), resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # HTTP errors (4xx, 5xx) are returned as HttpResponse, not re-raised,
        # so callers can inspect the status code and body for error classification.
        return HttpResponse(e.code, e.read().decode("utf-8"))
    # All other exceptions (URLError, TimeoutError, etc.) propagate upward.


def is_key_specific_error(status_code: int, response_text: str) -> bool:
    """
    Determine whether an API failure is caused by the key itself.

    Key-specific errors warrant rotating to the next available key.
    Non-key errors (e.g., 400 Bad Request for a malformed prompt)
    should be returned immediately without wasting retries.
    """
    if status_code in _KEY_ERROR_STATUS_CODES:
        return True

    text_lower = response_text.lower()
    return any(indicator in text_lower for indicator in _KEY_ERROR_INDICATORS)
