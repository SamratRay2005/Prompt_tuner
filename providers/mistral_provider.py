"""
providers/mistral_provider.py

Responsibility: Implement the LLMProvider Strategy for the Mistral API.

This file contains ONLY Mistral-specific knowledge:
  - The Mistral API base URL
  - How to build Mistral's OpenAI-compatible chat-completions payload
  - How to parse Mistral's response structure
  - How to list Mistral models

Nothing about retry logic, key rotation, or Flask lives here.
Those concerns are handled by BaseProvider and app.py respectively.
"""

from providers.base import CompletionRequest, LLMProvider
from providers.http_client import HttpResponse, make_http_request

_COMPLETIONS_URL = "https://api.mistral.ai/v1/chat/completions"
_MODELS_URL = "https://api.mistral.ai/v1/models"


class MistralProvider(LLMProvider):
    """
    Concrete Strategy for Mistral's Chat Completions API.

    Mistral uses the standard OpenAI messages format, so the payload
    construction is straightforward.
    """

    provider_name = "mistral"

    def _call(self, key: str, req: CompletionRequest) -> HttpResponse:
        """Build and fire the Mistral chat/completions request."""
        messages = []
        if req.system_prompt:
            messages.append({"role": "system", "content": req.system_prompt})
        messages.append({"role": "user", "content": req.prompt})

        # Mistral API restricts temperature to a maximum of 1.5
        # The UI slider allows up to 2.0, so we clamp it to prevent 422 errors.
        mistral_temp = max(0.0, min(req.temperature, 1.5))

        payload = {
            "model": req.model,
            "messages": messages,
            "temperature": mistral_temp,
            "max_tokens": req.max_tokens,
        }

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        return make_http_request(
            _COMPLETIONS_URL,
            method="POST",
            headers=headers,
            payload=payload,
            timeout=30,
        )

    def _parse_response(self, resp: HttpResponse) -> str:
        """Extract generated text from Mistral's response."""
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    def list_models(self, key: str) -> list[str]:
        """
        Fetch all available Mistral models.

        Returns a flat list of model ID strings.
        Raises RuntimeError on non-200 response.
        """
        headers = {"Authorization": f"Bearer {key}"}
        resp = make_http_request(_MODELS_URL, method="GET", headers=headers, timeout=10)

        if resp.status_code != 200:
            raise RuntimeError(f"Mistral models API returned HTTP {resp.status_code}")

        data = resp.json()
        return [item["id"] for item in data.get("data", [])]
