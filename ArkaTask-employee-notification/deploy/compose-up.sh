#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ECR_REGISTRY:?Set ECR_REGISTRY}"
mkdir -p "$(dirname "$PWD")/out"
touch .env
grep -q '^ECR_REGISTRY=' .env || echo "ECR_REGISTRY=$ECR_REGISTRY" >> .env

if docker info >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(sudo docker compose)
fi

"${DC[@]}" -f docker-compose.yml -f docker-compose.ecr.yml pull
"${DC[@]}" -f docker-compose.yml -f docker-compose.ecr.yml up -d --no-build --remove-orphans
"${DC[@]}" -f docker-compose.yml -f docker-compose.ecr.yml ps
