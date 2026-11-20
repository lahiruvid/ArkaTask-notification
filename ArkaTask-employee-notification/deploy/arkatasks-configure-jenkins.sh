#!/bin/bash
# Apply JCasC and seed the arkatasks-deploy job. Run as root after the repo
# is at /opt/arkatasks and /etc/arkatasks/jenkins-admin.password exists.
set -euo pipefail

PASS_FILE=/etc/arkatasks/jenkins-admin.password
JENKINSFILE=/opt/arkatasks/ArkaTask-employee-notification/Jenkinsfile
CASC=/var/lib/jenkins/casc/jenkins.yaml
JOB_DIR=/var/lib/jenkins/jobs/arkatasks-deploy

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash deploy/arkatasks-configure-jenkins.sh" >&2
  exit 1
fi
if [ ! -s "$PASS_FILE" ]; then
  echo "Missing ${PASS_FILE}. The workflow writes it from JENKINS_ADMIN_PASSWORD." >&2
  exit 1
fi
if [ ! -f "$JENKINSFILE" ]; then
  echo "Missing ${JENKINSFILE}. Sync the repo to /opt/arkatasks first." >&2
  exit 1
fi

java_bin=$(dpkg -L openjdk-21-jre-headless | awk '/\/bin\/java$/ { print; exit }')
java_home=$(dirname "$(dirname "$(readlink -f "$java_bin")")")
systemctl stop jenkins || true
install -d -m 755 /etc/systemd/system/jenkins.service.d
cat > /etc/systemd/system/jenkins.service.d/arkatasks.conf <<EOF
[Service]
Environment="JAVA_HOME=${java_home}"
Environment="JENKINS_JAVA_CMD=${java_bin}"
Environment="JENKINS_LISTEN_ADDRESS=127.0.0.1"
Environment="JENKINS_PORT=8080"
Environment="JAVA_OPTS=-Djava.awt.headless=true -Djenkins.install.runSetupWizard=false -Djenkins.model.Jenkins.slaveAgentPort=-1 -Xmx768m -Xms256m"
Environment="CASC_JENKINS_CONFIG=${CASC}"
TimeoutStartSec=300
EOF

install -d -m 755 -o jenkins -g jenkins /var/lib/jenkins/casc
python3 - "$PASS_FILE" "$CASC" <<'PY'
import json, pathlib, sys
password = pathlib.Path(sys.argv[1]).read_text().strip()
if not password or "\n" in password or "\r" in password:
    raise SystemExit("Jenkins admin password must be a single line")
quoted = json.dumps(password)
text = f"""jenkins:
  systemMessage: "ArkaTasks on OCI"
  numExecutors: 1
  mode: NORMAL
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: "admin"
          password: {quoted}
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
"""
path = pathlib.Path(sys.argv[2])
path.write_text(text)
path.chmod(0o600)
PY
chown jenkins:jenkins "$CASC"

install -d -m 755 -o jenkins -g jenkins "$JOB_DIR"
python3 - "$JENKINSFILE" "$JOB_DIR/config.xml" <<'PY'
import pathlib, sys
script = pathlib.Path(sys.argv[1]).read_text()
script = script.replace("]]>", "]]]]><![CDATA[>")
xml = f"""<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>Build ARM images and start the ArkaTasks compose stack.</description>
  <keepDependencies>false</keepDependencies>
  <properties/>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps">
    <script><![CDATA[{script}]]></script>
    <sandbox>false</sandbox>
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
