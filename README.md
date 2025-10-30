# ConvoGPT

A local-first multi-turn assistant that reuses the Python CLI logic, adds a FastAPI backend, and ships with a Vite + React frontend powered by the Vercel AI SDK.

## Features

- Persisted conversations in MongoDB (`chatbot_db.messages`) linked to user accounts.
- REST API built with FastAPI (`backend/web_server.py`) for creating, listing, deleting, and chatting.
- Beautiful React interface (Vite + TypeScript) using the `ai/react` hooks for client-side chat orchestration.
- Optional `.env` loading through `python-dotenv` so you can manage secrets outside source control.

## Prerequisites

- Python 3.10+
- Node.js 18+
- An OpenAI API key with access to the Chat Completions API (set `OPENAI_API_KEY`).

## Configuration

Define the following environment variables before running locally or deploying:

| Scope      | Variable              | Purpose |
|------------|-----------------------|---------|
| Backend    | `OPENAI_API_KEY`      | Required so the chatbot can call the OpenAI API. |
| Backend    | `ALLOWED_ORIGINS`     | Comma-separated list of origins allowed to call the API (include the deployed frontend URL). |
| Backend    | `CHATBOT_TEMPERATURE` | Optional override for the assistant’s sampling temperature. |
| Backend    | `MONGODB_URI`         | MongoDB connection string; required for both user auth and conversation storage. |
| Backend    | `MONGODB_DB_NAME`     | Optional MongoDB database name (defaults to `chatbot_db`). |
| Backend    | `MONGODB_MESSAGES_COLLECTION` | Optional MongoDB collection name for conversations (defaults to `messages`). |
| Backend    | `MONGODB_USERS_COLLECTION` | Optional MongoDB collection name for users (defaults to `users`). |
| Backend    | `SESSION_SECRET_KEY`  | Secret for the session middleware; required when enabling OAuth providers. |
| Backend    | `GOOGLE_CLIENT_ID`    | Google OAuth client ID used by the backend. |
| Backend    | `GOOGLE_CLIENT_SECRET`| Google OAuth client secret used by the backend. |
| Backend    | `GOOGLE_REDIRECT_URL` | Optional override for the Google callback URL; defaults to the backend callback route. |
| Backend    | `LANGFUSE_PUBLIC_KEY` | Optional: enable Langfuse tracing when paired with `LANGFUSE_SECRET_KEY`. |
| Backend    | `LANGFUSE_SECRET_KEY` | Optional: secret token for Langfuse. |
| Backend    | `LANGFUSE_HOST`       | Optional: override Langfuse host (defaults to `https://cloud.langfuse.com`). |
| Frontend   | `VITE_API_URL`        | Points the Vite app to the FastAPI backend. Required in production. |
| Frontend   | `VITE_GOOGLE_CLIENT_ID`| Google OAuth client ID embedded in the React app. |
| Frontend   | `VITE_DEFAULT_MODEL`  | Optional default OpenAI model identifier for new conversations. |

When hosting the frontend on Vercel, add `VITE_API_URL` (and other variables) in the Vercel dashboard under **Project Settings → Environment Variables** so deployments use the correct backend endpoint.

## Backend setup

```powershell
# from repo root
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# copy and edit your secrets
Copy-Item .\.env.example .\.env
notepad .\.env
# run the API server
uvicorn backend.web_server:app --reload
```

The API listens on `http://localhost:8000` by default. Update `ALLOWED_ORIGINS`, `CHATBOT_TEMPERATURE`, etc., via environment variables if needed. By default, conversations persist in MongoDB under `chatbot_db.messages` (configurable via `MONGODB_DB_NAME` and `MONGODB_MESSAGES_COLLECTION`).

### Authentication and validation

- Email addresses are normalised to lowercase and trimmed before being stored.
- Passwords must be at least 8 characters and contain uppercase, lowercase, and numeric characters with no whitespace.
- Logging in with an unknown email returns an explicit `404` so clients can nudge the user to sign up; the frontend switches to sign-up mode automatically when it receives that response.
- Passwords are hashed with PBKDF2-SHA256 via `passlib`; never store or log plaintext secrets.
- Google sign-in is available for linking existing accounts; first-time users should register with email and password before using Google OAuth.
- Conversation APIs require an authenticated `x-user-id` header (or OAuth session) and conversations are now owned by user accounts rather than IP addresses.

### Telemetry with Langfuse (optional)

If you provide `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`, the app will automatically wrap the OpenAI SDK with Langfuse’s OpenAI client. This captures spans, prompts, and responses without changing any API calls. Set `LANGFUSE_HOST` when self-hosting Langfuse. Remove or unset these variables to disable tracing.

### Database

Conversation history now lives in MongoDB. At a minimum, configure `MONGODB_URI`; the backend will use `chatbot_db` and the `messages` collection by default. On startup the API ensures two indexes:

- unique `conversation_id` to prevent collisions;
- `{ owner: 1, updated_at: -1 }` to speed up history lookups per user.

User accounts continue to live in the same database (collection defaults to `users`). No manual schema creation is required—documents are stored as nested JSON.
@@ -61,53 +76,82 @@ npm run dev

The Vite dev server runs on `http://localhost:5173` and proxies requests directly to the FastAPI backend (ensure the backend is running on port 8000).

Update `VITE_API_URL` or `VITE_DEFAULT_MODEL` in a `frontend/.env` if you need to point to a different backend or default model.

### Google OAuth setup

