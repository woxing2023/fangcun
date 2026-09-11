#!/usr/bin/env bash
# Run from the verified, extracted release. Existing installations only.
set -euo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo '使用 sudo bash deploy/upgrade-xuan.sh' >&2; exit 1; }
FANGCUN_SOURCE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$FANGCUN_SOURCE"
test -f /opt/fangcun/server.js
test -f /etc/systemd/system/fangcun.service
test -f /etc/fangcun.env
test -d /var/lib/fangcun
# systemd deliberately uses the system Node binary, not a user's nvm shell.
/usr/bin/node -e 'require("node:sqlite"); if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
# Refuse environment overrides that could violate the deployment contract.
if grep -Eq '^[[:space:]]*(HOST|PORT|DATA_DIR)=' /etc/fangcun.env; then
  echo '/etc/fangcun.env 存在 HOST/PORT/DATA_DIR 覆盖，请先核对并移除这些重复项；地址由 service 固定。' >&2
  exit 1
fi
for file in xuan.css xuan-fibers.svg xuan-fibers-mobile.png xuan-sans.woff2 xuan-serif.woff2 material-light.js touch-material.js liquid-renderer.js mobile-ui.css mobile-material.css mobile-calendar.css calendar-surface.css appearance-controls.js appearance.js liquid-select.js app.js server.js; do test -s "$file"; done
FANGCUN_BACKUP=$(mktemp -d /var/backups/fangcun-xuan-XXXXXXXX)
chmod 700 "$FANGCUN_BACKUP"
FANGCUN_BACKED_UP=0
FANGCUN_INSTALLING=0
recover() {
  local status=$?
  trap - EXIT
  if (( status != 0 && FANGCUN_INSTALLING == 1 && FANGCUN_BACKED_UP == 1 )); then
    echo "升级失败，恢复旧程序；完整备份：$FANGCUN_BACKUP" >&2
    systemctl stop fangcun.service || true
    tar -xzf "$FANGCUN_BACKUP/before.tar.gz" -C / opt/fangcun etc/systemd/system/fangcun.service
    systemctl daemon-reload
  fi
  systemctl start fangcun.service || true
  exit "$status"
}
trap recover EXIT
systemctl stop fangcun.service
# Include WAL/SHM and integration data while stopped, plus code/config/unit.
tar -czf "$FANGCUN_BACKUP/before.tar.gz" -C / opt/fangcun var/lib/fangcun etc/fangcun.env etc/systemd/system/fangcun.service
tar -tzf "$FANGCUN_BACKUP/before.tar.gz" > "$FANGCUN_BACKUP/contents.txt"
FANGCUN_BACKED_UP=1
FANGCUN_INSTALLING=1
bash deploy/install.sh
bash deploy/verify.sh
for asset in index.html privacy.html styles.css appearance.css liquid.css xuan.css xuan-fibers.svg xuan-fibers-mobile.png xuan-sans.woff2 xuan-serif.woff2 material-light.js touch-material.js liquid-renderer.js mobile-ui.css mobile-material.css mobile-calendar.css calendar-surface.css appearance-controls.js appearance.js liquid-select.js app.js service-worker.js; do
  curl --fail --silent --show-error "http://127.0.0.1:18443/$asset" > "$FANGCUN_BACKUP/served-$asset"
  if [[ "$asset" == index.html || "$asset" == privacy.html ]]; then
    # server.js substitutes {{OPERATOR_NAME}}/{{CONTACT}}/{{APP_BEIAN}}/{{ICP_BEIAN}}
    # from environment before serving these templates; byte cmp would fail by design.
    /usr/bin/node deploy/check-template-asset.js "$asset" "$FANGCUN_BACKUP/served-$asset" /etc/fangcun.env /etc/systemd/system/fangcun.service
  else
    cmp "$asset" "$FANGCUN_BACKUP/served-$asset"
  fi
done
trap - EXIT
printf '\nFANGCUN-XUAN-OK 20260911-calendar-v3\n备份目录：%s\n' "$FANGCUN_BACKUP"
