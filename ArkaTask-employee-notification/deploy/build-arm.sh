#!/bin/bash
# Docker build stage: the four Java images for linux/arm64, from the same Dockerfiles used locally.
# The Oracle A1 VM is arm64, so this is a native build (no QEMU).
# Tags: docker.io/$DOCKERHUB_USERNAME/arkatasks-employee-notification:<service> and :<service>-<sha>.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

PLATFORM="${PLATFORM:-linux/arm64}"
repo="$(image_repo)"
sha="$(commit_sha)"

for spec in "${IMAGES[@]}"; do
  tag="${spec%%:*}"
  context="${spec#*:}"
  echo "== ${repo}:${tag} (${PLATFORM}, ${sha})"
  docker_cmd build --pull --platform "$PLATFORM" \
    --tag "${repo}:${tag}" \
    --tag "${repo}:${tag}-${sha}" \
    "$APP_DIR/$context"
done
