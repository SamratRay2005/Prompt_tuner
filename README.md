<parameter name="CodeContent"># Prompt Tuner

> **A self-hosted, privacy-first batch testing tool for LLM prompts.**

Write a parameterized prompt once. Supply hundreds of variable combinations via CSV. Run them all against Gemini or Groq — in parallel — and compare outputs side-by-side in a spreadsheet-style view.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SamratRay2005/Prompt_tuner)

---

## ✨ Features

- **Parameterized Templates** — Write prompts using `{variable}` syntax (e.g., `Summarize {topic} in a {tone} tone`).
- **Manual Mode** — Fill in one set of values, add to the test table, run on demand.
- **CSV Batch Mode** — Upload a CSV; each row becomes a test case. One click runs all of them.
- **Concurrent Execution** — Up to 3 LLM calls run in parallel, maximizing throughput without triggering rate limits.
- **Multi-Key Round-Robin** — Paste multiple API keys (one per line). The backend distributes requests across them using a thread-safe rotating index.
- **Inline Editing** — Edit any test row's variable values directly in the table without re-uploading.
- **Export to CSV** — Download all results (inputs + outputs + metadata) as a CSV for offline analysis.
- **Privacy-First** — API keys and prompt content are never written to server logs, files, or a database. Everything is processed in-memory.

---

## 🚀 Quick Start

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/SamratRay2005/Prompt_tuner
cd Prompt_tuner

# 2. Install dependencies
pip install flask

# 3. Run
python3 app.py
```

Open **http://localhost:5005** in your browser.

### Deploy to Vercel (One Click)

Click the button above, or follow these steps manually:

```bash
# Install the Vercel CLI
npm i -g vercel

# From the project root
vercel
```

Follow the prompts. Vercel auto-detects the `vercel.json` configuration and deploys the Flask app as a serverless function. No extra configuration needed.

---

## 📖 Usage Guide

See the **[in-app guide](/help)** for full step-by-step instructions with visuals.

**Quick reference:**
1. Select a **Provider** (Gemini or Groq) and paste your **API Key(s)**.
2. Choose a **Model** from the dropdown (auto-fetched from the provider).
3. Write your **Prompt Template** using `{variable}` placeholders.
4. Choose **Manual** (single run) or **CSV** (bulk run) mode.
5. Click **"Add to Test Table"** — rows appear with `idle` status.
6. Click **"Run All"** or select specific rows and click **"Run Selected"**.
7. Click any output cell to read the full response. Click **"Export CSV"** to download all results.

---

## 🏗️ Architecture

```
prompt_tuner/
├── app.py                      # Flask thin controller (routing only)
├── providers/
│   ├── base.py                 # LLMProvider ABC + Value Objects
│   ├── groq_provider.py        # Groq Strategy implementation
│   ├── gemini_provider.py      # Gemini Strategy implementation
│   ├── registry.py             # ProviderFactory (Open/Closed)
│   ├── key_rotator.py          # Thread-safe Singleton key rotation
│   └── http_client.py          # urllib wrapper (no third-party HTTP lib)
├── templates/
│   ├── index.html              # Main app page
│   └── help.html               # Usage guide page
├── static/
│   ├── style.css               # Full CSS design system
│   └── script.js               # All frontend logic (Vanilla JS)
├── api/index.py                # Vercel serverless wrapper
└── vercel.json                 # Vercel routing + security headers
```

**Design Patterns:** Strategy, Factory, Template Method, Singleton, Value Object  
**SOLID:** Each class has one reason to change. Adding a new provider requires no changes to existing files.

---

## ➕ Adding a New LLM Provider

1. Create `providers/your_provider.py`:

```python
from providers.base import CompletionRequest, LLMProvider
from providers.http_client import HttpResponse, make_http_request

class YourProvider(LLMProvider):
    provider_name = "yourprovider"

    def _call(self, key: str, req: CompletionRequest) -> HttpResponse:
        # Build and fire the HTTP request
        ...

    def _parse_response(self, resp: HttpResponse) -> str:
        # Extract the generated text from the response body
        return resp.json()["your"]["nested"]["text"]

    def list_models(self, key: str) -> list[str]:
        # Fetch available model IDs
        ...
```

2. Register it in `providers/registry.py`:

```python
_REGISTRY = {
    "groq":         GroqProvider,
    "gemini":       GeminiProvider,
    "yourprovider": YourProvider,   # ← one line
}
```

That's it. No other files change.

---

## 🔒 Security

| Layer | Protection |
|---|---|
| API keys in POST body | Never appear in URLs, access logs, or browser history |
| Zero server-side logging of keys or prompts | Vercel Function Logs show only `provider=X model=Y key_index=N` |
| HTTP Security Headers | `X-Frame-Options`, `CSP`, `X-Content-Type-Options`, `Referrer-Policy` |
| `Cache-Control: no-store` | LLM responses are never cached by browsers or CDNs |
| No database | Zero persistence — everything lives in browser memory |
| `credentials: same-origin` | Fetch calls are strictly same-origin |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3 + Flask |
| HTTP Client | `urllib` (stdlib only, zero extra dependencies) |
| Frontend | Vanilla JavaScript (no framework) |
| CSV Parsing | PapaParse 5.4.1 (CDN) |
| Icons | Font Awesome 6.4.0 |
| Fonts | Google Fonts (Inter, Outfit, JetBrains Mono) |
| Production | Vercel (serverless Python) |

---

## 📄 License

MIT — free to use, modify, and distribute.
