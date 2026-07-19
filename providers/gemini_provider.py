"""
providers/gemini_provider.py

Responsibility: Implement the LLMProvider Strategy for Google's Gemini API.

This file contains ONLY Gemini-specific knowledge:
  - The Gemini generateContent endpoint structure
  - Gemini's unique payload format (contents/parts, systemInstruction)
  - The nested response parsing (candidates → content → parts → text)
  - How to list Gemini models and filter for generateContent support

Nothing about retry logic, key rotation, or Flask lives here.
"""

from providers.base import CompletionRequest, LLMProvider
from providers.http_client import HttpResponse, make_http_request

_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider(LLMProvider):
    """
    Concrete Strategy for Google's Gemini GenerateContent API.

    Gemini uses a different payload format from OpenAI: prompt text
    is nested inside contents[].parts[], and the system prompt goes
    in a top-level `systemInstruction` field.
    """

    provider_name = "gemini"

    def _call(self, key: str, req: CompletionRequest) -> HttpResponse:
        """Build and fire the Gemini generateContent request."""
        url = f"{_BASE_URL}/models/{req.model}:generateContent?key={key}"

        payload: dict = {
            "contents": [{"parts": [{"text": req.prompt}]}],
            "generationConfig": {
                "temperature": req.temperature,
                "maxOutputTokens": req.max_tokens,
            },
        }

        if req.system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": req.system_prompt}]}

        return make_http_request(
            url,
            method="POST",
            headers={"Content-Type": "application/json"},
            payload=payload,
            timeout=30,
        )

    def _parse_response(self, resp: HttpResponse) -> str:
        """
        Extract generated text from Gemini's nested candidates structure.

        Gemini response shape:
          { "candidates": [{ "content": { "parts": [{ "text": "..." }] } }] }

        Raises:
            ValueError: if the expected structure is absent (e.g., safety filter
                        blocked the response and returned no candidates).
        """
        data = resp.json()
        candidates = data.get("candidates", [])
        if not candidates:
            raise ValueError("Gemini returned no candidates (possibly blocked by safety filters)")

        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            raise ValueError("Gemini candidate contained no content parts")

        return parts[0].get("text", "")

    def list_models(self, key: str) -> list[str]:
        """
        Fetch all Gemini models that support generateContent.

        Gemini returns model names as "models/gemini-1.5-flash"; we strip
        the "models/" prefix before returning so the caller gets clean IDs.

        Returns a list of model ID strings.
        Raises RuntimeError on non-200 response.
        """
        url = f"{_BASE_URL}/models?key={key}"
        resp = make_http_request(url, method="GET", timeout=10)

        if resp.status_code != 200:
            raise RuntimeError(f"Gemini models API returned HTTP {resp.status_code}")

        data = resp.json()
        models: list[str] = []
        for item in data.get("models", []):
            # Only surface models that actually support text generation
            if "generateContent" not in item.get("supportedGenerationMethods", []):
                continue
            name: str = item.get("name", "")
            if name.startswith("models/"):
                name = name[len("models/"):]
            models.append(name)

        return models
