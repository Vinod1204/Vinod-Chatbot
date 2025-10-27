from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

_CLIENT: Optional[MongoClient] = None


def get_client() -> MongoClient:
    """Return a cached MongoClient using environment configuration."""
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    uri = os.getenv("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI is not configured")
    _CLIENT = MongoClient(uri)
    return _CLIENT


def close_client() -> None:
    """Close the cached MongoClient if it exists."""
    global _CLIENT
    if _CLIENT is not None:
        _CLIENT.close()
        _CLIENT = None


def get_database(name: Optional[str] = None) -> Database:
    db_name = name or os.getenv("MONGODB_DB_NAME", "vinod_chatbot")
    return get_client()[db_name]


def get_users_collection() -> Collection:
    collection_name = os.getenv("MONGODB_USERS_COLLECTION", "users")
    return get_database()[collection_name]


@lru_cache(maxsize=1)
def ensure_user_indexes() -> None:
    collection = get_users_collection()
    collection.create_index("email", unique=True)
    collection.create_index("providers.google.sub", unique=True, sparse=True)
