"""
app.py — Flask Application Entry Point

Responsibility: HTTP routing and request/response serialisation only.
               This file knows nothing about Groq, Gemini, or any other
               LLM provider — that is the providers package's concern.

Architecture: Thin Controller
  - Validates incoming HTTP requests (required fields, types).
  - Delegates all business logic to the providers package.
  - Serialises results back to JSON.
  - Handles security response headers via @after_request middleware.

Design: Dependency Inversion
  This module depends on the LLMProvider abstraction (ProviderFactory),
  never on GroqProvider or GeminiProvider concretions.
"""

import logging
import os

from flask import Flask, jsonify, render_template, request

from providers import CompletionRequest, KeyRotator, ProviderFactory

# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------

app = Flask(__name__, template_folder="templates", static_folder="static")

# Logging — intentionally avoids logging any user data (keys, prompts, outputs)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Security middleware
# ---------------------------------------------------------------------------

@app.after_request
def add_security_headers(response):
    """
    Inject HTTP security headers on every response.

    These headers apply to local development. In Vercel production,
    the same headers are also injected at the edge layer via vercel.json,
    providing defence-in-depth.
    """
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-DNS-Prefetch-Control"] = "off"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

    if request.path.startswith("/api/"):
        # Prevent browsers and CDN edges from caching API responses
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"

    return response


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/help")
def help_page():
    return render_template("help.html")


@app.route("/api/models", methods=["POST"])
def get_models():
    """
    Fetch the list of available models for a given provider.

    Request body (JSON):
        provider  str  — e.g. "groq" or "gemini"
        key       str  — a single API key for authentication

    The key travels in the POST body (never a URL query param) so it
    does not appear in server access logs, browser history, or CDN logs.
    """
    body = request.json or {}
    provider_name = body.get("provider", "").lower().strip()
    key = body.get("key", "").strip()

    if not provider_name or not key:
        return jsonify({"error": "Missing required fields: provider, key"}), 400

    try:
        provider = ProviderFactory.get(provider_name)
        models = provider.list_models(key)
        return jsonify({"models": models})
    except ValueError as e:
        # Unknown provider name
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        # Provider API returned an error (non-200)
        logger.warning("Model fetch failed: provider=%s", provider_name)
        return jsonify({"error": str(e)}), 502
    except Exception:
        logger.warning("Unexpected error fetching models: provider=%s", provider_name)
        return jsonify({"error": "Failed to fetch models from provider"}), 500


@app.route("/api/run", methods=["POST"])
def run_prompt():
    """
    Execute a single LLM completion with key rotation and retry.

    Request body (JSON):
        provider      str        — e.g. "groq" or "gemini"
        model         str        — model identifier
        prompt        str        — the fully hydrated user prompt
        system_prompt str?       — optional system instruction
        api_keys      str[]      — one or more API keys for round-robin
        temperature   float?     — sampling temperature (default 0.7)
        max_tokens    int?       — max output tokens (default 1024)

    Response (200):
        { "output": str, "key_index_used": int }

    Response (4xx/5xx):
        { "error": str }
    """
    body = request.json or {}

    # --- Input validation ---
    provider_name = body.get("provider", "").lower().strip()
    if not provider_name:
        return jsonify({"error": "Missing required field: provider"}), 400
    if not body.get("model"):
        return jsonify({"error": "Missing required field: model"}), 400
    if not body.get("prompt"):
        return jsonify({"error": "Missing required field: prompt"}), 400
    if not body.get("api_keys"):
        return jsonify({"error": "Missing required field: api_keys"}), 400

    # --- Resolve provider strategy ---
    try:
        provider = ProviderFactory.get(provider_name)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    # --- Build typed value object ---
    try:
        req = CompletionRequest.from_dict(body)
    except (KeyError, ValueError) as e:
        return jsonify({"error": f"Invalid request parameters: {e}"}), 400

    if not req.api_keys:
        return jsonify({"error": "All provided api_keys are empty or whitespace"}), 400

    # --- Rotate key index before any I/O (Singleton, thread-safe) ---
    rotator = KeyRotator.instance()
    start_index = rotator.next_index(provider_name, num_keys=len(req.api_keys))

    # --- Delegate execution to the provider Strategy ---
    try:
        result = provider.complete(req, start_index)
        return jsonify({
            "output": result.output,
            "key_index_used": result.key_index_used,
        })
    except RuntimeError as e:
        # All keys exhausted or non-key error from provider
        return jsonify({"error": str(e)}), 502
    except Exception:
        logger.warning("Unexpected error during completion: provider=%s", provider_name)
        return jsonify({"error": "An unexpected server error occurred"}), 500


# ---------------------------------------------------------------------------
# Development server entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    os.makedirs("templates", exist_ok=True)
    os.makedirs("static", exist_ok=True)

    port = int(os.environ.get("PORT", 5005))
    is_debug = os.environ.get("FLASK_DEBUG", "0") == "1"

    logger.info("Starting Prompt Tuner server on http://localhost:%d", port)
    app.run(host="0.0.0.0", port=port, debug=is_debug)
