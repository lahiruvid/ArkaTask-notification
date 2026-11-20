#!/bin/bash
# Build the app images for linux/arm64.
# Tags ${REGISTRY}/arkatasks-employee-notification:<service>.
# --push when PUSH_IMAGES=1 or the docker config already has a login for the
# registry host. Otherwise --load, which is what the VM uses for REGISTRY=local.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"
REGISTRY="${REGISTRY:-local}"
PLATFORM="${PLATFORM:-linux/arm64}"
IMAGE_NAME="${IMAGE_NAME:-arkatasks-employee-notification}"

host="${REGISTRY%%/*}"
config="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
push=0
if [ "$REGISTRY" != "local" ] && [ "${PUSH_IMAGES:-0}" = "1" ]; then
  push=1
elif [ "$REGISTRY" != "local" ] && [ -f "$config" ] && grep -Fq "\"${host}\"" "$config"; then
  push=1
fi

if [ "$push" -eq 1 ]; then
  output=(--push)
  echo "Pushing ${PLATFORM} images to ${REGISTRY}/${IMAGE_NAME}"
else
  output=(--load)
  echo "Loading ${PLATFORM} images locally as ${REGISTRY}/${IMAGE_NAME}:<service>"
fi

build() {
  local tag="$1"
  local context="$2"
  local dockerfile="${3:-${context}/Dockerfile}"
  docker buildx build \
    --platform "$PLATFORM" \
    --file "$dockerfile" \
    --tag "${REGISTRY}/${IMAGE_NAME}:${tag}" \
    "${output[@]}" \
    "$context"
}

build eureka "$APP_DIR/employee-service/eureka-server"
build login-service "$APP_DIR/employee-service/login-service"
build clean-event-service "$APP_DIR/employee-service/clean-event-service"
build owner-notifier "$APP_DIR/owner-notifier"
build nginx "$REPO_DIR" "$APP_DIR/Dockerfile.frontend"
