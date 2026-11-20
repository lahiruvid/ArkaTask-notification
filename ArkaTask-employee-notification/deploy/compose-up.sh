#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

read_env_key() {
  python3 - "$1" <<'PY'
import pathlib, sys
key = sys.argv[1]
path = pathlib.Path(".env")
if not path.exists():
    raise SystemExit(0)
for line in path.read_text().splitlines():
    if line.startswith(key + "="):
        value = line.split("=", 1)[1].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        print(value)
        break
PY
}

if [ -z "${REGISTRY:-}" ]; then
  REGISTRY="$(read_env_key REGISTRY || true)"
fi
if [ -z "${REGISTRY:-}" ] && [ -n "${ECR_REGISTRY:-}" ]; then
  REGISTRY="$ECR_REGISTRY"
fi
if [ -z "${REGISTRY:-}" ]; then
  echo "ERROR: Set REGISTRY to an image prefix such as local or fra.ocir.io/<namespace>." >&2
  echo "ECR_REGISTRY is still accepted as a fallback." >&2
  exit 1
fi
export REGISTRY
python3 deploy/envfile.py REGISTRY "$REGISTRY"

# Project URL and anon key stay empty until POST /api/login. Do not require them here.
if [ -n "${SUPABASE_URL:-}" ]; then
  python3 deploy/envfile.py SUPABASE_URL "${SUPABASE_URL%/}"
fi
if [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  python3 deploy/envfile.py SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY"
fi

if getent group jenkins >/dev/null 2>&1; then
  chgrp jenkins .env 2>/dev/null || sudo -n chgrp jenkins .env 2>/dev/null || true
fi
chmod 660 .env 2>/dev/null || sudo -n chmod 660 .env 2>/dev/null || true

if docker info >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(sudo docker compose)
fi

"${DC[@]}" -f docker-compose.yml -f docker-compose.registry.yml up -d --no-build --remove-orphans
"${DC[@]}" -f docker-compose.yml -f docker-compose.registry.yml ps
