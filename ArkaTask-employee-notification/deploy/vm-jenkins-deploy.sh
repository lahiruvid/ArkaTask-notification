#!/bin/bash
# Runs on the VM as ubuntu over SSH, after the workflow checked out the pushed commit in
# /opt/arkatasks. Writes .env and the Jenkins secret files, configures Jenkins, runs the job.
#
# Environment from the workflow: JENKINS_ADMIN_PASSWORD, DOCKERHUB_USERNAME, DOCKERHUB_TOKEN,
# and optionally SUPABASE_URL and SUPABASE_ANON_KEY (public values only).
set -euo pipefail
cd "$(dirname "$0")/.."

for name in JENKINS_ADMIN_PASSWORD DOCKERHUB_USERNAME DOCKERHUB_TOKEN; do
  if [ -z "${!name:-}" ]; then
    echo "ERROR: ${name} is required" >&2
    exit 1
  fi
done

SECRETS_DIR=/etc/arkatasks/jenkins-secrets
CERT_DIR=/etc/arkatasks/certs

# .env holds public settings only. The Docker Hub token is not in it.
python3 deploy/check-supabase-keys.py
python3 deploy/envfile.py DOCKERHUB_USERNAME "$DOCKERHUB_USERNAME"
python3 deploy/envfile.py TLS_CERT_DIR "$CERT_DIR"
if [ -n "${SUPABASE_URL:-}" ]; then
  python3 deploy/envfile.py SUPABASE_URL "${SUPABASE_URL%/}"
fi
if [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  python3 deploy/envfile.py SUPABASE_ANON_KEY "$(printf '%s' "$SUPABASE_ANON_KEY" | tr -d '[:space:]')"
fi
sudo chgrp jenkins .env
sudo chmod 640 .env

# One file per secret, read by Jenkins Configuration as Code (SECRETS directory).
sudo install -d -m 750 -o root -g jenkins "$SECRETS_DIR"
write_secret() {
  printf '%s' "$2" | sudo tee "${SECRETS_DIR}/$1" >/dev/null
  sudo chown jenkins:jenkins "${SECRETS_DIR}/$1"
  sudo chmod 600 "${SECRETS_DIR}/$1"
}
write_secret JENKINS_ADMIN_PASSWORD "$JENKINS_ADMIN_PASSWORD"
write_secret DOCKERHUB_USERNAME "$DOCKERHUB_USERNAME"
write_secret DOCKERHUB_TOKEN "$DOCKERHUB_TOKEN"
# Left by an earlier version of this script.
sudo rm -f /etc/arkatasks/jenkins-admin.password

sudo bash deploy/ensure-tls-cert.sh "$CERT_DIR"
sudo bash deploy/arkatasks-configure-jenkins.sh
sudo bash deploy/jenkins-run.sh
