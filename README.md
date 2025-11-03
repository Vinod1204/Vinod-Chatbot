# ConvoGPT

ConvoGPT is a full-stack chat assistant: FastAPI stores conversations in MongoDB, and a Vite + React frontend provides the UX.

---

## Stack at a Glance
- **Backend:** FastAPI, Uvicorn, Pydantic, MongoDB (GridFS for attachments)
- **Frontend:** Vite, React, TypeScript, Vercel AI SDK
- **Auth:** Email + password, optional Google OAuth
- **Extras:** Speech synthesis playback, bug report uploads, Langfuse telemetry hooks

---

## Prerequisites
- Python 3.11
- Node.js 18+
- MongoDB instance (Atlas or self-hosted)
- OpenAI API key for chat completions

---

## Environment Variables

| Scope | Keys | Notes |
| ----- | ---- | ----- |
| Backend | `OPENAI_API_KEY` | Required. |
| Backend | `MONGODB_URI`, `MONGODB_DB_NAME` | URI required; DB defaults to `chatbot_db`. |
| Backend | `SESSION_SECRET_KEY` | Enables cookie sessions and OAuth. |
| Backend | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL` | Needed for Google sign-in. |
| Backend | `ALLOWED_ORIGINS` | Comma separated list for CORS (default allows localhost dev). |
| Backend (optional) | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | Enable Langfuse tracing. |
| Frontend | `VITE_API_URL` | Required in production; defaults to `http://localhost:8000` locally. |
| Frontend (optional) | `VITE_GOOGLE_CLIENT_ID` | Same value as backend client ID. |

Copy `backend/.env.example` and `frontend/.env.example` to create local `.env` files.

---

## Local Development

### 1. Backend
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt

# provide env vars in backend/.env (see example)
uvicorn backend.web_server:app --reload
```
The API runs on `http://localhost:8000`.

### 2. Frontend
```powershell
cd frontend
npm install

# optional: create frontend/.env with VITE_API_URL
npm run dev
```
The dev server runs at `http://localhost:5173` and proxies API calls to the backend.

---

## Key Features
- Multi-user chat history stored in MongoDB with ownership checks
- Optional Google OAuth login flow
- Built-in voice playback (single female voice profile)
- Bug report dialog with file uploads (stored in GridFS and emailed when SMTP configured)
- Shared conversation previews and claiming

---

## Running with Docker
```powershell
docker build -t convogpt .
docker run --env-file backend/.env -p 8080:8080 convogpt
```
Expose or mount any additional config (MongoDB, SMTP) as needed.

---

## Deployment Tips
- Ensure `ALLOWED_ORIGINS` includes your frontend URL.
- Set `VITE_API_URL` for each Vercel environment before deploying the frontend.
- On hosts like Render/Railway, run `uvicorn backend.web_server:app --host 0.0.0.0 --port ${PORT:-8080}`.

---

## Repository Layout
```
backend/          FastAPI app, data access, auth, bug reports
frontend/         React client
Dockerfile        Production container recipe
```

---

## Useful Commands
- `pytest` (if tests are added) for backend validation
- `npm run build` inside `frontend/` for production bundles
- `uvicorn backend.web_server:app --reload` for live API reloads

Happy hacking! Contribute improvements or raise issues as you explore the project.