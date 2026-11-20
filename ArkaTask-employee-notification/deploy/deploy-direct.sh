#!/bin/bash
# Backup deploy without Jenkins. Run on the VM as ubuntu:
#   cd /opt/arkatasks/ArkaTask-employee-notification && bash deploy/deploy-direct.sh
# Builds the linux/arm64 images, pushes them when the Docker Hub token from the last workflow
# run is on the VM, then starts the stack and runs the health check. Maven tests are skipped;
# the Docker build still compiles every service.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

secrets=/etc/arkatasks/jenkins-secrets
sudo -n bash "$APP_DIR/deploy/ensure-tls-cert.sh" "$(tls_cert_dir)"
bash "$APP_DIR/deploy/build-arm.sh"

if token="$(sudo -n cat "$secrets/DOCKERHUB_TOKEN" 2>/dev/null)" && [ -n "$token" ]; then
  printf '%s' "$token" | docker_cmd login docker.io --username "$DOCKERHUB_USERNAME" --password-stdin
  unset token
  bash "$APP_DIR/deploy/push-images.sh"
  docker_cmd logout docker.io >/dev/null
  PULL=1 bash "$APP_DIR/deploy/compose-up.sh"
else
  echo "No Docker Hub token on this VM. Running the images built here without pushing."
  PULL=0 bash "$APP_DIR/deploy/compose-up.sh"
fi
bash "$APP_DIR/deploy/health-check.sh"
docker_cmd image prune -f >/dev/null
