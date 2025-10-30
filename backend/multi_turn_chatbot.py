#!/usr/bin/env python3
"""
Multi-Turn Chatbot with OpenAI's Chat Completions API
-----------------------------------------------------

This module lives inside the backend package so it can be imported by the
FastAPI server (`backend.web_server`) and executed directly via
``python -m backend.multi_turn_chatbot``.

Features
- Uses OpenAI's Chat Completions API via the official Python SDK.
- Maintains conversation history in a JSON file per conversation id.
- Can resume an existing conversation seamlessly on startup.
- Simple CLI with interactive loop, /history and on-the-fly /system update.

Setup
1) pip install openai python-dotenv
2) Create a .env with OPENAI_API_KEY="sk-..." (or export it in your shell)
   (Optionally export OPENAI_MODEL to override the model)
3) Run:
   python -m backend.multi_turn_chatbot --id alice_travel --model gpt-4o-mini --init
   python -m backend.multi_turn_chatbot --id alice_travel

Notes
- This script uses Chat Completions (client.chat.completions.create), which
  remains supported. OpenAI also offers the newer Responses API; migration notes
  are in the docs.

Author: Your Name
License: MIT
"""

from __future__ import annotations

import argparse
import json
import os
import re
import warnings
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    # Load environment variables from a local .env if python-dotenv is available.
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    # Fallback gracefully when python-dotenv is not installed.
    pass

from openai import OpenAI

