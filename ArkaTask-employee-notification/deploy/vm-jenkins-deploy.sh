#!/bin/bash
# Runs on the VM over SSH after the repo sync. Writes .env, configures Jenkins, triggers the job.
set -euo pipefail
cd /opt/arkatasks/ArkaTask-employee-notification

: "${JENKINS_ADMIN_PASSWORD:?JENKINS_ADMIN_PASSWORD is required}"

python3 deploy/envfile.py REGISTRY "${REGISTRY:-local}"
# Leave Supabase URL and anon key empty. POST /api/login fills the keys file.
sudo chgrp jenkins .env
sudo chmod 660 .env

if [ -n "${SUPABASE_ANON_KEY:-}" ]; then
  python3 deploy/write-anon-key.py
  sudo chgrp jenkins seed seed/supabase-keys.json
  sudo chmod 750 seed
  sudo chmod 640 seed/supabase-keys.json
else
  rm -rf seed
fi

if [ -z "${OCIR_AUTH_TOKEN:-}" ]; then
  rm -f .ocir.env
fi

if [ -n "${OCIR_AUTH_TOKEN:-}" ]; then
  : "${OCIR_REGION_KEY:?}"
  : "${OCIR_NAMESPACE:?}"
  : "${OCIR_USERNAME:?}"
  python3 - <<'PY'
import os, pathlib, shlex
lines = [
    f"OCIR_REGION_KEY={shlex.quote(os.environ['OCIR_REGION_KEY'])}",
    f"OCIR_NAMESPACE={shlex.quote(os.environ['OCIR_NAMESPACE'])}",
    f"OCIR_USERNAME={shlex.quote(os.environ['OCIR_USERNAME'])}",
    f"OCIR_AUTH_TOKEN={shlex.quote(os.environ['OCIR_AUTH_TOKEN'])}",
]
path = pathlib.Path(".ocir.env")
path.write_text("\n".join(lines) + "\n")
path.chmod(0o640)
PY
  sudo chgrp jenkins .ocir.env
  sudo chmod 640 .ocir.env
fi

printf '%s\n' "$JENKINS_ADMIN_PASSWORD" | sudo tee /etc/arkatasks/jenkins-admin.password >/dev/null
sudo chmod 600 /etc/arkatasks/jenkins-admin.password
sudo chown jenkins:jenkins /etc/arkatasks/jenkins-admin.password

sudo bash deploy/arkatasks-configure-jenkins.sh
sudo bash deploy/jenkins-run.sh
