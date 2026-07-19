"""
providers/groq_provider.py

Responsibility: Implement the LLMProvider Strategy for the Groq API.

This file contains ONLY Groq-specific knowledge:
  - The Groq API base URL
  - How to build Groq's OpenAI-compatible chat-completions payload
  - How to parse Groq's response structure
  - How to list Groq models

Nothing about retry logic, key rotation, or Flask lives here.
Those concerns are handled by BaseProvider and app.py respectively.
"""

from providers.base import CompletionRequest, LLMProvider
from providers.http_client import HttpResponse, make_http_request

_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"
_MODELS_URL = "https://api.groq.com/openai/v1/models"


class GroqProvider(LLMProvider):
    """
    Concrete Strategy for Groq's OpenAI-compatible Chat Completions API.

    Groq uses the standard OpenAI messages format, so the payload
    construction is straightforward.
    """

    provider_name = "groq"

    def _call(self, key: str, req: CompletionRequest) -> HttpResponse:
        """Build and fire the Groq chat/completions request."""
        messages = []
        if req.system_prompt:
            messages.append({"role": "system", "content": req.system_prompt})
        messages.append({"role": "user", "content": req.prompt})

        payload = {
            "model": req.model,
            "messages": messages,
            "temperature": req.temperature,
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
        """Extract generated text from Groq's OpenAI-format response."""
        data = resp.json()
        return data["choices"][0]["message"]["content"]

    def list_models(self, key: str) -> list[str]:
        """
        Fetch all available Groq models.

        Returns a flat list of model ID strings.
        Raises RuntimeError on non-200 response.
        """
        headers = {"Authorization": f"Bearer {key}"}
        resp = make_http_request(_MODELS_URL, method="GET", headers=headers, timeout=10)

        if resp.status_code != 200:
            raise RuntimeError(f"Groq models API returned HTTP {resp.status_code}")

        data = resp.json()
        return [item["id"] for item in data.get("data", [])]
