#!/bin/bash
# Choose local tags or OCIR, then build. Called by the Jenkinsfile.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${OCIR_AUTH_TOKEN:-}" ] && [ -f .ocir.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.ocir.env
  set +a
fi

if [ -n "${OCIR_AUTH_TOKEN:-}" ]; then
  : "${OCIR_REGION_KEY:?OCIR_REGION_KEY is required when OCIR_AUTH_TOKEN is set}"
  : "${OCIR_NAMESPACE:?OCIR_NAMESPACE is required when OCIR_AUTH_TOKEN is set}"
  : "${OCIR_USERNAME:?OCIR_USERNAME is required when OCIR_AUTH_TOKEN is set}"
  printf '%s' "$OCIR_AUTH_TOKEN" | docker login "${OCIR_REGION_KEY}.ocir.io" \
    --username "${OCIR_NAMESPACE}/${OCIR_USERNAME}" --password-stdin
  export REGISTRY="${OCIR_REGION_KEY}.ocir.io/${OCIR_NAMESPACE}"
  export PUSH_IMAGES=1
  echo "OCIR login succeeded for ${REGISTRY}"
else
  export REGISTRY="${REGISTRY:-local}"
  export PUSH_IMAGES=0
  echo "No OCIR credentials. Building ${REGISTRY}/arkatasks-employee-notification:* into the local engine."
fi

python3 deploy/envfile.py REGISTRY "$REGISTRY"
bash deploy/build-arm.sh
