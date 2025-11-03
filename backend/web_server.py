"""FastAPI server that exposes the multi-turn chatbot over HTTP.

Run locally:
    uvicorn backend.web_server:app --reload

The server reuses the Chatbot class from ``backend.multi_turn_chatbot`` and
persists conversation history in MongoDB, keeping web clients and background
tasks in sync.
"""
from __future__ import annotations

import json
import logging
import os
import re
import smtplib
from copy import deepcopy
from email.message import EmailMessage
from html import escape
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import FastAPI, HTTPException, Request, Response, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError
from pydantic import BaseModel, EmailStr, Field, validator
from starlette.middleware.sessions import SessionMiddleware

try:  # pragma: no cover - package style import when running via `python -m`
    from .multi_turn_chatbot import (
        Chatbot,
        Conversation,
        Message,
        create_openai_client,
        utc_now,
    )
    from .conversation_store import MongoConversationStore
except ImportError:  # pragma: no cover - fallback when executed as a script
    from multi_turn_chatbot import (  # type: ignore[no-redef]
        Chatbot,
        Conversation,
        Message,
        create_openai_client,
        utc_now,
    )
    # type: ignore[no-redef]
    from conversation_store import MongoConversationStore

try:
    # Keep environment handling consistent with the CLI script.
    from dotenv import load_dotenv

    load_dotenv()
    project_env = Path(__file__).resolve().parent.parent / ".env"
    if project_env.exists():
        load_dotenv(project_env)
except ImportError:
    pass


logger = logging.getLogger(__name__)

USER_ID_HEADER = "x-user-id"
USERS_ENABLED = bool(os.getenv("MONGODB_URI"))

try:
    from .auth import hash_password, verify_password
    from .db import (
        close_client,
        ensure_bug_report_indexes,
        ensure_user_indexes,
        get_bug_report_files_bucket,
        get_bug_reports_collection,
        get_messages_collection,
        get_users_collection,
    )
except ImportError:  # pragma: no cover - allows running without Mongo dependencies
    # Support execution when imported as a top-level module (e.g. `uvicorn web_server:app`).
    try:
        # type: ignore[no-redef]
        from auth import hash_password, verify_password
        # type: ignore[no-redef]
        from db import (
            close_client,
            ensure_bug_report_indexes,
            ensure_user_indexes,
            get_bug_report_files_bucket,
            get_bug_reports_collection,
            get_messages_collection,
            get_users_collection,
        )
    except ImportError:
        hash_password = None  # type: ignore[assignment]
        verify_password = None  # type: ignore[assignment]
        close_client = None  # type: ignore[assignment]
        ensure_user_indexes = None  # type: ignore[assignment]
        get_users_collection = None  # type: ignore[assignment]

# Configuration -----------------------------------------------------------------
DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
DEFAULT_SYSTEM_PROMPT = os.getenv(
    "DEFAULT_SYSTEM_PROMPT", "You are a helpful assistant."
)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if origin.strip()
]
TEMPERATURE = float(os.getenv("CHATBOT_TEMPERATURE", "0.7"))
TOP_P = float(os.getenv("CHATBOT_TOP_P", "1.0"))
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URL = os.getenv("GOOGLE_REDIRECT_URL")
OAUTH_MESSAGE_SOURCE = "convogpt-oauth"
GOOGLE_OAUTH_ENABLED = bool(
    USERS_ENABLED and SESSION_SECRET_KEY and GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
)
TRUSTED_PROXY_IPS = {
    ip.strip()
    for ip in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
    if ip.strip()
}

BUG_REPORT_RECIPIENT = os.getenv("BUG_REPORT_RECIPIENT", "vinodmurugan12@gmail.com").strip()
BUG_REPORT_SENDER = os.getenv("BUG_REPORT_SENDER", os.getenv("SMTP_USERNAME", "noreply@convogpt.local")).strip()
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
BUG_REPORT_EMAIL_ENABLED = bool(SMTP_HOST and BUG_REPORT_RECIPIENT)
MAX_BUG_ATTACHMENTS = int(os.getenv("BUG_REPORT_MAX_ATTACHMENTS", "5"))
MAX_BUG_FILE_SIZE = int(os.getenv("BUG_REPORT_MAX_FILE_SIZE", str(5 * 1024 * 1024)))
MAX_BUG_TOTAL_SIZE = int(os.getenv("BUG_REPORT_MAX_TOTAL_SIZE", str(20 * 1024 * 1024)))

