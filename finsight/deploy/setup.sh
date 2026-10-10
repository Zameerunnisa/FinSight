#!/usr/bin/env bash
# Run ON the VM (Debian 12) from the finsight folder:  sudo bash deploy/setup.sh
# Safe to re-run: use it again to deploy updated code.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing Nginx and Node.js 20"
apt-get update
apt-get install -y nginx curl ca-certificates
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Creating app user and folders"
id finsight >/dev/null 2>&1 || useradd --system --home /opt/finsight --shell /usr/sbin/nologin finsight
mkdir -p /opt/finsight /var/www/finsight /var/log/finsight

echo "==> Copying backend and installing dependencies"
rm -rf /opt/finsight/backend
cp -r backend /opt/finsight/backend
(cd /opt/finsight/backend && npm install --omit=dev)
chown -R finsight:finsight /opt/finsight /var/log/finsight

echo "==> Copying frontend"
rm -rf /var/www/finsight/*
cp -r frontend/* /var/www/finsight/

echo "==> Starting backend service"
cp deploy/finsight.service /etc/systemd/system/finsight.service
systemctl daemon-reload
systemctl enable finsight
systemctl restart finsight

echo "==> Configuring Nginx"
rm -f /etc/nginx/sites-enabled/default
cp deploy/nginx.conf /etc/nginx/sites-available/finsight
ln -sf /etc/nginx/sites-available/finsight /etc/nginx/sites-enabled/finsight
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

echo "==> Installing Ops Agent (Cloud Logging + Monitoring)"
if ! systemctl list-unit-files | grep -q google-cloud-ops-agent; then
  curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  bash add-google-cloud-ops-agent-repo.sh --also-install
  rm -f add-google-cloud-ops-agent-repo.sh
fi
cp deploy/ops-agent.yaml /etc/google-cloud-ops-agent/config.yaml
systemctl restart google-cloud-ops-agent

echo
echo "Done. Health check:"
sleep 2
curl -s http://127.0.0.1/api/health || echo "(backend not responding yet - check: sudo journalctl -u finsight -n 50)"
echo
