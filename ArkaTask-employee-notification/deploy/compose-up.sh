#!/bin/bash
# Deploy stage: pull the Docker Hub images, then start or update the stack and wait until healthy.
# PULL=0 skips the pull (deploy-direct.sh without Docker Hub credentials uses local images).
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

cert_dir="$(tls_cert_dir)"
if [ ! -r "$cert_dir/tls.crt" ]; then
  echo "ERROR: no TLS certificate in ${cert_dir}. Run: sudo bash deploy/ensure-tls-cert.sh ${cert_dir}" >&2
  exit 1
fi

# A new hash recreates the nginx container, so template changes take effect.
NGINX_CONF_HASH="$(cat "$APP_DIR"/nginx/*.template | sha256sum | cut -c1-16)"
export NGINX_CONF_HASH

if [ "${PULL:-1}" = "1" ]; then
  compose pull --quiet
fi
compose up -d --no-build --remove-orphans --wait --wait-timeout 600
compose ps
