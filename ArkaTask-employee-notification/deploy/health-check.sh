#!/bin/bash
# Host checks: nginx on port 80 and the services published on 127.0.0.1.
set -euo pipefail
cd "$(dirname "$0")/.."

if docker info >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(sudo docker compose)
fi
compose() {
  "${DC[@]}" -f docker-compose.yml -f docker-compose.registry.yml "$@"
}

wait_url() {
  local url="$1"
  local attempt code
  for attempt in $(seq 1 60); do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)
    if [ "$code" = "200" ]; then
      echo "ok ${url}"
      return 0
    fi
    echo "wait ${url} -> ${code:-none} (${attempt}/60)"
    sleep 5
  done
  echo "ERROR: ${url} did not return 200" >&2
  return 1
}

wait_url "http://127.0.0.1/"
wait_url "http://127.0.0.1:18081/actuator/health"
wait_url "http://127.0.0.1:18082/actuator/health"
wait_url "http://127.0.0.1:9411/health"

compose ps
if [ -n "$(compose ps --status exited -q || true)" ]; then
  echo "ERROR: a container exited" >&2
  compose ps -a
  exit 1
fi
echo "stack is up"
