"""Entrypoint for running the FastAPI application."""
from __future__ import annotations

import os

import uvicorn

from .server import app


def main() -> None:
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
