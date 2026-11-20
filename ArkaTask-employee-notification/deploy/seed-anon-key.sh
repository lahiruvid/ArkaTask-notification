#!/bin/bash
# Copy seed/supabase-keys.json into the shared runtime volume when it exists.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f seed/supabase-keys.json ]; then
  echo "No seed/supabase-keys.json. The app can save the anon key later. service_role is never deployed."
  exit 0
fi

if docker info >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(sudo docker compose)
fi
compose() {
  "${DC[@]}" -f docker-compose.yml -f docker-compose.registry.yml "$@"
}

running=""
for _ in $(seq 1 60); do
  running=$(compose ps --status running -q login-service || true)
  if [ -n "$running" ]; then
    break
  fi
  sleep 2
done
if [ -z "$running" ]; then
  echo "login-service container is not running; cannot seed the anon key" >&2
  exit 1
fi

compose exec -T login-service mkdir -p /var/lib/arkatasks
compose cp seed/supabase-keys.json login-service:/var/lib/arkatasks/supabase-keys.json
compose exec -T login-service chmod 600 /var/lib/arkatasks/supabase-keys.json
compose restart login-service clean-event-service
echo "Seeded the Supabase anon key into the shared runtime volume"
