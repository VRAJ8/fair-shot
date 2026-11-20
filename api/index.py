"""Vercel entry point: serves the Fair Shot AI agent (a FastAPI app) as a Python function."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agent.server import app  # noqa: E402,F401  (Vercel serves this ASGI app)
