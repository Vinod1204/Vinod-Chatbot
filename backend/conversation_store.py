from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, Iterator, List, Optional

from pymongo import ASCENDING, DESCENDING
from pymongo.collection import Collection

try:  # pragma: no cover - support execution as top-level module
    from .multi_turn_chatbot import Conversation, Message, utc_now
except ImportError:  # pragma: no cover - fallback when executed as a script
    # type: ignore[no-redef]
    from multi_turn_chatbot import Conversation, Message, utc_now

_DEFAULT_PARTICIPANTS: Dict[str, Dict[str, str]] = {
    "user": {"name": "user"},
    "assistant": {"name": "assistant"},
}


def _message_from_document(data: Dict[str, Any]) -> Message:
    return Message(
        role=str(data.get("role", "assistant")),
        content=str(data.get("content", "")),
        timestamp=str(data.get("timestamp") or utc_now()),
        metadata=dict(data.get("metadata") or {}),
        usage=data.get("usage"),
    )


def _conversation_from_document(document: Dict[str, Any]) -> Conversation:
    messages_data = document.get("messages") or []
    messages = [_message_from_document(item) for item in messages_data]
    participants = document.get("participants") or dict(_DEFAULT_PARTICIPANTS)
    return Conversation(
        conversation_id=str(document["conversation_id"]),
        title=str(document.get("title") or document["conversation_id"]),
        model=str(document.get("model", "gpt-4o-mini")),
        system_prompt=str(document.get("system_prompt", "")),
        created_at=str(document.get("created_at") or utc_now()),
        updated_at=str(document.get("updated_at") or utc_now()),
        owner=document.get("owner"),
        messages=messages,
        participants=participants,
    )


def _conversation_to_document(conversation: Conversation) -> Dict[str, Any]:
    payload = asdict(conversation)
    payload.pop("messages", None)
    payload["messages"] = [asdict(message)
                           for message in conversation.messages]
    return payload


class MongoConversationStore:
    """MongoDB-backed persistence for conversations."""

    def __init__(self, collection: Collection):
        self.collection = collection

    def ensure_indexes(self) -> None:
        self.collection.create_index("conversation_id", unique=True)
        self.collection.create_index(
            [("owner", ASCENDING), ("updated_at", DESCENDING)],
            name="conversation_owner_updated",
        )

    def list_conversations(self, owner: Optional[str] = None) -> List[str]:
        query: Dict[str, Any] = {}
        if owner is not None:
            query["owner"] = owner
        cursor = self.collection.find(
            query, {"conversation_id": 1}).sort("updated_at", DESCENDING)
        return [str(item["conversation_id"]) for item in cursor]

    def iter_owner(self, owner: str) -> Iterator[Conversation]:
        cursor = self.collection.find(
            {"owner": owner}).sort("updated_at", DESCENDING)
        for document in cursor:
            yield _conversation_from_document(document)

    def exists(self, conversation_id: str) -> bool:
        return self.collection.count_documents({"conversation_id": conversation_id}, limit=1) > 0

    def load(self, conversation_id: str) -> Conversation:
        document = self.collection.find_one(
            {"conversation_id": conversation_id})
        if document is None:
            raise FileNotFoundError(
                f"Conversation '{conversation_id}' not found")
        return _conversation_from_document(document)

    def save(self, conversation: Conversation) -> None:
        document = _conversation_to_document(conversation)
        self.collection.replace_one(
            {"conversation_id": conversation.conversation_id},
            document,
            upsert=True,
        )

    def create(
        self,
        conversation_id: str,
        *,
        title: Optional[str] = None,
        model: str,
        system_prompt: str,
        owner: Optional[str] = None,
    ) -> Conversation:
        now = utc_now()
        conversation = Conversation(
            conversation_id=conversation_id,
            title=title or "New Conversation",
            model=model,
            system_prompt=system_prompt,
            created_at=now,
            updated_at=now,
            owner=owner,
        )
        self.save(conversation)
        return conversation

    def delete(self, conversation_id: str) -> None:
        result = self.collection.delete_one(
            {"conversation_id": conversation_id})
        if result.deleted_count == 0:
            raise FileNotFoundError(
                f"Conversation '{conversation_id}' not found")
