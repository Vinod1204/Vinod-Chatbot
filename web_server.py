"""FastAPI server that exposes the multi-turn chatbot over HTTP.

Run locally:
    uvicorn web_server:app --reload

The server reuses the ConversationStore and Chatbot classes from
`multi_turn_chatbot.py`, so CLI and web clients share the same
conversation history on disk.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator

from multi_turn_chatbot import (
    Chatbot,
    Conversation,
    ConversationStore,
    Message,
    create_openai_client,
    utc_now,
)

try:
    # Keep environment handling consistent with the CLI script.
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

# Configuration -----------------------------------------------------------------
DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
DEFAULT_SYSTEM_PROMPT = os.getenv(
    "DEFAULT_SYSTEM_PROMPT", "You are a helpful assistant."
)
CONVERSATION_ROOT = Path(os.getenv("CONVERSATION_ROOT", "./conversations"))
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
TEMPERATURE = float(os.getenv("CHATBOT_TEMPERATURE", "0.7"))
TOP_P = float(os.getenv("CHATBOT_TOP_P", "1.0"))

store = ConversationStore(CONVERSATION_ROOT)
client = create_openai_client()
bot = Chatbot(client, store, temperature=TEMPERATURE, top_p=TOP_P)

app = FastAPI(title="Multi-Turn Chatbot API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models ----------------------------------------------------------------


class ConversationSummary(BaseModel):
    conversationId: str
    model: str
    createdAt: str
    updatedAt: str
    messageCount: int


class ConversationDetail(ConversationSummary):
    systemPrompt: str
    messages: List[Dict[str, Any]]


class ConversationCreate(BaseModel):
    conversationId: str = Field(..., min_length=1, max_length=120)
    model: Optional[str] = None
    systemPrompt: Optional[str] = None
    overwrite: bool = False

    @validator("conversationId")
    def validate_conversation_id(cls, value: str) -> str:  # noqa: D401, N805
        """Ensure the id contains only safe characters."""
        safe = "".join(ch for ch in value if ch.isalnum()
                       or ch in ("-", "_", "."))
        if not safe:
            raise ValueError(
                "Conversation id must contain alphanumeric or -_. characters")
        return safe


class MessagePayload(BaseModel):
    content: str = Field(..., min_length=1)
    model: Optional[str] = None
    systemPrompt: Optional[str] = None


class ClientMessage(BaseModel):
    id: Optional[str] = None
    role: Literal["user", "assistant", "system", "tool"]
    content: str


class ChatRequest(BaseModel):
    conversationId: str = Field(..., alias="conversationId")
    messages: List[ClientMessage] = Field(default_factory=list)
    input: Optional[str] = None
    model: Optional[str] = None
    systemPrompt: Optional[str] = None


class ChatResponse(BaseModel):
    id: str
    role: Literal["assistant", "tool"]
    content: str
    createdAt: str
    usage: Optional[Dict[str, int]] = None
    conversation: ConversationDetail


# Helper functions ----------------------------------------------------------------


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _message_to_dict(msg: Message) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "role": msg.role,
        "content": msg.content,
        "timestamp": msg.timestamp,
    }
    if msg.metadata:
        data["metadata"] = msg.metadata
    if msg.usage:
        data["usage"] = msg.usage
    return data


def _conversation_to_dict(conv: Conversation) -> Dict[str, Any]:
    return {
        "conversationId": conv.conversation_id,
        "model": conv.model,
        "systemPrompt": conv.system_prompt,
        "createdAt": conv.created_at,
        "updatedAt": conv.updated_at,
        "messageCount": len(conv.messages),
        "messages": [_message_to_dict(msg) for msg in conv.messages],
    }


def _ensure_conversation(
    conversation_id: str,
    *,
    owner: str,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> Conversation:
    safe_id = "".join(
        ch for ch in conversation_id if ch.isalnum() or ch in ("-", "_", "."))
    if not safe_id:
        raise HTTPException(
            status_code=400, detail="conversationId is invalid")

    if store.exists(safe_id):
        conv = store.load(safe_id)
        if conv.owner is None or conv.owner != owner:
            raise HTTPException(
                status_code=403, detail="Conversation belongs to another user")
        changed = False
        if model and model != conv.model:
            conv.model = model
            changed = True
        if system_prompt and system_prompt != conv.system_prompt:
            conv.system_prompt = system_prompt
            changed = True
        if changed:
            store.save(conv)
        return conv

    conv = store.create(
        safe_id,
        model=model or DEFAULT_MODEL,
        system_prompt=system_prompt or DEFAULT_SYSTEM_PROMPT,
        owner=owner,
    )
    return conv


# Routes -------------------------------------------------------------------------


@app.get("/health")
def healthcheck() -> Dict[str, Any]:
    return {"status": "ok", "time": utc_now()}


@app.get("/api/conversations", response_model=List[ConversationSummary])
def list_conversations(request: Request) -> List[ConversationSummary]:
    owner = _client_ip(request)
    summaries: List[ConversationSummary] = []
    for cid in store.list_conversations():
        conv = store.load(cid)
        if conv.owner != owner:
            continue
        summaries.append(
            ConversationSummary(
                conversationId=conv.conversation_id,
                model=conv.model,
                createdAt=conv.created_at,
                updatedAt=conv.updated_at,
                messageCount=len(conv.messages),
            )
        )
    summaries.sort(key=lambda item: item.updatedAt, reverse=True)
    return summaries


@app.post("/api/conversations", response_model=ConversationDetail, status_code=201)
def create_conversation(payload: ConversationCreate, request: Request) -> ConversationDetail:
    owner = _client_ip(request)
    if store.exists(payload.conversationId):
        existing = store.load(payload.conversationId)
        if existing.owner != owner:
            raise HTTPException(
                status_code=409,
                detail="Conversation id is already reserved by another user.",
            )
        if not payload.overwrite:
            raise HTTPException(
                status_code=409, detail="Conversation already exists")

    conv = store.create(
        payload.conversationId,
        model=payload.model or DEFAULT_MODEL,
        system_prompt=payload.systemPrompt or DEFAULT_SYSTEM_PROMPT,
        owner=owner,
    )
    return ConversationDetail(**_conversation_to_dict(conv))


@app.get("/api/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: str, request: Request) -> ConversationDetail:
    owner = _client_ip(request)
    if not store.exists(conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv = store.load(conversation_id)
    if conv.owner != owner:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return ConversationDetail(**_conversation_to_dict(conv))


@app.delete(
    "/api/conversations/{conversation_id}",
    status_code=204,
    response_class=Response,
)
def delete_conversation(conversation_id: str, request: Request) -> Response:
    owner = _client_ip(request)
    if not store.exists(conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    conv = store.load(conversation_id)
    if conv.owner != owner:
        raise HTTPException(status_code=404, detail="Conversation not found")
    store.path(conversation_id).unlink()
    return Response(status_code=204)


@app.post("/api/conversations/{conversation_id}/messages", response_model=ChatResponse)
def send_message(conversation_id: str, payload: MessagePayload, request: Request) -> ChatResponse:
    owner = _client_ip(request)
    conv = _ensure_conversation(
        conversation_id,
        owner=owner,
        model=payload.model,
        system_prompt=payload.systemPrompt,
    )
    if not payload.content.strip():
        raise HTTPException(
            status_code=400, detail="Message content is required")

    reply_text = bot.send(conv.conversation_id, payload.content)
    updated = store.load(conv.conversation_id)
    assistant_msg = updated.messages[-1]
    return ChatResponse(
        id=str(uuid4()),
        role=assistant_msg.role,
        content=reply_text,
        createdAt=assistant_msg.timestamp,
        usage=assistant_msg.usage,
        conversation=ConversationDetail(**_conversation_to_dict(updated)),
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(payload: ChatRequest, request: Request) -> ChatResponse:
    owner = _client_ip(request)
    conv = _ensure_conversation(
        payload.conversationId,
        owner=owner,
        model=payload.model,
        system_prompt=payload.systemPrompt,
    )
    user_input = payload.input or (
        payload.messages[-1].content if payload.messages else None
    )
    if not user_input:
        raise HTTPException(status_code=400, detail="No user input provided")

    reply_text = bot.send(conv.conversation_id, user_input)
    updated = store.load(conv.conversation_id)
    assistant_msg = updated.messages[-1]
    return ChatResponse(
        id=str(uuid4()),
        role=assistant_msg.role,
        content=assistant_msg.content,
        createdAt=assistant_msg.timestamp,
        usage=assistant_msg.usage,
        conversation=ConversationDetail(**_conversation_to_dict(updated)),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("web_server:app", host="0.0.0.0", port=8000, reload=True)
