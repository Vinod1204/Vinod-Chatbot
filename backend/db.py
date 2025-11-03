from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from gridfs import GridFSBucket
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
    db_name = name or os.getenv("MONGODB_DB_NAME", "chatbot_db")
    return get_client()[db_name]


def get_users_collection() -> Collection:
    collection_name = os.getenv("MONGODB_USERS_COLLECTION", "users")
    return get_database()[collection_name]


def get_messages_collection() -> Collection:
    collection_name = os.getenv("MONGODB_MESSAGES_COLLECTION", "messages")
    database_name = os.getenv("MONGODB_MESSAGES_DB_NAME")
    return get_database(database_name)[collection_name]


def get_bug_reports_collection() -> Collection:
    collection_name = os.getenv("MONGODB_BUG_REPORTS_COLLECTION", "bug_reports")
    database_name = os.getenv("MONGODB_BUG_REPORTS_DB_NAME")
    return get_database(database_name)[collection_name]


def get_bug_report_files_bucket() -> GridFSBucket:
    bucket_name = os.getenv("MONGODB_BUG_REPORTS_BUCKET", "bug_report_files")
    return GridFSBucket(get_database(), bucket_name=bucket_name)


@lru_cache(maxsize=1)
def ensure_user_indexes() -> None:
    collection = get_users_collection()
    collection.create_index("email", unique=True)
    collection.create_index("providers.google.sub", unique=True, sparse=True)


@lru_cache(maxsize=1)
def ensure_bug_report_indexes() -> None:
    collection = get_bug_reports_collection()
    desired_partial = {"reportId": {"$type": "string"}}
    # Drop any legacy reportId index that lacks the tighter partial filter so we can recreate it safely.
    for name, details in collection.index_information().items():
        if details.get("key") == [("reportId", 1)] and details.get("partialFilterExpression") != desired_partial:
            collection.drop_index(name)
    collection.create_index(
        "reportId",
        unique=True,
        partialFilterExpression=desired_partial,
    )
    collection.create_index("submittedAt")
    collection.create_index("ownerId", sparse=True)
