# Vinod Chatbot

A local-first multi-turn assistant that reuses the Python CLI logic, adds a FastAPI backend, and ships with a Vite + React frontend powered by the Vercel AI SDK.

## Features

- Persisted conversations on disk via the existing `ConversationStore`.
- REST API built with FastAPI (`web_server.py`) for creating, listing, deleting, and chatting.
- Beautiful React interface (Vite + TypeScript) using the `ai/react` hooks for client-side chat orchestration.
- Optional `.env` loading through `python-dotenv` so you can manage secrets outside source control.

## Prerequisites

- Python 3.10+
- Node.js 18+
- An OpenAI API key with access to the Chat Completions API (set `OPENAI_API_KEY`).

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
uvicorn web_server:app --reload
```

The API listens on `http://localhost:8000` by default. Update `ALLOWED_ORIGINS`, `CONVERSATION_ROOT`, `CHATBOT_TEMPERATURE`, etc., via environment variables if needed.

### Database (optional SQLite bootstrap)

By default the `ConversationStore` keeps JSON files inside `conversations/`. If you prefer to experiment with a relational store (for analytics, dashboards, or future multi-user support), you can seed a lightweight SQLite database:

```powershell
python -c "import sqlite3, pathlib; db = pathlib.Path('data/chatbot.db'); db.parent.mkdir(parents=True, exist_ok=True); schema = '''CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, model TEXT NOT NULL, system_prompt TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, timestamp TEXT NOT NULL);'''; conn = sqlite3.connect(db); conn.executescript(schema); conn.close(); print(f'Initialized {db}')"
```

The command creates `data/chatbot.db` with two baseline tables you can extend as needed. Point any experimental code or services at that path (for example, via a `DATABASE_URL=sqlite:///data/chatbot.db` environment variable) when you swap the storage layer to SQLite.

### Available routes

- `GET /health` – uptime check.
- `GET /api/conversations` – list conversation summaries.
- `POST /api/conversations` – create a conversation (`{ conversationId, model?, systemPrompt?, overwrite? }`).
- `GET /api/conversations/{id}` – fetch a conversation with messages.
- `DELETE /api/conversations/{id}` – delete a conversation file.
- `POST /api/conversations/{id}/messages` – append a user message and receive the assistant reply.
- `POST /api/chat` – endpoint used by the Vercel AI SDK hook (`useChat`), supports automatic conversation creation.

## Frontend setup

```powershell
cd frontend
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies requests directly to the FastAPI backend (ensure the backend is running on port 8000).

Update `VITE_API_URL` or `VITE_DEFAULT_MODEL` in a `frontend/.env` if you need to point to a different backend or default model.

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
3. Expose the app with a command like `uvicorn web_server:app --host 0.0.0.0 --port 8000`. Some platforms expect a `start` script; align with their docs.
4. After deployment, copy the public API URL and add it as `VITE_API_URL` in the Vercel project settings (Project Settings → Environment Variables). Redeploy the frontend so the new variable ships to users.
5. Optionally add a staging environment: point Vercel preview deployments at the staging backend and reserve the production value for the `Production` environment in Vercel settings.

## Project structure

```
Vinod_chatbot/
├── multi_turn_chatbot.py      # original CLI entrypoint
├── web_server.py              # FastAPI application
├── requirements.txt
├── frontend/                  # Vite + React app (ai-sdk.dev integration)
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
└── conversations/             # JSON transcripts saved per conversation id
```

## Running everything together

1. Start the backend: `uvicorn web_server:app --reload`.
2. Start the frontend in a new terminal: `npm run dev`.
3. Visit `http://localhost:5173`, create a conversation, and chat.

## Testing the CLI

The original CLI workflow still works:

```powershell
python multi_turn_chatbot.py --id demo --model gpt-4o-mini --init
python multi_turn_chatbot.py --id demo
```

Both the CLI and the web UI share the `conversations/` folder, so you can switch between them freely.

## Next steps

- Add authentication (e.g., API tokens) if you expose the backend beyond localhost.
- Wire up Tailwind or a design system if you need more customization.
- Deploy FastAPI behind a production server (Uvicorn + Gunicorn) and host the Vite build with any static host.
