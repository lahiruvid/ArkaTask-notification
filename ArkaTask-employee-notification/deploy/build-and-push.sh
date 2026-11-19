#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-eu-west-3}"
REGISTRY="${ECR_REGISTRY:?Set ECR_REGISTRY}"
REPO="${ECR_REPO:-arkatasks-employee-notification}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

if [ "${SKIP_FRONTEND:-}" != "1" ]; then
  bash "$ROOT/deploy/build-frontend.sh"
fi
docker build -f "$ROOT/Dockerfile.frontend" -t "$REGISTRY/$REPO:nginx" "$ROOT/.."
docker push "$REGISTRY/$REPO:nginx"

build() {
  local tag="$1"
  local dir="$2"
  docker build -t "$REGISTRY/$REPO:$tag" "$ROOT/$dir"
  docker push "$REGISTRY/$REPO:$tag"
}

build eureka employee-service/eureka-server
build login-service employee-service/login-service
build clean-event-service employee-service/clean-event-service
build owner-notifier owner-notifier
