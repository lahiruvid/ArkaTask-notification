#!/bin/bash
set -euo pipefail
yum makecache -y
yum install -y ca-certificates curl gnupg2 java-17-amazon-corretto-headless
amazon-linux-extras install -y nginx1
amazon-linux-extras install -y docker
systemctl enable --now docker
systemctl enable --now nginx
curl -fsSL -o /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/rpm-stable/jenkins.repo
rpm --import https://pkg.jenkins.io/rpm-stable/jenkins.io-2026.key
yum makecache -y
yum install -y jenkins
usermod -aG docker jenkins
systemctl enable --now jenkins