if not USERS_ENABLED:
    raise RuntimeError(
        "MONGODB_URI must be configured. Conversation history now relies on MongoDB storage.",
    )

try:
    _messages_collection = get_messages_collection()
except RuntimeError as exc:  # pragma: no cover - configuration errors
    raise RuntimeError(
        "Unable to initialise MongoDB conversation storage") from exc

store = MongoConversationStore(_messages_collection)
client = create_openai_client()
bot = Chatbot(client, store, temperature=TEMPERATURE, top_p=TOP_P)

try:
    _bug_reports_collection = get_bug_reports_collection()
    _bug_report_files_bucket = get_bug_report_files_bucket()
    ensure_bug_report_indexes()
except RuntimeError as exc:  # pragma: no cover - configuration errors
    raise RuntimeError("Unable to initialise bug report storage") from exc

app = FastAPI(title="Multi-Turn Chatbot API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if SESSION_SECRET_KEY:
    app.add_middleware(
        SessionMiddleware,
        secret_key=SESSION_SECRET_KEY,
        max_age=3600,
        same_site="lax",
        https_only=os.getenv("SESSION_COOKIE_SECURE",
                             "false").lower() == "true",
    )
elif GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET:
    logger.warning("SESSION_SECRET_KEY not set; OAuth providers are disabled.")

oauth: Optional[OAuth] = None
if GOOGLE_OAUTH_ENABLED:
    oauth = OAuth()
    oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )
elif GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    logger.warning(
        "Google OAuth credentials found but MongoDB or session configuration is incomplete; disabling Google login.",
    )
# Helpers ----------------------------------------------------------------------


def _build_google_redirect_uri(request: Request) -> str:
    if GOOGLE_REDIRECT_URL:
        return GOOGLE_REDIRECT_URL
    redirect_uri = str(request.url_for("google_oauth_callback"))
    if not TRUSTED_PROXY_IPS:
        return redirect_uri
    client_host = request.client.host if request.client else None
    if client_host not in TRUSTED_PROXY_IPS:
        return redirect_uri
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_port = request.headers.get("x-forwarded-port")
    if not (forwarded_proto or forwarded_host or forwarded_port):
        return redirect_uri
    parts = urlsplit(redirect_uri)
    scheme = forwarded_proto.split(
        ",")[0].strip() if forwarded_proto else parts.scheme
    host = forwarded_host.split(",")[0].strip(
    ) if forwarded_host else parts.hostname or ""
    port = forwarded_port.split(",")[0].strip() if forwarded_port else ""
    if not host:
        host = parts.hostname or ""
    if port and host and ":" not in host:
        if not ((scheme == "http" and port == "80") or (scheme == "https" and port == "443")):
            host = f"{host}:{port}"
    netloc = host or parts.netloc
    return urlunsplit((scheme or parts.scheme, netloc, parts.path, parts.query, parts.fragment))

# Pydantic models ----------------------------------------------------------------


class ConversationSummary(BaseModel):
    conversationId: str
    title: str
    model: str
    createdAt: str
    updatedAt: str
    messageCount: int


class ConversationDetail(ConversationSummary):
    systemPrompt: str
    messages: List[Dict[str, Any]]


class ConversationCreate(BaseModel):
    title: Optional[str] = Field(None, max_length=120)
    conversationId: Optional[str] = Field(None, min_length=1, max_length=120)
    systemPrompt: Optional[str] = None
    overwrite: bool = False

    @validator("conversationId")
    def validate_conversation_id(cls, value: Optional[str]) -> Optional[str]:  # noqa: D401, N805
        """Ensure the id contains only safe characters."""
        if value is None:
            return value
        safe = "".join(ch for ch in value if ch.isalnum()
                       or ch in ("-", "_", "."))
        if not safe:
            raise ValueError(
                "Conversation id must contain alphanumeric or -_. characters"
            )
        return safe

    @validator("title")
    def validate_title(cls, value: Optional[str]) -> Optional[str]:  # noqa: D401, N805
        if value is None:
            return None
        text = value.strip()
        return text or None


