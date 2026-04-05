"""
backend/services/supabase_client.py

Single shared Supabase client used throughout the SEIS backend.
Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from the .env file.
The service-role key bypasses RLS so all server-side operations
can read/write without additional policies.

Embedding dimension: 384  (all-MiniLM-L6-v2)
Storage bucket    : seis-files
"""

import logging
import os
import time
import traceback
from pathlib import Path
from typing import Callable, TypeVar

from dotenv import load_dotenv
from supabase import create_client, Client

# ── Logger ────────────────────────────────────────────────────────────────────
logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# ── .env resolution ───────────────────────────────────────────────────────────
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
logger.info("supabase_client: looking for .env at %s", _ENV_PATH)

if _ENV_PATH.exists():
    logger.info("supabase_client: .env file FOUND — loading")
    load_dotenv(dotenv_path=_ENV_PATH, override=True)
else:
    logger.warning(
        "supabase_client: .env file NOT FOUND at %s  "
        "(relying on variables already in the environment)",
        _ENV_PATH,
    )
    load_dotenv(dotenv_path=_ENV_PATH)

# ── Read env vars ─────────────────────────────────────────────────────────────
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")

_url_display = SUPABASE_URL if SUPABASE_URL else "<EMPTY>"
_key_display = (
    SUPABASE_SERVICE_KEY[:6] + "…" + SUPABASE_SERVICE_KEY[-4:]
    if len(SUPABASE_SERVICE_KEY) > 10
    else ("<EMPTY>" if not SUPABASE_SERVICE_KEY else "<SHORT>")
)
logger.info("supabase_client: SUPABASE_URL         = %s", _url_display)
logger.info("supabase_client: SUPABASE_SERVICE_KEY = %s", _key_display)

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    logger.error(
        "supabase_client: One or both required env vars are empty. "
        "SUPABASE_URL=%r  SUPABASE_SERVICE_KEY=%r",
        bool(SUPABASE_URL),
        bool(SUPABASE_SERVICE_KEY),
    )
    raise EnvironmentError(
        "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env"
    )

# ── Create the singleton client ───────────────────────────────────────────────
logger.info("supabase_client: calling create_client …")
try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    logger.info("supabase_client: create_client() succeeded ✓")
except Exception as exc:
    logger.error(
        "supabase_client: create_client() FAILED — %s\n%s",
        exc,
        traceback.format_exc(),
    )
    raise

BUCKET = "seis-files"
EMBEDDING_DIM = 384


# ── Connection-error helpers ──────────────────────────────────────────────────

_CONNECTION_ERROR_MARKERS = (
    "UNEXPECTED_EOF",
    "EOF occurred",
    "ConnectError",
    "RemoteProtocolError",
    "ConnectionReset",
    "BrokenPipe",
)


def _is_connection_error(exc: Exception) -> bool:
    """Return True if exc looks like a stale/dropped SSL/TCP connection."""
    msg = str(exc)
    return any(marker in msg for marker in _CONNECTION_ERROR_MARKERS)


def reconnect() -> Client:
    """
    Tear down the current singleton and create a fresh Supabase client.
    Call this whenever a connection error is detected so subsequent
    requests get a working connection.
    """
    global supabase
    print("[supabase_client] reconnect(): creating fresh client ...", flush=True)
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    print("[supabase_client] reconnect(): done", flush=True)
    return supabase


T = TypeVar("T")


def execute_with_retry(query_fn: Callable[[Client], T], max_retries: int = 3) -> T:
    """
    Execute a Supabase query with automatic reconnection on connection errors.

    Usage:
        resp = execute_with_retry(
            lambda sb: sb.table("folders").select("id").execute()
        )

    On a connection error the client is recreated and the query is retried
    up to max_retries times with brief back-off between attempts.
    """
    global supabase
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            return query_fn(supabase)
        except Exception as exc:
            last_exc = exc
            if _is_connection_error(exc):
                print(
                    f"[supabase_client] connection error on attempt {attempt}: {exc}"
                    f" -- reconnecting ...",
                    flush=True,
                )
                try:
                    reconnect()
                except Exception as rc_exc:
                    print(f"[supabase_client] reconnect failed: {rc_exc}", flush=True)
                time.sleep(0.4 * attempt)  # back-off: 0.4s, 0.8s, 1.2s
            else:
                raise  # non-connection errors propagate immediately
    raise last_exc  # type: ignore[misc]
