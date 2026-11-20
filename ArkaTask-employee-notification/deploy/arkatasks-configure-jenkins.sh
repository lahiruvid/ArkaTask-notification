#!/bin/bash
# Configure Jenkins from git and seed the arkatasks-deploy job. Run as root after the repo is
# in /opt/arkatasks and vm-jenkins-deploy.sh wrote the secret files.
# Jenkins listens on 127.0.0.1:8080 only; reach it with an SSH tunnel.
set -euo pipefail

APP_DIR=/opt/arkatasks/ArkaTask-employee-notification
SECRETS_DIR=/etc/arkatasks/jenkins-secrets
CASC_DIR=/var/lib/jenkins/casc
JOB_DIR=/var/lib/jenkins/jobs/arkatasks-deploy
PLUGIN_DIR=/var/lib/jenkins/plugins
PM_JAR=/usr/local/lib/jenkins-plugin-manager.jar

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/arkatasks-configure-jenkins.sh" >&2
  exit 1
fi
for name in JENKINS_ADMIN_PASSWORD DOCKERHUB_USERNAME DOCKERHUB_TOKEN; do
  if [ ! -s "${SECRETS_DIR}/${name}" ]; then
    echo "Missing ${SECRETS_DIR}/${name}. The workflow writes it from the GitHub secret ${name}." >&2
    exit 1
  fi
done

systemctl stop jenkins || true

java_bin=$(dpkg -L openjdk-21-jre-headless | awk '/\/bin\/java$/ { print; exit }')
java_home=$(dirname "$(dirname "$(readlink -f "$java_bin")")")
install -d -m 755 /etc/systemd/system/jenkins.service.d
cat > /etc/systemd/system/jenkins.service.d/arkatasks.conf <<UNIT
[Service]
Environment="JAVA_HOME=${java_home}"
Environment="JENKINS_JAVA_CMD=${java_bin}"
Environment="JENKINS_LISTEN_ADDRESS=127.0.0.1"
Environment="JENKINS_PORT=8080"
Environment="JAVA_OPTS=-Djava.awt.headless=true -Djenkins.install.runSetupWizard=false -Djenkins.model.Jenkins.slaveAgentPort=-1 -Xms256m -Xmx768m"
Environment="CASC_JENKINS_CONFIG=${CASC_DIR}/jenkins.yaml"
Environment="SECRETS=${SECRETS_DIR}"
TimeoutStartSec=300
UNIT

# Plugins from deploy/jenkins/plugins.txt. Installed versions are left alone; only missing ones
# are downloaded, so a deploy never upgrades Jenkins plugins behind your back.
missing=0
while read -r plugin; do
  [ -z "$plugin" ] && continue
  if [ ! -e "${PLUGIN_DIR}/${plugin}.jpi" ] && [ ! -e "${PLUGIN_DIR}/${plugin}.hpi" ]; then
    missing=1
  fi
done < "${APP_DIR}/deploy/jenkins/plugins.txt"
if [ "$missing" -eq 1 ]; then
  install -d -o jenkins -g jenkins "$PLUGIN_DIR"
  java -jar "$PM_JAR" \
    --war /usr/share/java/jenkins.war \
    --plugin-download-directory "$PLUGIN_DIR" \
    --plugin-file "${APP_DIR}/deploy/jenkins/plugins.txt"
  chown -R jenkins:jenkins "$PLUGIN_DIR"
fi

install -d -m 750 -o jenkins -g jenkins "$CASC_DIR"
install -m 640 -o jenkins -g jenkins "${APP_DIR}/deploy/jenkins/jenkins.yaml" "${CASC_DIR}/jenkins.yaml"

# The job runs the Jenkinsfile from this commit in the Groovy sandbox (no script approval needed).
install -d -m 755 -o jenkins -g jenkins "$JOB_DIR"
python3 - "${APP_DIR}/Jenkinsfile" "${JOB_DIR}/config.xml" <<'PY'
import pathlib, sys
script = pathlib.Path(sys.argv[1]).read_text()
script = script.replace("]]>", "]]]]><![CDATA[>")
xml = f"""<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>Maven tests, linux/arm64 images, Docker Hub push, and compose deploy for ArkaTasks.</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps">
    <script><![CDATA[{script}]]></script>
    <sandbox>true</sandbox>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
"""
path = pathlib.Path(sys.argv[2])
path.write_text(xml)
path.chmod(0o640)
PY
chown -R jenkins:jenkins "$JOB_DIR"
usermod -aG docker jenkins

systemctl daemon-reload
systemctl enable jenkins
if ! systemctl start jenkins; then
  journalctl -u jenkins -n 120 --no-pager || true
  exit 1
fi

ready=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:8080/login; then
    ready=1
    break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  journalctl -u jenkins -n 120 --no-pager || true
  echo "Jenkins did not open 127.0.0.1:8080" >&2
  exit 1
fi

if ss -ltn | awk '$4 ~ /:8080$/ { print $4 }' | grep -E '^(0\.0\.0\.0:8080|\*:8080|\[::\]:8080)$'; then
  echo "Jenkins is listening outside 127.0.0.1" >&2
  exit 1
fi

pid=$(systemctl show -p MainPID --value jenkins)
gid=$(getent group docker | cut -d: -f3)
if [ -z "$pid" ] || [ "$pid" = "0" ]; then
  echo "Jenkins did not stay running" >&2
  exit 1
fi
if ! awk -v gid="$gid" '$1 == "Groups:" { for (i = 2; i <= NF; i++) if ($i == gid) found = 1 } END { exit !found }' "/proc/${pid}/status"; then
  echo "Jenkins pid ${pid} is not in the docker group (${gid}). Image builds cannot use the socket." >&2
  exit 1
fi
echo "Jenkins is up on 127.0.0.1:8080 and can use Docker"
