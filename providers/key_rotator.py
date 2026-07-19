"""
providers/key_rotator.py

Responsibility: Thread-safe, per-provider API key index rotation.

Design Patterns:
  - Singleton: Only one KeyRotator instance exists per process.
    All provider instances share the same rotator so round-robin
    distribution is correct even across concurrent requests.
  - Single Responsibility: This class has exactly one job —
    atomically pick and advance the next key index.

Thread Safety:
  The lock is held only during the index lookup and increment,
  not during the network call. This means N concurrent requests
  can be in-flight simultaneously using N different keys.
"""

import threading


class KeyRotator:
    """
    Thread-safe round-robin API key selector.

    Usage:
        rotator = KeyRotator.instance()
        start_index = rotator.next_index("groq", num_keys=3)
        # start_index is already incremented; other threads will get
        # a different starting point even if they arrive simultaneously.
    """

    _instance: "KeyRotator | None" = None
    _creation_lock = threading.Lock()

    def __init__(self) -> None:
        self._index_lock = threading.Lock()
        # Maps provider_name → current counter (wraps at 1_000_000)
        self._counters: dict[str, int] = {}

    @classmethod
    def instance(cls) -> "KeyRotator":
        """Return the process-wide singleton instance (lazy, thread-safe)."""
        if cls._instance is None:
            with cls._creation_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def next_index(self, provider: str, num_keys: int) -> int:
        """
        Atomically claim and advance the key index for `provider`.

        The index is incremented *before* any network call begins,
        so concurrent threads each get a unique starting key.

        Returns:
            The index (0-based) into the caller's api_keys list to
            start from for this request.
        """
        with self._index_lock:
            raw = self._counters.get(provider, 0)
            self._counters[provider] = (raw + 1) % 1_000_000
        return raw % num_keys