class ConversationRename(BaseModel):
    title: str = Field(..., max_length=120)

    @validator("title")
    def validate_title(cls, value: str) -> str:  # noqa: D401, N805
        text = value.strip()
        if not text:
            raise ValueError("Title cannot be empty.")
        return text


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
    userId: Optional[str] = Field(None, alias="userId")


class ChatResponse(BaseModel):
    id: str
    role: Literal["assistant", "tool"]
    content: str
    createdAt: str
    usage: Optional[Dict[str, int]] = None
    conversation: ConversationDetail


class UserCreatePayload(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    name: Optional[str] = None

    @validator("email", pre=True)
    def _strip_email(cls, value: str) -> str:  # noqa: D401, N805
        """Normalise and trim incoming email addresses."""
        if not isinstance(value, str):
            raise ValueError("Email must be a string")
        return value.strip()

    @validator("password")
    def _validate_password(cls, value: str) -> str:  # noqa: D401, N805
        """Enforce basic password complexity requirements."""
        password = value.strip()
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if re.search(r"\s", password):
            raise ValueError("Password cannot contain whitespace characters.")
        if not re.search(r"[A-Z]", password):
            raise ValueError(
                "Password must include at least one uppercase letter.")
        if not re.search(r"[a-z]", password):
            raise ValueError(
                "Password must include at least one lowercase letter.")
        if not re.search(r"\d", password):
            raise ValueError("Password must include at least one numeral.")
        return password

    @validator("name")
    def _normalise_name(cls, value: Optional[str]) -> Optional[str]:  # noqa: D401, N805
        """Collapse blank display names to None."""
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class UserLoginPayload(BaseModel):
    email: EmailStr
    password: str

    @validator("email", pre=True)
    def _strip_login_email(cls, value: str) -> str:  # noqa: D401, N805
        if not isinstance(value, str):
            raise ValueError("Email must be a string")
        return value.strip()

    @validator("password")
    def _strip_login_password(cls, value: str) -> str:  # noqa: D401, N805
        password = value.strip()
        if not password:
            raise ValueError("Password is required.")
        return password


class UserResponse(BaseModel):
    userId: str
    email: EmailStr
    name: Optional[str] = None


# Helper functions ----------------------------------------------------------------


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _owner_id(request: Request, *, fallback_user_id: Optional[str] = None) -> str:
    header = request.headers.get(USER_ID_HEADER)
    if header:
        return header.strip()
    if fallback_user_id:
        candidate = str(fallback_user_id).strip()
        if candidate:
            return candidate
    if hasattr(request, "session"):
        session_user = request.session.get(
            "user_id")  # type: ignore[attr-defined]
        if session_user:
            return str(session_user)
    raise HTTPException(
        status_code=401, detail="Authentication is required for this action.")


def _optional_owner_id(request: Request) -> Optional[str]:
    header = request.headers.get(USER_ID_HEADER)
    if header:
        candidate = header.strip()
        if candidate:
            return candidate
    if hasattr(request, "session"):
        session_user = request.session.get("user_id")  # type: ignore[attr-defined]
        if session_user:
            return str(session_user)
    return None


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
        "title": conv.title,
        "model": conv.model,
        "systemPrompt": conv.system_prompt,
        "createdAt": conv.created_at,
        "updatedAt": conv.updated_at,
        "messageCount": len(conv.messages),
        "messages": [_message_to_dict(msg) for msg in conv.messages],
    }


def _send_bug_report_email(
    report_id: str,
    description: str,
    contact_email: Optional[str],
    owner_id: Optional[str],
    client_ip: str,
    user_agent: Optional[str],
    attachments: List[Dict[str, Any]],
) -> bool:
    if not BUG_REPORT_EMAIL_ENABLED or not SMTP_HOST:
        return False
    try:
        message = EmailMessage()
        message["Subject"] = f"[ConvoGPT] Bug report {report_id}"
        message["From"] = BUG_REPORT_SENDER or "noreply@convogpt.local"
        message["To"] = BUG_REPORT_RECIPIENT
        body_lines = [
            f"Report ID: {report_id}",
            f"Submitted by: {owner_id or 'guest'}",
            f"Contact email: {contact_email or 'not provided'}",
            f"Client IP: {client_ip}",
            f"User agent: {user_agent or 'unknown'}",
            "",
            "Description:",
            description,
        ]
        message.set_content("\n".join(body_lines))
        for item in attachments:
            content_type = item.get("content_type") or "application/octet-stream"
            maintype, _, subtype = content_type.partition("/")
            maintype = maintype or "application"
            subtype = subtype or "octet-stream"
            message.add_attachment(
                item["data"],
                maintype=maintype,
                subtype=subtype,
                filename=item.get("filename") or "attachment.bin",
            )
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            if SMTP_USE_TLS:
                smtp.starttls()
            if SMTP_USERNAME:
                smtp.login(SMTP_USERNAME, SMTP_PASSWORD or "")
            smtp.send_message(message)
        return True
    except Exception:  # pragma: no cover - external service
        logger.exception("Failed to send bug report email")
        return False


