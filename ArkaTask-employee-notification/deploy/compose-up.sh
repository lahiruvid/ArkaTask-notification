#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ECR_REGISTRY:?Set ECR_REGISTRY}"
mkdir -p "$(dirname "$PWD")/out"
touch .env
grep -q '^ECR_REGISTRY=' .env || echo "ECR_REGISTRY=$ECR_REGISTRY" >> .env
# Supabase project URL (public). Java derives the JWKS URL and token issuer from it.
if [ -n "${SUPABASE_URL:-}" ]; then
  if grep -q '^SUPABASE_URL=' .env; then
    sed -i "s|^SUPABASE_URL=.*|SUPABASE_URL=${SUPABASE_URL}|" .env
  else
    echo "SUPABASE_URL=$SUPABASE_URL" >> .env
  fi
fi
if ! grep -Eq '^SUPABASE_URL=https://.+' .env; then
  echo "ERROR: SUPABASE_URL is not set. Export SUPABASE_URL=https://<project-ref>.supabase.co or add it to .env." >&2
  echo "login-service and clean-event-service refuse to start without it." >&2
  exit 1
fi

if docker info >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(sudo docker compose)
fi

"${DC[@]}" -f docker-compose.yml -f docker-compose.ecr.yml pull
"${DC[@]}" -f docker-compose.yml -f docker-compose.ecr.yml up -d --no-build --remove-orphans
"${DC[@]}" -f docker-compose.yml -f docker-compose.ecr.yml ps
