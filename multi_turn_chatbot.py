"""Compatibility shim for the CLI chatbot entry point.

The full implementation now lives in ``backend.multi_turn_chatbot``. This
module simply forwards execution so existing commands like
``python multi_turn_chatbot.py`` keep working after the repository was
restructured into /frontend and /backend packages.
"""

from __future__ import annotations

from backend.multi_turn_chatbot import main


if __name__ == "__main__":  # pragma: no cover
    main()