def _ensure_conversation(
    conversation_id: str,
    *,
    owner: str,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> Conversation:
    safe_id = "".join(
        ch for ch in conversation_id if ch.isalnum() or ch in ("-", "_", ".")
    )
    if not safe_id:
        raise HTTPException(
            status_code=400, detail="conversationId is invalid")

    try:
        conv = store.load(safe_id)
    except FileNotFoundError:
        conv = None
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not load conversation.") from exc

    if conv is not None:
        if conv.owner is None or conv.owner != owner:
            raise HTTPException(
                status_code=403, detail="Conversation belongs to another user"
            )
        changed = False
        if model and model != conv.model:
            conv.model = model
            changed = True
        if system_prompt and system_prompt != conv.system_prompt:
            conv.system_prompt = system_prompt
            changed = True
        if changed:
            try:
                store.save(conv)
            except PyMongoError as exc:
                raise HTTPException(
                    status_code=500, detail="Could not update conversation.") from exc
        return conv

    try:
        conv = store.create(
            safe_id,
            title=safe_id,
            model=model or DEFAULT_MODEL,
            system_prompt=system_prompt or DEFAULT_SYSTEM_PROMPT,
            owner=owner,
        )
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not create conversation.") from exc
    return conv


def _users_collection_or_error():
    if not USERS_ENABLED or get_users_collection is None:
        raise HTTPException(
            status_code=503,
            detail="User database is not configured.",
        )
    if hash_password is None or verify_password is None:
        raise HTTPException(
            status_code=503,
            detail="Password hashing library is not available.",
        )
    try:
        collection = get_users_collection()
    except RuntimeError as exc:  # pragma: no cover - env misconfiguration
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return collection


def _google_login_available() -> bool:
    return GOOGLE_OAUTH_ENABLED and oauth is not None


def _oauth_popup_response(
    provider: str,
    *,
    success: bool,
    message: Optional[str] = None,
    user: Optional[UserResponse] = None,
    return_url: Optional[str] = None,
) -> HTMLResponse:
    payload: Dict[str, Any] = {
        "source": OAUTH_MESSAGE_SOURCE,
        "provider": provider,
        "success": success,
    }
    if user is not None:
        payload["user"] = user.dict()
    if message:
        payload["message"] = message
    else:
        payload["message"] = (
            f"{provider.title()} sign-in completed." if success else f"{provider.title()} sign-in failed."
        )
    script_payload = json.dumps(payload)
    status_text = escape(message or (
        "You can close this window." if success else "Authentication failed."))
    redirect_value = json.dumps(return_url)
    html = f"""<!DOCTYPE html>
<html lang=\"en\">
<head>
    <meta charset=\"utf-8\" />
    <title>Authentication {'Success' if success else 'Error'}</title>
</head>
<body>
<script>
    (function() {{
        const detail = {script_payload};
        const target = window.opener || window.parent;
        if (target) {{
            try {{
                target.postMessage(detail, "*");
            }} catch (err) {{
                console.warn('postMessage failed', err);
            }}
        }}
        const returnUrl = {redirect_value};
        if (returnUrl) {{
            window.location.replace(returnUrl);
            return;
        }}
        window.close();
    }})();
</script>
<p>{status_text}</p>
</body>
</html>"""
    return HTMLResponse(content=html)


def _upsert_oauth_user(
    provider: str,
    profile: Dict[str, Any],
    *,
    allow_create: bool = True,
) -> UserResponse:
    email = profile.get("email")
    if not email:
        raise HTTPException(
            status_code=400, detail="OAuth provider did not supply an email address.")
    collection = _users_collection_or_error()
    now = utc_now()
    normalised_email = str(email).lower()
    existing = collection.find_one({"email": normalised_email})
    if not existing and not allow_create:
        raise HTTPException(
            status_code=404,
            detail="No account exists for this provider email. Please sign up first.",
        )
    provider_record = {
        "sub": profile.get("sub") or profile.get("id"),
        "email": normalised_email,
        "name": profile.get("name"),
        "picture": profile.get("picture"),
        "givenName": profile.get("given_name"),
        "familyName": profile.get("family_name"),
        "updatedAt": now,
    }
    update_query: Dict[str, Any] = {
        "$set": {
            "email": normalised_email,
            "updatedAt": now,
            f"providers.{provider}": provider_record,
        }
    }
    if allow_create:
        update_query["$setOnInsert"] = {
            "createdAt": now,
            "password": None,
        }
    if profile.get("name"):
        update_query["$set"]["name"] = profile["name"]
    document = collection.find_one_and_update(
        {"email": normalised_email},
        update_query,
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if not document:
        raise HTTPException(
            status_code=500, detail="Could not save user account.")
    return UserResponse(userId=str(document["_id"]), email=document["email"], name=document.get("name"))


# Routes -------------------------------------------------------------------------


@app.post("/api/auth/signup", response_model=UserResponse, status_code=201)
def signup_user(payload: UserCreatePayload) -> UserResponse:
    collection = _users_collection_or_error()
    email = payload.email.lower()
    now = utc_now()
    document = {
        "email": email,
        "password": hash_password(payload.password),
        "name": payload.name.strip() if payload.name else None,
        "createdAt": now,
        "updatedAt": now,
    }
    try:
        result = collection.insert_one(document)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409, detail="An account with that email already exists.")
    except PyMongoError as exc:  # pragma: no cover - network/driver errors
        logger.exception("Failed to create user", exc_info=exc)
        raise HTTPException(
            status_code=500, detail="Unable to create user account.") from exc
    return UserResponse(userId=str(result.inserted_id), email=email, name=document.get("name"))


@app.post("/api/auth/login", response_model=UserResponse)
def login_user(payload: UserLoginPayload) -> UserResponse:
    collection = _users_collection_or_error()
    email = payload.email.lower()
    user = collection.find_one({"email": email})
    if not user:
        raise HTTPException(
            status_code=404,
            detail="We couldn't find an account with that email. Please sign up to continue.",
        )
    if not verify_password(payload.password, user.get("password", "")):
        raise HTTPException(
            status_code=401, detail="Invalid email or password.")
    collection.update_one({"_id": user["_id"]}, {
                          "$set": {"updatedAt": utc_now()}})
    return UserResponse(userId=str(user["_id"]), email=email, name=user.get("name"))


@app.post("/api/report-bug")
async def report_bug(
    request: Request,
    description: str = Form(...),
    contactEmail: Optional[str] = Form(None),
    attachments: Optional[List[UploadFile]] = File(default=None),
) -> Dict[str, Any]:
    trimmed_description = description.strip()
    if not trimmed_description:
        raise HTTPException(status_code=400, detail="Description is required.")

    files = attachments or []
    if len(files) > MAX_BUG_ATTACHMENTS:
        raise HTTPException(
            status_code=400,
            detail=f"A maximum of {MAX_BUG_ATTACHMENTS} attachments is allowed.",
        )

    buffered_files: List[Dict[str, Any]] = []
    total_bytes = 0
    for index, upload in enumerate(files, start=1):
        data = await upload.read()
        file_size = len(data)
        if file_size > MAX_BUG_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Attachment '{upload.filename}' exceeds the {MAX_BUG_FILE_SIZE // (1024 * 1024)} MB limit.",
            )
        total_bytes += file_size
        if total_bytes > MAX_BUG_TOTAL_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"Attachments exceed the {MAX_BUG_TOTAL_SIZE // (1024 * 1024)} MB total limit.",
            )
        buffered_files.append(
            {
                "filename": upload.filename or f"attachment-{index}",
                "content_type": upload.content_type or "application/octet-stream",
                "size": file_size,
                "data": data,
            }
        )

    owner_id = _optional_owner_id(request)
    contact = contactEmail.strip() if contactEmail else None
    report_id = uuid4().hex
    client_ip = _client_ip(request)
    user_agent = request.headers.get("user-agent")

    stored_file_ids = []
    attachments_meta: List[Dict[str, Any]] = []
    try:
        for buffered in buffered_files:
            file_id = _bug_report_files_bucket.upload_from_stream(
                buffered["filename"],
                BytesIO(buffered["data"]),
                metadata={
                    "reportId": report_id,
                    "ownerId": owner_id,
                    "contentType": buffered["content_type"],
                    "size": buffered["size"],
                },
            )
            stored_file_ids.append(file_id)
            attachments_meta.append(
                {
                    "fileId": str(file_id),
                    "filename": buffered["filename"],
                    "contentType": buffered["content_type"],
                    "size": buffered["size"],
                }
            )
    except Exception as exc:  # pragma: no cover - GridFS failure
        for file_id in stored_file_ids:
            try:
                _bug_report_files_bucket.delete(file_id)
            except Exception:  # pragma: no cover - cleanup best effort
                logger.warning("Unable to clean up bug report attachment %s", file_id)
        raise HTTPException(status_code=500, detail="Could not store bug report attachments.") from exc

    document = {
        "_id": report_id,
        "reportId": report_id,
        "description": trimmed_description,
        "contactEmail": contact,
        "ownerId": owner_id,
        "clientIp": client_ip,
        "userAgent": user_agent,
        "submittedAt": utc_now(),
        "attachments": attachments_meta,
        "totalAttachmentBytes": total_bytes,
    }

    try:
        _bug_reports_collection.insert_one(document)
    except PyMongoError as exc:
        for file_id in stored_file_ids:
            try:
                _bug_report_files_bucket.delete(file_id)
            except Exception:  # pragma: no cover - cleanup best effort
                logger.warning("Unable to clean up bug report attachment %s", file_id)
        raise HTTPException(status_code=500, detail="Could not store your bug report.") from exc

    email_sent = _send_bug_report_email(
        report_id,
        trimmed_description,
        contact,
        owner_id,
        client_ip,
        user_agent,
        buffered_files,
    )

    return {"reportId": report_id, "emailSent": email_sent}


