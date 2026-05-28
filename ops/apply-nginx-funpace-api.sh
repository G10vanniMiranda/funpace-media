#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute como root: sudo bash ops/apply-nginx-funpace-api.sh" >&2
  exit 1
fi

available_conf="/etc/nginx/sites-available/funpace-api.conf"
enabled_conf="/etc/nginx/sites-enabled/funpace-api.conf"
backup_dir="/etc/nginx/funpace-backups"
timestamp="$(date +%Y%m%d-%H%M%S)"

mkdir -p "${backup_dir}"

if [[ -f "${available_conf}" ]]; then
  cp "${available_conf}" "${backup_dir}/funpace-api.conf.${timestamp}.bak"
fi

cat > "${available_conf}" <<'NGINX'
server {
  listen 80;
  server_name api.funpace.media;

  client_max_body_size 300m;
  client_body_timeout 20m;
  send_timeout 20m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";

    proxy_read_timeout 20m;
    proxy_send_timeout 20m;
    proxy_connect_timeout 60s;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_max_temp_file_size 0;
  }
}
NGINX

ln -sfn "${available_conf}" "${enabled_conf}"

nginx -t
systemctl reload nginx

if systemctl list-units --type=service --all | grep -q '^  funpace'; then
  systemctl restart funpace
elif command -v pm2 >/dev/null 2>&1; then
  pm2 restart all --update-env
fi

echo "Nginx atualizado para uploads de ate 300 MB em api.funpace.media."
