# LyricPad Next v0.6 — Render Edition

LyricPad Next v0.6 is the first build prepared for a permanent hosted HTTPS deployment on Render while still running locally for development.

## What changed

- Render-compatible `PORT` + `0.0.0.0` server binding
- `/health` endpoint for Render health checks
- `render.yaml` Blueprint
- `.gitignore` protects `.env`, certificates, and local dependencies
- Hosted/PWA access panel automatically shows the public URL
- OpenAI requests remain server-side; the API key is never sent to the browser
- Optional `APP_ACCESS_KEY` protects the hosted AI proxy from unauthorized use
- PWA cache bumped to v0.6
- Local development and Ollama support remain available

## Recommended Render deployment

### 1. Put this folder in GitHub

Create a GitHub repository and commit the contents of this folder. Do **not** add a real `.env` file. `.gitignore` already excludes it.

### 2. Create the service on Render

You can either:

- use Render **New → Blueprint** and select the repository (Render reads `render.yaml`), or
- create a Node **Web Service** manually.

Manual settings:

```text
Build command: npm install
Start command: npm start
Health check: /health
```

Do not manually set `PORT` on Render. Render supplies it.

### 3. Add environment variables in Render

Required for OpenAI:

```text
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5-mini
```

Strongly recommended:

```text
APP_ACCESS_KEY=make-this-a-long-random-private-string
```

The public frontend itself contains no OpenAI key. If `APP_ACCESS_KEY` is configured, AI requests are rejected unless the browser sends the same key.

After deployment, open **Settings → LyricPad access key** on each of your devices and enter the same value once. It is stored only in that browser's LyricPad workspace.

### 4. Open LyricPad anywhere

Render gives the service an HTTPS `onrender.com` URL. Open the **Access** tab inside LyricPad to copy it.

On Android/Samsung, open the URL in Chrome/Samsung Internet and choose **Install app** / **Add to Home screen** when available.

On iPad, open it in Safari, use **Share → Add to Home Screen**.

## Local Windows development

Requires Node.js 20+.

Double-click:

```text
run_lyricpad_next.bat
```

Then open `http://localhost:8787`.

For local OpenAI usage, copy `.env.example` to `.env` and fill in `OPENAI_API_KEY`. The batch launcher already creates `.env` from the example when it is missing.

## Ollama

Ollama still works when the Node server is running on the same PC as Ollama:

```text
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b
```

A Render-hosted server cannot reach Ollama running on your home PC at `127.0.0.1`, so use OpenAI for the hosted/mobile version.

## Current sync limitation

The hosted app is now reachable from any device, but songs are still stored in each browser's local storage. Your PC, Samsung, and iPad therefore have separate song libraries in v0.6.

The next infrastructure milestone is authenticated cross-device song sync (for example with Postgres), while retaining offline local editing.