@app.get("/api/auth/oauth/google/start")
async def google_oauth_start(request: Request, returnUrl: Optional[str] = None):
    if not _google_login_available():
        raise HTTPException(
            status_code=503, detail="Google login is not available.")
    if not hasattr(request, "session"):
        raise HTTPException(
            status_code=503, detail="Session support is required for OAuth.")
    if returnUrl:
        request.session["oauth_return_url"] = returnUrl
    redirect_uri = _build_google_redirect_uri(request)
    logger.info(
        "Google OAuth start: redirect_uri=%s returnUrl=%s", redirect_uri, returnUrl
    )
    # type: ignore[assignment]
    client = oauth.create_client("google") if oauth is not None else None
    if client is None:
        raise HTTPException(
            status_code=503, detail="Google login is not available.")
    try:
        return await client.authorize_redirect(request, redirect_uri, prompt="select_account")
    except OAuthError as exc:  # pragma: no cover - network/remote errors
        logger.exception("Failed to start Google OAuth flow", exc_info=exc)
        raise HTTPException(
            status_code=500, detail="Unable to start Google sign-in.") from exc


@app.get("/api/auth/oauth/google/callback")
async def google_oauth_callback(request: Request):
    if not _google_login_available():
        raise HTTPException(
            status_code=503, detail="Google login is not available.")
    # type: ignore[assignment]
    client = oauth.create_client("google") if oauth is not None else None
    if client is None:
        raise HTTPException(
            status_code=503, detail="Google login is not available.")
    return_url: Optional[str] = None
    if hasattr(request, "session"):
        return_url = request.session.pop("oauth_return_url", None)
    try:
        token = await client.authorize_access_token(request)
    except OAuthError as exc:  # pragma: no cover - remote flow errors
        logger.warning("Google OAuth error: %s", exc)
        message = "Google sign-in was cancelled." if exc.error == "access_denied" else "Google sign-in failed."
        return _oauth_popup_response("google", success=False, message=message, return_url=return_url)
    except Exception as exc:  # pragma: no cover - unexpected
        logger.exception("Unexpected Google OAuth error", exc_info=exc)
        return _oauth_popup_response(
            "google",
            success=False,
            message="Google sign-in failed. Please try again.",
            return_url=return_url,
        )

    try:
        userinfo = token.get("userinfo")
        if not userinfo:
            userinfo = await client.parse_id_token(request, token)
    except Exception as exc:  # pragma: no cover - verification errors
        logger.exception(
            "Failed to parse Google user information", exc_info=exc)
        return _oauth_popup_response(
            "google",
            success=False,
            message="We could not verify your Google account details.",
            return_url=return_url,
        )

    if not isinstance(userinfo, dict) or "email" not in userinfo:
        return _oauth_popup_response(
            "google",
            success=False,
            message="Google did not return an email address for your account.",
            return_url=return_url,
        )

    try:
        user_response = _upsert_oauth_user(
            "google", userinfo, allow_create=True)
    except HTTPException as exc:
        return _oauth_popup_response("google", success=False, message=str(exc.detail), return_url=return_url)
    except PyMongoError as exc:  # pragma: no cover - database errors
        logger.exception("Failed to persist Google account", exc_info=exc)
        return _oauth_popup_response(
            "google",
            success=False,
            message="Could not save your Google account.",
            return_url=return_url,
        )

    logger.info("Google sign-in succeeded for %s", user_response.email)
    if hasattr(request, "session"):
        # type: ignore[attr-defined]
        request.session["user_id"] = user_response.userId
    return _oauth_popup_response(
        "google",
        success=True,
        message="Signed in with Google.",
        user=user_response,
        return_url=return_url,
    )


