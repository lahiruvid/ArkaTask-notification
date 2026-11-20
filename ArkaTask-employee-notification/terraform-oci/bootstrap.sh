#!/bin/bash
# First boot of the Always Free A1 instance. Idempotent.
# Cloud-init runs this as root from instance metadata user_data.
# The Jenkins admin password does not exist yet. This script installs Jenkins
# and leaves it stopped. The deploy writes the password, then runs
# deploy/arkatasks-configure-jenkins.sh from the synced repo.
set -euo pipefail
umask 022

LOG=/var/log/arkatasks-bootstrap.log
touch "$LOG"
chmod 644 "$LOG"
exec >>"$LOG" 2>&1

echo "=== arkatasks bootstrap $(date -Is) ==="
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

wait_for_network() {
  local attempt
  for attempt in $(seq 1 60); do
    if timeout 5 bash -c 'cat < /dev/null > /dev/tcp/archive.ubuntu.com/443' 2>/dev/null; then
      echo "outbound network is up"
      return 0
    fi
    echo "waiting for outbound network (${attempt}/60)"
    sleep 5
  done
  echo "ERROR: no outbound HTTPS after 5 minutes" >&2
  return 1
}

retry() {
  local attempt=1
  local max=5
  until "$@"; do
    if [ "$attempt" -ge "$max" ]; then
      echo "ERROR: command failed after ${max} attempts: $*" >&2
      return 1
    fi
    echo "retry ${attempt}: $*"
    attempt=$((attempt + 1))
    sleep 15
  done
}

open_web_ports() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    return 0
  fi
  if "$bin" -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null; then
    echo "$bin already accepts 80/443"
    return 0
  fi
  local line
  line=$("$bin" -L INPUT --line-numbers -n | awk 'toupper($2) ~ /^(REJECT|DROP)$/ { print $1; exit }')
  if [ -n "${line:-}" ]; then
    "$bin" -I INPUT "$line" -p tcp -m multiport --dports 80,443 -j ACCEPT
  else
    "$bin" -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
  fi
  echo "$bin accepts 80/443"
}

write_jenkins_unit() {
  local java_bin java_home
  java_bin=$(dpkg -L openjdk-21-jre-headless | awk '/\/bin\/java$/ { print; exit }')
  java_home=$(dirname "$(dirname "$(readlink -f "$java_bin")")")
  install -d -m 755 /etc/systemd/system/jenkins.service.d
  cat > /etc/systemd/system/jenkins.service.d/arkatasks.conf <<EOF
[Service]
Environment="JAVA_HOME=${java_home}"
Environment="JENKINS_JAVA_CMD=${java_bin}"
Environment="JENKINS_LISTEN_ADDRESS=127.0.0.1"
Environment="JENKINS_PORT=8080"
Environment="JAVA_OPTS=-Djava.awt.headless=true -Djenkins.install.runSetupWizard=false -Djenkins.model.Jenkins.slaveAgentPort=-1 -Xmx768m -Xms256m"
Environment="CASC_JENKINS_CONFIG=/var/lib/jenkins/casc/jenkins.yaml"
TimeoutStartSec=300
EOF
  systemctl daemon-reload
}

wait_for_network

echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | debconf-set-selections
echo "iptables-persistent iptables-persistent/autosave_v6 boolean true" | debconf-set-selections

retry apt-get update
retry apt-get install -y \
  ca-certificates curl gnupg git openssl fontconfig python3 \
  openjdk-21-jre-headless openjdk-17-jdk maven \
  iptables iptables-persistent

# Current Jenkins LTS requires Java 21. Java 17 stays installed for host Maven.
# Write the unit drop-in before the Jenkins package starts, so the first
# start is already on 127.0.0.1 with the setup wizard disabled.
write_jenkins_unit

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
# shellcheck disable=SC1091
. /etc/os-release
arch=$(dpkg --print-architecture)
echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
retry apt-get update
retry apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker buildx version
docker compose version

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key -o /etc/apt/keyrings/jenkins-keyring.asc
echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" \
  > /etc/apt/sources.list.d/jenkins.list
retry apt-get update
retry apt-get install -y jenkins
systemctl stop jenkins || true
systemctl disable jenkins || true
write_jenkins_unit

install -d -o jenkins -g jenkins /var/lib/jenkins/plugins /var/lib/jenkins/casc
PM_JAR=/usr/local/lib/jenkins-plugin-manager.jar
if [ ! -s "$PM_JAR" ]; then
  curl -fsSL -o "$PM_JAR" \
    https://github.com/jenkinsci/plugin-installation-manager-tool/releases/download/2.13.0/jenkins-plugin-manager-2.13.0.jar
fi
java -jar "$PM_JAR" \
  --war /usr/share/java/jenkins.war \
  --plugin-download-directory /var/lib/jenkins/plugins \
  --plugins workflow-aggregator git configuration-as-code job-dsl
chown -R jenkins:jenkins /var/lib/jenkins

# Locked stub until the workflow supplies JENKINS_ADMIN_PASSWORD.
stub_pass=$(openssl rand -hex 24)
python3 - "$stub_pass" <<'PY'
import json, pathlib, sys
password = json.dumps(sys.argv[1])
text = f"""jenkins:
  systemMessage: "ArkaTasks bootstrap is waiting for the deploy to set the admin password."
  numExecutors: 1
  mode: NORMAL
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: "admin"
          password: {password}
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
"""
path = pathlib.Path("/var/lib/jenkins/casc/jenkins.yaml")
path.write_text(text)
path.chmod(0o600)
PY
chown jenkins:jenkins /var/lib/jenkins/casc/jenkins.yaml
unset stub_pass

if id ubuntu >/dev/null 2>&1; then
  usermod -aG docker ubuntu
fi
usermod -aG docker jenkins
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-arkatasks-ubuntu
chmod 440 /etc/sudoers.d/90-arkatasks-ubuntu
visudo -cf /etc/sudoers.d/90-arkatasks-ubuntu

open_web_ports iptables
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save
else
  install -d -m 755 /etc/iptables
  iptables-save > /etc/iptables/rules.v4
fi

if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile
fi
swapon /swapfile || true
grep -q '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab

install -d -m 755 -o ubuntu -g ubuntu /opt/arkatasks
install -d -m 755 /etc/arkatasks

sync
echo "ok $(date -Is)" > /var/lib/arkatasks-bootstrap.done
chmod 644 /var/lib/arkatasks-bootstrap.done
echo "=== bootstrap done $(date -Is) ==="
