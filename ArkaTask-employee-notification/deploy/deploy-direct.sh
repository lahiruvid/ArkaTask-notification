#!/bin/bash
# Fallback when Jenkins is down: build the four linux/arm64 Java images and start compose.
# Does not build the frontend or start a Postgres container.
# Run from anywhere on the VM:
#   cd /opt/arkatasks/ArkaTask-employee-notification
#   bash deploy/deploy-direct.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash deploy/jenkins-build.sh
bash deploy/compose-up.sh
bash deploy/seed-anon-key.sh
bash deploy/health-check.sh