@app.get("/health")
def healthcheck() -> Dict[str, Any]:
    return {"status": "ok", "time": utc_now()}


@app.get("/api/conversations", response_model=List[ConversationSummary])
def list_conversations(request: Request) -> List[ConversationSummary]:
    owner = _owner_id(request)
    try:
        conversations = list(store.iter_owner(owner))
    except PyMongoError as exc:  # pragma: no cover - connectivity issues
        raise HTTPException(
            status_code=500, detail="Could not load conversations.") from exc

    return [
        ConversationSummary(
            conversationId=conv.conversation_id,
            title=conv.title,
            model=conv.model,
            createdAt=conv.created_at,
            updatedAt=conv.updated_at,
            messageCount=len(conv.messages),
        )
        for conv in conversations
    ]


@app.post("/api/conversations", response_model=ConversationDetail, status_code=201)
def create_conversation(payload: ConversationCreate, request: Request) -> ConversationDetail:
    owner = _owner_id(request)
    conversation_id = payload.conversationId or uuid4().hex[:12]
    try:
        existing = store.load(conversation_id)
    except FileNotFoundError:
        existing = None
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not inspect conversation state.") from exc

    if existing is not None:
        if existing.owner != owner:
            raise HTTPException(
                status_code=409,
                detail="Conversation id is already reserved by another user.",
            )
        if not payload.overwrite:
            raise HTTPException(
                status_code=409, detail="Conversation already exists")

    try:
        conv = store.create(
            conversation_id,
            title=payload.title,
            model=DEFAULT_MODEL,
            system_prompt=payload.systemPrompt or DEFAULT_SYSTEM_PROMPT,
            owner=owner,
        )
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not create conversation.") from exc
    return ConversationDetail(**_conversation_to_dict(conv))


