#!/bin/bash
# Health check stage: Nginx and each service answer, nothing exited, then the HTTP smoke test.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "$0")/lib.sh"

wait_url() {
  local url="$1" attempt code
  for attempt in $(seq 1 40); do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" || true)
    if [ "$code" = "200" ]; then
      echo "ok ${url}"
      return 0
    fi
    echo "wait ${url} -> ${code:-none} (${attempt}/40)"
    sleep 5
  done
  echo "ERROR: ${url} did not return 200" >&2
  return 1
}

wait_url "http://127.0.0.1/nginx-health"
wait_url "http://127.0.0.1/actuator/health"
wait_url "http://127.0.0.1:18081/actuator/health"
wait_url "http://127.0.0.1:18082/actuator/health"
wait_url "http://127.0.0.1:18083/actuator/health"
wait_url "http://127.0.0.1:9411/health"

if [ -n "$(compose ps --all --status exited -q)" ]; then
  echo "ERROR: a container exited" >&2
  compose ps --all
  exit 1
fi

E2E_BASE_URL=http://127.0.0.1 E2E_ZIPKIN_URL=http://127.0.0.1:9411 python3 "$APP_DIR/e2e/test_stack.py"
echo "stack is healthy"
