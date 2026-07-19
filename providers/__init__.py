"""
providers/__init__.py

Re-exports the public API of the providers package.
Callers (primarily app.py) import only from this file:

    from providers import ProviderFactory, CompletionRequest, KeyRotator

This keeps internal module organisation invisible to the outside world
and lets us refactor the package structure without breaking imports.
"""

from providers.base import CompletionRequest, CompletionResult, LLMProvider
from providers.key_rotator import KeyRotator
from providers.registry import ProviderFactory

__all__ = [
    "CompletionRequest",
    "CompletionResult",
    "LLMProvider",
    "KeyRotator",
    "ProviderFactory",
]