@app.get("/api/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: str, request: Request) -> ConversationDetail:
    owner = _owner_id(request)
    try:
        conv = store.load(conversation_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not load conversation.") from exc
    if conv.owner != owner:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return ConversationDetail(**_conversation_to_dict(conv))


@app.get("/api/shared-conversations/{conversation_id}", response_model=ConversationDetail)
def preview_shared_conversation(conversation_id: str, request: Request) -> ConversationDetail:
    _optional_owner_id(request)  # Ensure session access side effects stay consistent
    try:
        conv = store.load(conversation_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not load conversation.") from exc

    if not conv.owner:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return ConversationDetail(**_conversation_to_dict(conv))


@app.patch("/api/conversations/{conversation_id}", response_model=ConversationDetail)
def rename_conversation(
    conversation_id: str, payload: ConversationRename, request: Request
) -> ConversationDetail:
    owner = _owner_id(request)
    try:
        conv = store.load(conversation_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not load conversation.") from exc
    if conv.owner != owner:
        raise HTTPException(status_code=404, detail="Conversation not found")
    new_title = payload.title.strip()
    if conv.title != new_title:
        conv.title = new_title
        conv.updated_at = utc_now()
        try:
            store.save(conv)
        except PyMongoError as exc:
            raise HTTPException(
                status_code=500, detail="Could not update conversation.") from exc
    return ConversationDetail(**_conversation_to_dict(conv))


@app.delete(
    "/api/conversations/{conversation_id}",
    status_code=204,
    response_class=Response,
)
def delete_conversation(conversation_id: str, request: Request) -> Response:
    owner = _owner_id(request)
    try:
        conv = store.load(conversation_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not load conversation.") from exc
    if conv.owner != owner:
        raise HTTPException(status_code=404, detail="Conversation not found")
    try:
        store.delete(conversation_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not delete conversation.") from exc
    return Response(status_code=204)


@app.post("/api/shared-conversations/{conversation_id}/claim", response_model=ConversationDetail, status_code=201)
def claim_shared_conversation(conversation_id: str, request: Request) -> ConversationDetail:
    owner = _owner_id(request)
    try:
        source = store.load(conversation_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not load conversation.") from exc

    if not source.owner:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if source.owner == owner:
        return ConversationDetail(**_conversation_to_dict(source))

    cloned = Conversation(
        conversation_id=uuid4().hex[:12],
        title=source.title,
        model=source.model,
        system_prompt=source.system_prompt,
        created_at=utc_now(),
        updated_at=utc_now(),
        owner=owner,
        messages=[
            Message(
                role=message.role,
                content=message.content,
                timestamp=message.timestamp,
                metadata=deepcopy(message.metadata),
                usage=deepcopy(message.usage) if message.usage is not None else None,
            )
            for message in source.messages
        ],
        participants=deepcopy(source.participants),
    )

    try:
        store.save(cloned)
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not save conversation.") from exc

    return ConversationDetail(**_conversation_to_dict(cloned))


@app.post("/api/conversations/{conversation_id}/messages", response_model=ChatResponse)
def send_message(conversation_id: str, payload: MessagePayload, request: Request) -> ChatResponse:
    owner = _owner_id(request)
    conv = _ensure_conversation(
        conversation_id,
        owner=owner,
        model=payload.model,
        system_prompt=payload.systemPrompt,
    )
    if not payload.content.strip():
        raise HTTPException(
            status_code=400, detail="Message content is required")

    try:
        reply_text = bot.send(conv.conversation_id, payload.content)
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not process message.") from exc

    try:
        updated = store.load(conv.conversation_id)
    except (FileNotFoundError, PyMongoError) as exc:
        raise HTTPException(
            status_code=500, detail="Could not refresh conversation state.") from exc
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
    owner = _owner_id(request, fallback_user_id=payload.userId)
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

    try:
        reply_text = bot.send(conv.conversation_id, user_input)
    except PyMongoError as exc:
        raise HTTPException(
            status_code=500, detail="Could not process message.") from exc

    try:
        updated = store.load(conv.conversation_id)
    except (FileNotFoundError, PyMongoError) as exc:
        raise HTTPException(
            status_code=500, detail="Could not refresh conversation state.") from exc
    assistant_msg = updated.messages[-1]
    return ChatResponse(
        id=str(uuid4()),
        role=assistant_msg.role,
        content=assistant_msg.content,
        createdAt=assistant_msg.timestamp,
        usage=assistant_msg.usage,
        conversation=ConversationDetail(**_conversation_to_dict(updated)),
    )


@app.on_event("startup")
def on_startup() -> None:
    try:
        store.ensure_indexes()
        logger.info("Conversation indexes ready.")
    except Exception as exc:  # pragma: no cover - connectivity failures
        logger.exception("Failed to ensure conversation indexes", exc_info=exc)

    if ensure_user_indexes is None:
        logger.info(
            "User collection helper unavailable; skipping user index creation.")
        return
    try:
        ensure_user_indexes()
        logger.info("User collection indexes ready.")
    except Exception as exc:  # pragma: no cover - connectivity failures
        logger.exception("Failed to ensure MongoDB user indexes", exc_info=exc)

    if GOOGLE_OAUTH_ENABLED:
        logger.info("Google OAuth sign-in is enabled.")
    elif GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
        logger.warning(
            "Google OAuth credentials detected but the feature is disabled due to missing prerequisites.")


@app.on_event("shutdown")
def on_shutdown() -> None:
    if USERS_ENABLED and close_client is not None:
        close_client()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.web_server:app",
                host="0.0.0.0", port=8000, reload=True)
