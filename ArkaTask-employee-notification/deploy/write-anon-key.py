#!/usr/bin/env python3
"""Validate a Supabase anon key and optionally write seed/supabase-keys.json.

The service_role key and sb_secret_ keys are refused. Pass --check to validate
without writing a file. Reads SUPABASE_URL and SUPABASE_ANON_KEY from the
environment. Never prints the key.
"""

import base64
import json
import os
import pathlib
import sys


def fail(message: str) -> None:
    raise SystemExit(message)


def require_public_key(key: str) -> None:
    lower = key.lower()
    if lower.startswith("sb_secret_"):
        fail("SUPABASE_ANON_KEY is a Supabase secret key. Only the anon or publishable key is allowed.")
    if lower.startswith("sb_publishable_"):
        return
    parts = key.split(".")
    if len(parts) != 3:
        fail("SUPABASE_ANON_KEY must be an anon JWT or an sb_publishable_ key.")
    padded = parts[1] + "=" * ((4 - len(parts[1]) % 4) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        fail("SUPABASE_ANON_KEY is not a valid anon JWT.")
    if payload.get("role") != "anon":
        fail("Only the Supabase anon key is allowed, never service_role.")


def main() -> None:
    check_only = "--check" in sys.argv[1:]
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = "".join(os.environ.get("SUPABASE_ANON_KEY", "").split())
    if not url.startswith("https://") or " " in url:
        fail("SUPABASE_URL must look like https://<project-ref>.supabase.co")
    if not key:
        fail("SUPABASE_ANON_KEY is empty")
    require_public_key(key)
    if check_only:
        return
    path = pathlib.Path("seed/supabase-keys.json")
    path.parent.mkdir(mode=0o750, exist_ok=True)
    path.write_text(json.dumps({"supabaseUrl": url, "supabaseAnonKey": key}) + "\n")
    path.chmod(0o640)


if __name__ == "__main__":
    main()
