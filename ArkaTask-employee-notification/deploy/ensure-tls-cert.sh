#!/bin/bash
# Creates a self-signed certificate for Nginx when the directory has none. Run as root.
# Replace tls.crt and tls.key with a real certificate for your domain; this script keeps them.
set -euo pipefail

dir="${1:-/etc/arkatasks/certs}"
install -d -m 755 "$dir"
if [ -s "$dir/tls.crt" ] && [ -s "$dir/tls.key" ]; then
  exit 0
fi
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "$dir/tls.key" -out "$dir/tls.crt" \
  -subj "/CN=arkatasks" >/dev/null 2>&1
chmod 600 "$dir/tls.key"
chmod 644 "$dir/tls.crt"
echo "Created a self-signed certificate in ${dir}"
