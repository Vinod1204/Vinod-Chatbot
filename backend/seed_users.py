from __future__ import annotations

import argparse
from typing import Dict, List, Tuple

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover - optional dependency
    pass

from .auth import hash_password
from .db import ensure_user_indexes, get_users_collection
from .multi_turn_chatbot import utc_now
from pymongo.errors import DuplicateKeyError

DEMO_USERS: List[Dict[str, str]] = [
    {
        "email": "alice@example.com",
        "password": "Password123!",
        "name": "Alice Example",
    },
    {
        "email": "bob@example.com",
        "password": "Password123!",
        "name": "Bob Example",
    },
    {
        "email": "charlie@example.com",
        "password": "Password123!",
        "name": "Charlie Example",
    },
]


def parse_fields(raw_fields: list[str]) -> Dict[str, str]:
    extra: Dict[str, str] = {}
    for entry in raw_fields:
        if "=" not in entry:
            raise ValueError(f"Invalid field '{entry}'. Use key=value format.")
        key, value = entry.split("=", 1)
        key = key.strip()
        if not key:
            raise ValueError("Field names cannot be empty.")
        extra[key] = value.strip()
    return extra


def seed_user(email: str, password: str, name: str | None, extra_fields: Dict[str, str]) -> str:
    ensure_user_indexes()
    collection = get_users_collection()
    now = utc_now()
    document: Dict[str, str | None] = {
        "email": email.lower(),
        "password": hash_password(password),
        "name": name.strip() if name else None,
        "createdAt": now,
        "updatedAt": now,
    }
    document.update(extra_fields)
    try:
        result = collection.insert_one(document)
    except DuplicateKeyError as exc:
        raise ValueError(
            f"User with email '{email.lower()}' already exists.") from exc
    return str(result.inserted_id)


def seed_demo_users(extra_fields: Dict[str, str]) -> Tuple[List[Tuple[str, str]], List[str]]:
    created: List[Tuple[str, str]] = []
    skipped: List[str] = []
    for user in DEMO_USERS:
        try:
            user_id = seed_user(
                user["email"], user["password"], user.get("name"), extra_fields)
            created.append((user["email"], user_id))
        except ValueError:
            skipped.append(user["email"])
    return created, skipped


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed user records into MongoDB.")
    parser.add_argument("--email",
                        help="User email address (unique). Required unless --demo is used.")
    parser.add_argument("--password",
                        help="Plaintext password to hash before storing. Required unless --demo is used.")
    parser.add_argument("--name", help="Display name for the user.")
    parser.add_argument(
        "--field",
        action="append",
        default=[],
        help="Additional key=value pairs to include in the document.",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Insert a set of demo users (alice/bob/charlie) with known credentials.",
    )
    args = parser.parse_args()

    extra = parse_fields(args.field)
    if args.demo:
        created, skipped = seed_demo_users(extra)
        if created:
            for email, user_id in created:
                print(f"Inserted demo user {email} with id: {user_id}")
        if skipped:
            for email in skipped:
                print(f"Skipped demo user {email}: already exists")
        if not created and not skipped:
            print("No demo users processed.")
        return

    if not args.email or not args.password:
        parser.error(
            "--email and --password are required when --demo is not provided.")

    try:
        user_id = seed_user(args.email, args.password, args.name, extra)
    except ValueError as exc:
        parser.error(str(exc))
    print(f"Inserted user with id: {user_id}")


if __name__ == "__main__":
    main()
