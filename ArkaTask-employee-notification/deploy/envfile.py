#!/usr/bin/env python3
"""Read or replace one KEY=value line in ./.env without printing other values.

  envfile.py KEY VALUE   write KEY="VALUE" (quoted for docker compose)
  envfile.py --get KEY   print the value of KEY, or nothing
"""

import pathlib
import sys

PATH = pathlib.Path(".env")


def read(key: str) -> str:
    if not PATH.exists():
        return ""
    for line in PATH.read_text().splitlines():
        if line.startswith(key + "="):
            value = line.split("=", 1)[1].strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            return value
    return ""


def write(key: str, value: str) -> None:
    if not key or any(ch in value for ch in "\n\r"):
        raise SystemExit(f"{key} must be a single line")
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    line = f'{key}="{escaped}"'
    existing = PATH.read_text().splitlines() if PATH.exists() else []
    out = [line if current.startswith(key + "=") else current for current in existing]
    if line not in out:
        out.append(line)
    PATH.write_text("\n".join(out) + "\n")


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--get":
        print(read(sys.argv[2]))
    elif len(sys.argv) == 3:
        write(sys.argv[1], sys.argv[2])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
