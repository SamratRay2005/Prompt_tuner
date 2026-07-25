"""
providers/base.py

Responsibility: Define the contract all LLM providers must fulfil.

Design Patterns:
  - Strategy: LLMProvider is the Strategy interface. Each concrete
    provider (Groq, Gemini, OpenAI, ...) is an interchangeable strategy
    that can be swapped at runtime via the ProviderFactory.
  - Template Method: BaseProvider implements the retry/key-rotation
    loop in `complete()`, calling the abstract `_call()` and
    `_parse_response()` hooks that subclasses must override.
  - Value Object: CompletionRequest and CompletionResult are immutable
    data containers. They replace raw dict-passing between layers,
    making the data flowing through the system explicit and type-safe.

SOLID Alignment:
  - Interface Segregation: Providers only need to implement two
    methods — `_call()` and `list_models()`. The retry machinery
    is handled by BaseProvider so subclasses stay lean.
  - Liskov Substitution: Any LLMProvider subclass can be used
    wherever LLMProvider is expected without altering behaviour.
  - Dependency Inversion: app.py depends on LLMProvider (the
    abstraction), never on GroqProvider or GeminiProvider (concretions).
"""

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from providers.http_client import HttpResponse, is_key_specific_error

logger = logging.getLogger(__name__)

_RETRY_SLEEP_SECONDS = 0.3


# ---------------------------------------------------------------------------
# Value Objects
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CompletionRequest:
    """
    Immutable value object carrying everything a provider needs to
    make a single LLM completion call.
    """
    prompt: str
    model: str
    api_keys: tuple[str, ...]       # tuple so it stays hashable / frozen
    system_prompt: str = ""
    temperature: float = 0.7
    max_tokens: int = 1024

    @classmethod
    def from_dict(cls, data: dict) -> "CompletionRequest":
        """Convenience constructor from a raw request dict."""
        keys = tuple(k.strip() for k in data.get("api_keys", []) if k.strip())
        return cls(
            prompt=data["prompt"],
            model=data["model"],
            api_keys=keys,
            system_prompt=data.get("system_prompt", ""),
            temperature=float(data.get("temperature") or 0.7),
            max_tokens=int(data.get("max_tokens") or 1024),
        )


@dataclass(frozen=True)
class CompletionResult:
    """
    Immutable value object carrying the result of a successful
    LLM completion call.
    """
    output: str
    key_index_used: int


# ---------------------------------------------------------------------------
# Abstract Strategy
# ---------------------------------------------------------------------------

class LLMProvider(ABC):
    """
    Abstract base class (Strategy interface) for all LLM providers.

    Subclasses MUST implement:
      - _call(key, req) → HttpResponse
      - _parse_response(resp) → str   (extract the text from the HTTP body)
      - list_models(key) → list[str]
      - provider_name → str           (class-level constant)

    Subclasses MUST NOT override:
      - complete()  ← this is the Template Method with retry logic
    """

    # Concrete subclasses declare this as a class attribute.
    provider_name: str = ""

    # ------------------------------------------------------------------
    # Template Method — do NOT override in subclasses
    # ------------------------------------------------------------------

    def complete(self, req: CompletionRequest, start_index: int) -> CompletionResult:
        """
        Execute the completion with automatic key rotation and retry.

        `start_index` is pre-computed by KeyRotator so concurrent
        requests each begin at a different key.

        Raises:
            RuntimeError: if all keys are exhausted without success.
        """
        num_keys = len(req.api_keys)
        error_details: list[str] = []

        for attempt in range(num_keys):
            try_idx = (start_index + attempt) % num_keys
            key = req.api_keys[try_idx]

            logger.info(
                "API call: provider=%s model=%s key_index=%d attempt=%d/%d",
                self.provider_name, req.model, try_idx, attempt + 1, num_keys,
            )

            try:
                http_resp = self._call(key, req)

                if http_resp.status_code == 200:
                    output_text = self._parse_response(http_resp)
                    return CompletionResult(output=output_text, key_index_used=try_idx)

                # Non-200 response — classify and decide whether to rotate
                logger.warning(
                    "Provider call failed: provider=%s key_index=%d status=%d response=%s",
                    self.provider_name, try_idx, http_resp.status_code, http_resp.text
                )
                
                # Include the response text (first 100 chars) in the error shown to the user
                err_msg = (http_resp.text or "")[:100].replace('\n', ' ')
                error_details.append(f"Key {try_idx}: HTTP {http_resp.status_code} ({err_msg})")

                if is_key_specific_error(http_resp.status_code, http_resp.text):
                    time.sleep(_RETRY_SLEEP_SECONDS)
                    continue
                else:
                    # Non-key error (bad prompt, invalid model, etc.) — fail fast
                    break

            except Exception:
                logger.warning(
                    "Provider call raised exception: provider=%s key_index=%d",
                    self.provider_name, try_idx,
                )
                error_details.append(f"Key {try_idx}: connection error")
                time.sleep(_RETRY_SLEEP_SECONDS)
                continue

        combined = " | ".join(error_details) or "All keys exhausted"
        raise RuntimeError(combined)

    # ------------------------------------------------------------------
    # Abstract hooks — subclasses implement these
    # ------------------------------------------------------------------

    @abstractmethod
    def _call(self, key: str, req: CompletionRequest) -> HttpResponse:
        """
        Make a single HTTP call to the provider's completion endpoint.

        Args:
            key: The API key to use for this specific attempt.
            req: The full completion request.

        Returns:
            An HttpResponse regardless of status code. Raise only on
            network-level failures (timeout, DNS error, etc.).
        """

    @abstractmethod
    def _parse_response(self, resp: HttpResponse) -> str:
        """
        Extract the generated text from a successful (200) HTTP response.

        Args:
            resp: A guaranteed-200 HttpResponse from _call().

        Returns:
            The plain-text output from the model.

        Raises:
            ValueError: if the response body structure is unexpected.
        """

    @abstractmethod
    def list_models(self, key: str) -> list[str]:
        """
        Fetch and return the list of available model IDs for this provider.

        Args:
            key: A single API key to authenticate the request.

        Returns:
            A list of model identifier strings (e.g., ["gemini-1.5-flash"]).

        Raises:
            RuntimeError: if the provider API returns a non-200 response.
        """
