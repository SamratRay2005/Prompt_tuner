"""
providers/registry.py

Responsibility: Map provider name strings to their concrete Strategy classes.

Design Patterns:
  - Factory (specifically: Factory Method via ProviderFactory.get())
    Decouples the Flask routes from concrete provider classes. Routes ask
    for "groq" or "gemini" by name — they never import or instantiate a
    provider class directly.

SOLID — Open/Closed Principle:
  To add a new provider (e.g., OpenAI, Anthropic, Cohere):
    1. Create providers/openai_provider.py implementing LLMProvider
    2. Add one entry to _REGISTRY below: "openai": OpenAIProvider
  ↑ That is the ONLY change required. All existing code is untouched. ↑

Note on provider instances:
  Providers are stateless (all state lives in CompletionRequest and
  KeyRotator), so we cache a single instance per provider name.
  This avoids unnecessary object creation on every request.
"""

from typing import TYPE_CHECKING

from providers.gemini_provider import GeminiProvider
from providers.groq_provider import GroqProvider
from providers.mistral_provider import MistralProvider

if TYPE_CHECKING:
    from providers.base import LLMProvider

# ---------------------------------------------------------------------------
# ✅ TO ADD A NEW PROVIDER: add one entry here.
# ---------------------------------------------------------------------------
_REGISTRY: dict[str, type["LLMProvider"]] = {
    "groq": GroqProvider,
    "gemini": GeminiProvider,
    "mistral": MistralProvider,
    # "openai":    OpenAIProvider,    ← example future entry
    # "anthropic": AnthropicProvider, ← example future entry
    # "cohere":    CohereProvider,    ← example future entry
}

# Cached instances (providers are stateless, safe to reuse)
_INSTANCES: dict[str, "LLMProvider"] = {}


class ProviderFactory:
    """
    Factory for obtaining LLMProvider instances by name.

    All interaction with specific provider classes goes through this
    class, keeping the rest of the codebase provider-agnostic.
    """

    @staticmethod
    def get(name: str) -> "LLMProvider":
        """
        Return a (cached) LLMProvider instance for the given provider name.

        Args:
            name: Case-insensitive provider identifier (e.g., "groq", "gemini").

        Returns:
            An LLMProvider instance ready to call .complete() or .list_models().

        Raises:
            ValueError: if the provider name is not registered.
        """
        key = name.lower().strip()
        if key not in _REGISTRY:
            supported = ", ".join(sorted(_REGISTRY.keys()))
            raise ValueError(
                f"Unknown provider '{name}'. Supported providers: {supported}"
            )

        if key not in _INSTANCES:
            _INSTANCES[key] = _REGISTRY[key]()

        return _INSTANCES[key]

    @staticmethod
    def supported_providers() -> list[str]:
        """Return the list of registered provider names."""
        return sorted(_REGISTRY.keys())
