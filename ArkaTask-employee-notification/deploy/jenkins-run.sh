#!/bin/bash
# Trigger arkatasks-deploy and wait. Run as root on the VM.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/jenkins-run.sh" >&2
  exit 1
fi

PASS_FILE=/etc/arkatasks/jenkins-secrets/JENKINS_ADMIN_PASSWORD
BASE=http://127.0.0.1:8080
JOB=arkatasks-deploy
COOKIE=$(mktemp)
CURL_CFG=$(mktemp)
trap 'rm -f "$COOKIE" "$CURL_CFG"' EXIT
chmod 600 "$COOKIE" "$CURL_CFG"

python3 - "$PASS_FILE" "$CURL_CFG" <<'PY'
import pathlib, sys
password = pathlib.Path(sys.argv[1]).read_text().strip()
if not password:
    raise SystemExit("Jenkins admin password file is empty")
escaped = password.replace("\\", "\\\\").replace('"', '\\"')
pathlib.Path(sys.argv[2]).write_text(f'user = "admin:{escaped}"\nsilent\nshow-error\n')
PY

ready=0
for _ in $(seq 1 60); do
  if curl --config "$CURL_CFG" -o /dev/null --max-time 5 "${BASE}/login"; then
    ready=1
    break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  echo "Jenkins did not answer on 127.0.0.1:8080" >&2
  exit 1
fi

job_ready=0
for _ in $(seq 1 30); do
  code=$(curl --config "$CURL_CFG" -o /dev/null -w '%{http_code}' "${BASE}/job/${JOB}/api/json" || true)
  if [ "$code" = "200" ]; then
    job_ready=1
    break
  fi
  sleep 4
done
if [ "$job_ready" -ne 1 ]; then
  echo "Jenkins job ${JOB} is not defined" >&2
  exit 1
fi

crumb_field=""
crumb_value=""
crumb_json=$(mktemp)
crumb_code=$(curl --config "$CURL_CFG" -c "$COOKIE" -o "$crumb_json" -w '%{http_code}' "${BASE}/crumbIssuer/api/json" || true)
if [ "$crumb_code" = "200" ]; then
  crumb_field=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["crumbRequestField"])' "$crumb_json")
  crumb_value=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["crumb"])' "$crumb_json")
fi
rm -f "$crumb_json"

headers=$(mktemp)
curl_args=(--config "$CURL_CFG" -b "$COOKIE" -c "$COOKIE" -D "$headers" -o /dev/null -X POST "${BASE}/job/${JOB}/build")
if [ -n "$crumb_field" ]; then
  curl_args+=(-H "${crumb_field}: ${crumb_value}")
fi
curl "${curl_args[@]}"
location=$(awk 'tolower($1) == "location:" { print $2 }' "$headers" | tr -d '\r' | tail -n 1)
rm -f "$headers"
if [ -z "$location" ]; then
  echo "Jenkins did not return a queue location for ${JOB}" >&2
  exit 1
fi
case "$location" in
  */) ;;
  *) location="${location}/" ;;
esac

build_url=""
queue_deadline=$((SECONDS + 300))
while [ "$SECONDS" -lt "$queue_deadline" ]; do
  body=$(curl --config "$CURL_CFG" -b "$COOKIE" -c "$COOKIE" "${location}api/json" || true)
  build_url=$(printf '%s' "$body" | python3 -c 'import json,sys
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)
if data.get("cancelled"):
    print("CANCELLED")
    raise SystemExit(0)
exe = data.get("executable") or {}
print(exe.get("url") or "")')
  if [ "$build_url" = "CANCELLED" ]; then
    echo "Jenkins cancelled the queued build" >&2
    exit 1
  fi
  if [ -n "$build_url" ]; then
    break
  fi
  sleep 2
done
if [ -z "$build_url" ]; then
  echo "Jenkins did not start a build from ${location}" >&2
  exit 1
fi
case "$build_url" in
  */) ;;
  *) build_url="${build_url}/" ;;
esac
echo "Jenkins build: ${build_url}"

result=""
deadline=$((SECONDS + 90 * 60))
while [ "$SECONDS" -lt "$deadline" ]; do
  body=$(curl --config "$CURL_CFG" -b "$COOKIE" "${build_url}api/json")
  result=$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("result") or "")')
  if [ -n "$result" ]; then
    break
  fi
  sleep 10
done

echo "===== Jenkins console ====="
curl --config "$CURL_CFG" -b "$COOKIE" "${build_url}consoleText" || true
echo "===== result: ${result:-TIMEOUT} ====="
[ "$result" = "SUCCESS" ]