ISO = "%Y-%m-%dT%H:%M:%SZ"
DEFAULT_CONVERSATION_ROOT = Path(__file__).resolve().parent / "conversations"
TITLE_STOPWORDS = {
    "the",
    "and",
    "for",
    "are",
    "you",
    "your",
    "with",
    "from",
    "that",
    "this",
    "what",
    "when",
    "where",
    "which",
    "will",
    "would",
    "could",
    "should",
    "have",
    "has",
    "had",
    "into",
    "about",
    "need",
    "help",
    "please",
    "make",
    "how",
    "can",
    "why",
    "does",
    "like",
    "want",
    "just",
    "been",
    "some",
    "more",
    "any",
    "guide",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime(ISO)


def create_openai_client() -> OpenAI:
    """Return an OpenAI client optionally wrapped with Langfuse tracing."""
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    if public_key and secret_key:
        try:
            # type: ignore[import-not-found]
            from langfuse.openai import LangfuseOpenAI

            return LangfuseOpenAI()
        except ImportError:  # pragma: no cover - optional integration
            warnings.warn(
                "Langfuse environment variables detected but the 'langfuse' package is missing. "
                "Install it or unset the variables to silence this warning.",
                RuntimeWarning,
            )
    return OpenAI()


@dataclass
class Message:
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str
    timestamp: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    # token usage captured on assistant replies
    usage: Optional[Dict[str, int]] = None


@dataclass
class Conversation:
    conversation_id: str
    title: str
    model: str
    system_prompt: str
    created_at: str
    updated_at: str
    owner: Optional[str] = None
    messages: List[Message] = field(default_factory=list)
    participants: Dict[str, Any] = field(
        default_factory=lambda: {
            "user": {"name": "user"},
            "assistant": {"name": "assistant"},
        }
    )

    def to_api_messages(self) -> List[Dict[str, str]]:
        """Convert internal messages into the OpenAI Chat Completions 'messages' format."""
        msgs: List[Dict[str, str]] = []
        if self.system_prompt:
            msgs.append({"role": "system", "content": self.system_prompt})
        for m in self.messages:
            if m.role in ("system", "user", "assistant", "tool"):
                msgs.append({"role": m.role, "content": m.content})
        return msgs

    def add(
        self,
        role: str,
        content: str,
        *,
        usage: Optional[Dict[str, int]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.messages.append(
            Message(
                role=role,
                content=content,
                timestamp=utc_now(),
                metadata=metadata or {},
                usage=usage,
            )
        )
        self.updated_at = utc_now()


class ConversationStore:
    """Filesystem-backed JSON storage for conversations."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, cid: str) -> Path:
        safe = "".join(ch for ch in cid if ch.isalnum()
                       or ch in ("-", "_", "."))
        return self.root / f"{safe}.json"

    def exists(self, cid: str) -> bool:
        return self.path(cid).exists()

    def load(self, cid: str) -> Conversation:
        p = self.path(cid)
        data = json.loads(p.read_text(encoding="utf-8"))
        messages = [Message(**m) for m in data["messages"]]
        return Conversation(
            conversation_id=data["conversation_id"],
            title=data.get("title", data["conversation_id"]),
            model=data["model"],
            system_prompt=data.get("system_prompt", ""),
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            owner=data.get("owner"),
            messages=messages,
            participants=data.get(
                "participants",
                {"user": {"name": "user"}, "assistant": {"name": "assistant"}},
            ),
        )

    def save(self, conv: Conversation) -> None:
        p = self.path(conv.conversation_id)
        data = asdict(conv)
        # ensure dataclasses -> dict
        data["messages"] = [asdict(m) for m in conv.messages]
        p.write_text(json.dumps(data, indent=2,
                     ensure_ascii=False), encoding="utf-8")

    def create(
        self,
        cid: str,
        *,
        title: Optional[str] = None,
        model: str,
        system_prompt: str,
        owner: Optional[str] = None,
    ) -> Conversation:
        now = utc_now()
        conv = Conversation(
            conversation_id=cid,
            title=title or "New Conversation",
            model=model,
            system_prompt=system_prompt,
            created_at=now,
            updated_at=now,
            owner=owner,
        )
        self.save(conv)
        return conv

    def list_conversations(self) -> List[str]:
        return [p.stem for p in sorted(self.root.glob("*.json"))]


class Chatbot:
    """Thin wrapper around the OpenAI client + ConversationStore."""

    def __init__(
        self,
        client: OpenAI,
        store: ConversationStore,
        temperature: float = 0.7,
        top_p: float = 1.0,
    ):
        self.client = client
        self.store = store
        self.temperature = temperature
        self.top_p = top_p

    def send(self, cid: str, user_text: str) -> str:
        if not self.store.exists(cid):
            raise ValueError(
                f"Conversation '{cid}' does not exist. Run with --init to create it."
            )
        conv = self.store.load(cid)

        conv.add("user", user_text)
        if len(conv.messages) == 1 and _should_autoname(conv):
            conv.title = _generate_title_from_text(user_text)
        self.store.save(conv)

        # Call the Chat Completions API
        resp = self.client.chat.completions.create(
            model=conv.model,
            messages=conv.to_api_messages(),
            temperature=self.temperature,
            top_p=self.top_p,
        )
        ai_text = resp.choices[0].message.content
        usage_dict = getattr(resp, "usage", None)
        usage = None
        if usage_dict is not None:
            # model_dump is available in the SDK's pydantic models
            try:
                usage = {
                    k: int(v)
                    for k, v in usage_dict.model_dump().items()
                    if isinstance(v, (int,))
                }
            except Exception:
                # fallback
                usage = {
                    "prompt_tokens": getattr(usage_dict, "prompt_tokens", None),
                    "completion_tokens": getattr(usage_dict, "completion_tokens", None),
                    "total_tokens": getattr(usage_dict, "total_tokens", None),
                }

        conv.add("assistant", ai_text, usage=usage)
        self.store.save(conv)
        return ai_text


def _should_autoname(conv: Conversation) -> bool:
    title = (conv.title or "").strip().lower()
    if not title:
        return True
    if title == conv.conversation_id.lower():
        return True
    if title.startswith("conversation "):
        return True
    if title in {"new conversation", "untitled conversation"}:
        return True
    return False


def _generate_title_from_text(text: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9' ]+", " ", text).strip()
    if not cleaned:
        return "New Conversation"
    words = [part for part in cleaned.split() if part]
    if not words:
        return "New Conversation"
    meaningful = [word for word in words if len(
        word) > 2 and word.lower() not in TITLE_STOPWORDS]
    candidates = meaningful or words
    title_parts = candidates[:2]
    formatted = [part.capitalize() if not part.isupper()
                 else part for part in title_parts]
    title = " ".join(formatted)
    return title or "New Conversation"


def parse_args():
    ap = argparse.ArgumentParser(
        description="Multi-Turn Chatbot using OpenAI Chat Completions. Saves/loads JSON history per conversation id."
    )
    ap.add_argument(
        "--id",
        required=True,
        help="Conversation id (becomes the JSON filename).",
    )
    ap.add_argument(
        "--model",
        default=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        help="Model for Chat Completions (default: gpt-4o-mini).",
    )
    ap.add_argument(
        "--system",
        default="You are a helpful assistant.",
        help="System prompt text. Use @path/to/file.txt to load from a file.",
    )
    ap.add_argument(
        "--root",
        default=str(DEFAULT_CONVERSATION_ROOT),
        help="Directory to store conversation JSON files.",
    )
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--top_p", type=float, default=1.0)
    ap.add_argument("--list", action="store_true",
                    help="List existing conversations and exit.")
    ap.add_argument("--init", action="store_true",
                    help="Create (or overwrite) the conversation and exit.")
    return ap.parse_args()


def main():
    args = parse_args()
    store = ConversationStore(Path(args.root))

    if args.list:
        print("Existing conversations:")
        for cid in store.list_conversations():
            print(f" - {cid}")
        return

    # Allow @file.txt syntax for the system prompt
    system_prompt = args.system
    if system_prompt.startswith("@"):
        p = Path(system_prompt[1:])
        system_prompt = p.read_text(encoding="utf-8")

    if args.init or not store.exists(args.id):
        if store.exists(args.id):
            print(f"Overwriting existing conversation '{args.id}'...")
        conv = store.create(
            args.id,
            title=args.id,
            model=args.model,
            system_prompt=system_prompt,
        )
        print(f"Initialized conversation '{args.id}' with model={args.model}")
    else:
        conv = store.load(args.id)
        print(
            f"Loaded conversation '{args.id}' (model={conv.model}). Messages so far: {len(conv.messages)}"
        )

    # Initialize OpenAI client (uses OPENAI_API_KEY from env)
    client = create_openai_client()
    bot = Chatbot(client, store, temperature=args.temperature,
                  top_p=args.top_p)

    print("Type your message and press Enter. Commands: /exit, /history, /system <new system prompt or @file>")
    while True:
        try:
            user_text = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            break
        if not user_text:
            continue
        cmd = user_text.lower()
        if cmd in ("/exit", ":q", "/quit"):
            break
        if cmd == "/history":
            conv = store.load(args.id)
            for m in conv.messages[-20:]:
                print(f"[{m.timestamp}] {m.role.upper()}: {m.content}")
            continue
        if user_text.startswith("/system "):
            new_sp = user_text[len("/system "):].strip()
            if new_sp.startswith("@"):
                new_sp = Path(new_sp[1:]).read_text(encoding="utf-8")
            conv = store.load(args.id)
            conv.system_prompt = new_sp
            store.save(conv)
            print("System prompt updated.")
            continue

        reply = bot.send(args.id, user_text)
        print(f"Assistant: {reply}\n")


if __name__ == "__main__":
    main()
