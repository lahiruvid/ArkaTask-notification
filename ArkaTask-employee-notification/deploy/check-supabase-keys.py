#!/usr/bin/env python3
"""Validate the optional public Supabase values before they reach the VM.

Reads SUPABASE_URL and SUPABASE_ANON_KEY from the environment. Both may be empty.
SUPABASE_URL must be https://<project-ref>.supabase.co. SUPABASE_ANON_KEY, when set,
must be the anon JWT or an sb_publishable_ key; a service_role JWT or an sb_secret_
key is refused. Never prints the key.
"""

import base64
import json
import os
import re
import sys


def fail(message: str) -> None:
    print(f"::error::{message}", file=sys.stderr)
    raise SystemExit(1)


def check_key(key: str) -> None:
    lower = key.lower()
    if lower.startswith("sb_secret_"):
        fail("SUPABASE_ANON_KEY is a Supabase secret key. Only the anon or publishable key is allowed.")
    if lower.startswith("sb_publishable_"):
        return
    parts = key.split(".")
    if len(parts) != 3:
        fail("SUPABASE_ANON_KEY must be the anon JWT or an sb_publishable_ key.")
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except Exception:
        fail("SUPABASE_ANON_KEY is not a valid JWT.")
    if payload.get("role") != "anon":
        fail("SUPABASE_ANON_KEY must have role anon. A service_role key is never deployed.")


def main() -> None:
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = "".join(os.environ.get("SUPABASE_ANON_KEY", "").split())
    if key and not url:
        fail("SUPABASE_ANON_KEY is set but SUPABASE_URL is not.")
    if url and not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", url, re.IGNORECASE):
        fail("SUPABASE_URL must be https://<project-ref>.supabase.co")
    if key:
        check_key(key)


if __name__ == "__main__":
    main()