1. Create an **OAuth client ID → Web application** in Google Cloud Console. Add your development callback (`http://localhost:8000/api/auth/oauth/google/callback`) and any deployed backend callback (for example `https://<render-service>.onrender.com/api/auth/oauth/google/callback`) under *Authorized redirect URIs*.
2. Copy the client ID and secret into the backend environment as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. If the deployed callback differs from what FastAPI would compute, set `GOOGLE_REDIRECT_URL` to the exact URL you whitelisted.
3. Provide the same client ID to the frontend via `VITE_GOOGLE_CLIENT_ID`. Redeploy the frontend after changing the value so the build embeds the updated ID.
4. Restart the backend. On startup you should see `Google OAuth sign-in is enabled.` in the logs. During the login flow the backend logs `Google OAuth start: redirect_uri=...`, which must match an entry in Google Cloud Console; update either the env var or the console entry until they are identical to avoid `redirect_uri_mismatch` errors.

## Deploying the frontend on Vercel

```powershell
npm install -g vercel
vercel login
cd frontend
npm install
vercel
vercel --prod
```

- The first `vercel` command creates a preview deployment; accept the Vite/React defaults (build `npm run build`, output `dist`).
- Set any required environment variables in the Vercel dashboard under Project Settings → Environment Variables and redeploy when you update them.
- Promote to production with `vercel --prod`, or trigger a deploy from the dashboard after pushing to the connected Git repository.
- Host the FastAPI backend separately (Render, Azure, Railway, etc.) or port it into Vercel serverless/Edge Functions, then set `VITE_API_URL` so the React app calls the production API.

### Deploying the backend for production

1. Choose a Python-friendly host that keeps `uvicorn` (or Gunicorn + Uvicorn workers) running—Render, Railway, Fly.io, Azure App Service, and DigitalOcean App Platform all work well.
2. Configure your environment variables there (`OPENAI_API_KEY`, `ALLOWED_ORIGINS`, `CONVERSATION_ROOT`, any database URLs). Include the deployed frontend origin in `ALLOWED_ORIGINS` so browsers can reach the API.
3. Expose the app with a command like `uvicorn backend.web_server:app --host 0.0.0.0 --port ${PORT:-8000}` so it binds to the platform-provided port when present. Some platforms expect a `start` script; align with their docs and avoid hard-coding privileged ports.
4. Verify that the host assigns a public HTTPS URL (for example `https://convogpt.onrender.com`). Test `/health` on that URL to confirm the deployment is reachable.
5. Copy the public API URL and add it as `VITE_API_URL` in the Vercel project settings (Project Settings → Environment Variables → Production). Redeploy the frontend so users receive the new environment variable.
6. Optionally add a staging environment: point Vercel preview deployments at the staging backend and reserve the production value for the `Production` environment in Vercel settings.

#### Render free tier quickstart (recommended)

Render provides an HTTPS-enabled free tier that auto-deploys from GitHub and is a strong default for small projects:

1. Push your backend code to GitHub with a production-ready `requirements.txt` and a defensive default configuration (no debug loggers, secrets in environment variables only).
2. Add a `start` script to `package.json` (or the equivalent start command in Render’s dashboard) so Render can run `npm start` if you expose Node tooling, and ensure your Python `start command` is `uvicorn backend.web_server:app --host 0.0.0.0 --port $PORT`.
3. Update your FastAPI app to read the dynamically assigned port. For example:

   ```python
   import os

   port = int(os.environ.get("PORT", "8000"))
   uvicorn.run(app, host="0.0.0.0", port=port)
   ```

   This prevents Render from rejecting the deploy because the process binds to the wrong port.
4. Create a new **Web Service** in Render, connect your GitHub repository, select the branch to deploy, and set the **Start Command** to the same secure command you tested locally. Keep **Instance Type** on the free tier while you evaluate usage.
5. Configure Render environment variables (`OPENAI_API_KEY`, `ALLOWED_ORIGINS`, etc.) and add the production frontend origin to the allowed list. Avoid committing secrets to git.
6. Deploy and note the assigned `https://<service-name>.onrender.com` URL. Verify `/health` responds with 200 OK.
7. In Vercel, set `VITE_API_URL` to the Render URL for Production (and optionally Preview) environments, trigger a redeploy, and confirm end-to-end TLS connectivity from the browser.

#### Production checklist

- [ ] Backend deployed and responding at `/health` over HTTPS.
- [ ] `ALLOWED_ORIGINS` includes the exact production frontend origin.
- [x] `VITE_API_URL` set for each Vercel environment (Preview, Production) that should call the deployment.
- [ ] Frontend redeployed after environment variables change so the build embeds the updated API URL.

## Project structure

```
ConvoGPT/
├── backend/
│   ├── __init__.py
│   ├── conversations/              # Legacy JSON transcripts (CLI usage)
│   ├── conversation_schema.json
│   ├── multi_turn_chatbot.py       # CLI + core chatbot implementation
│   ├── conversation_store.py       # MongoDB conversation persistence
│   ├── requirements.txt            # Backend Python dependencies
│   ├── sample_transcripts/
│   └── web_server.py               # FastAPI application
├── frontend/                       # Vite + React app (ai-sdk.dev integration)
│   ├── package.json
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── components/
│   │   │   ├── ConversationSidebar.tsx
│   │   │   ├── CreateConversationDialog.tsx
│   │   │   └── MessageBubble.tsx
│   │   └── styles.css
│   └── vite.config.ts
├── multi_turn_chatbot.py            # Compatibility shim → backend.multi_turn_chatbot
├── requirements.txt                 # Includes backend/requirements.txt
└── web_server.py                    # Compatibility shim → backend.web_server
```

## Running everything together

1. Start the backend: `uvicorn backend.web_server:app --reload`.