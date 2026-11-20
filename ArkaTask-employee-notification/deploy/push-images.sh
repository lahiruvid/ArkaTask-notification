#!/bin/bash
# Push stage: send :<service> and :<service>-<sha> to Docker Hub. Needs a prior docker login.
# The local -<sha> tag is removed after the push; Docker Hub keeps it for rollbacks.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

repo="$(image_repo)"
sha="$(commit_sha)"

for spec in "${IMAGES[@]}"; do
  tag="${spec%%:*}"
  docker_cmd push --quiet "${repo}:${tag}"
  docker_cmd push --quiet "${repo}:${tag}-${sha}"
  docker_cmd image rm "${repo}:${tag}-${sha}" >/dev/null
done
echo "Pushed ${repo}:<service> and :<service>-${sha}"
