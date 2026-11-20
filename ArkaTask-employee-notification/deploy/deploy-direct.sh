#!/bin/bash
# Fallback when Jenkins is down: build linux/arm64 images and start compose.
# Run from anywhere on the VM:
#   cd /opt/arkatasks/ArkaTask-employee-notification
#   bash deploy/deploy-direct.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash deploy/jenkins-build.sh
bash deploy/compose-up.sh
bash deploy/seed-anon-key.sh
bash deploy/health-check.sh
