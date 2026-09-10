#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "请使用 sudo bash deploy/install.sh 运行。" >&2
  exit 1
fi

SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP_DIR=/opt/fangcun
DATA_DIR=/var/lib/fangcun
ENV_FILE=/etc/fangcun.env

command -v node >/dev/null 2>&1 || { echo "需要先安装 Node.js 22.5 或更高版本。" >&2; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<5))process.exit(1)' \
  || { echo "当前 Node.js 版本过低，需要 22.5 或更高版本。" >&2; exit 1; }

if ! id fangcun >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin fangcun
fi

install -d -m 0755 "$APP_DIR"
install -d -m 0755 "$APP_DIR/deploy"
install -d -o fangcun -g fangcun -m 0750 "$DATA_DIR"
for file in index.html privacy.html styles.css v22-layout.css smart-parser.js docx-schedule-parser.js app.js manifest.webmanifest icon.svg service-worker.js appearance.css liquid.css liquid-select.js appearance.js liquid-renderer.js three.module.min.js three.core.min.js THREE-LICENSE.txt reset-password.js server.js outlook-sync.js google-sync.js package.json; do
  install -m 0644 "$SOURCE_DIR/$file" "$APP_DIR/$file"
done
install -m 0755 "$SOURCE_DIR/deploy/verify.sh" "$APP_DIR/deploy/verify.sh"
install -m 0755 "$SOURCE_DIR/deploy/reset-password.sh" "$APP_DIR/deploy/reset-password.sh"
install -m 0644 "$SOURCE_DIR/deploy/fangcun.service" /etc/systemd/system/fangcun.service

GENERATED_PASSWORD=""
if [[ ! -f "$ENV_FILE" ]]; then
  GENERATED_PASSWORD=$(openssl rand -base64 24)
  umask 027
  printf 'FANGCUN_PASSWORD=%s\n' "$GENERATED_PASSWORD" > "$ENV_FILE"
  chown root:fangcun "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  echo "首次登录密码（请现在保存）：$GENERATED_PASSWORD"
fi

if ! grep -q '^FANGCUN_INTEGRATION_KEY=' "$ENV_FILE"; then
  printf 'FANGCUN_INTEGRATION_KEY=%s\n' "$(openssl rand -base64 48 | tr -d '\n')" >> "$ENV_FILE"
  chown root:fangcun "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
fi

systemctl daemon-reload
systemctl enable fangcun.service
systemctl restart fangcun.service
sleep 1
HEALTH_RESPONSE=$(curl --fail --silent http://127.0.0.1:18443/api/health)

if [[ -n "$GENERATED_PASSWORD" ]]; then
  sed -i '/^FANGCUN_PASSWORD=/d' "$ENV_FILE"
  systemctl restart fangcun.service
fi

echo "方寸已运行在服务器本机 127.0.0.1:18443。"
echo "当前版本：$HEALTH_RESPONSE"
echo "本机检查：curl http://127.0.0.1:18443/api/health"
echo "查看日志：journalctl -u fangcun -f"
