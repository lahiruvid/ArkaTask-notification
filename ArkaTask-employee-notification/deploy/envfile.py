#!/usr/bin/env python3
"""Replace one KEY=value line in ./.env. Values are quoted and not printed."""

import pathlib
import sys

if len(sys.argv) != 3:
    raise SystemExit("usage: envfile.py KEY VALUE")

key, value = sys.argv[1], sys.argv[2]
if not key or any(ch in value for ch in "\n\r"):
    raise SystemExit(f"{key} must be a single line")

escaped = value.replace("\\", "\\\\").replace('"', '\\"')
line = f'{key}="{escaped}"'
path = pathlib.Path(".env")
existing = path.read_text().splitlines() if path.exists() else []
out = []
found = False
for current in existing:
    if current.startswith(key + "="):
        out.append(line)
        found = True
    else:
        out.append(current)
if not found:
    out.append(line)
path.write_text("\n".join(out) + "\n")
try:
    path.chmod(0o660)
except PermissionError:
    pass
