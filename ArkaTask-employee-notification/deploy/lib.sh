# Shared settings for the deploy scripts. Source it, do not run it:
#   . "$(dirname "$0")/lib.sh"
# shellcheck shell=bash

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="arkatasks-employee-notification"
# <tag>:<build context> for the four Java services. Kafka, RabbitMQ, Zipkin, and Nginx are stock images.
# shellcheck disable=SC2034 # read by the scripts that source this file
IMAGES=(
  "eureka:employee-service/eureka-server"
  "login-service:employee-service/login-service"
  "clean-event-service:employee-service/clean-event-service"
  "owner-notifier:owner-notifier"
)

# Value of KEY in $APP_DIR/.env, or empty.
env_value() {
  (cd "$APP_DIR" && python3 deploy/envfile.py --get "$1")
}

if [ -z "${DOCKERHUB_USERNAME:-}" ]; then
  DOCKERHUB_USERNAME="$(env_value DOCKERHUB_USERNAME)"
fi
export DOCKERHUB_USERNAME

# Where Nginx reads tls.crt and tls.key. The VM sets TLS_CERT_DIR=/etc/arkatasks/certs in .env.
tls_cert_dir() {
  local dir
  dir="$(env_value TLS_CERT_DIR)"
  echo "${dir:-$APP_DIR/certs}"
}

image_repo() {
  echo "docker.io/${DOCKERHUB_USERNAME:?DOCKERHUB_USERNAME is not set. Put it in .env or the environment.}/${IMAGE_NAME}"
}

# Short commit of this checkout. Jenkins exports GIT_SHA because its workspace has no .git.
commit_sha() {
  if [ -n "${GIT_SHA:-}" ]; then
    echo "$GIT_SHA"
  else
    git -c safe.directory="$(cd "$APP_DIR/.." && pwd)" -C "$APP_DIR" rev-parse --short=12 HEAD 2>/dev/null || echo manual
  fi
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo -n docker "$@"
  fi
}

compose() {
  (cd "$APP_DIR" && docker_cmd compose -f docker-compose.yml -f docker-compose.registry.yml "$@")
}
