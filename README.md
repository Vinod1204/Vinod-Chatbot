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
