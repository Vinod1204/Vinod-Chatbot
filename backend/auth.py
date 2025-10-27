from __future__ import annotations

from passlib.context import CryptContext

# Use PBKDF2-SHA256 to avoid the native bcrypt dependency and 72 byte limit.
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_password(password: str) -> str:
    """Return a PBKDF2-SHA256 hash for the provided password."""
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    """Check that a plaintext password matches a stored hash."""
    try:
        return pwd_context.verify(password, hashed)
    except Exception:
        return False
