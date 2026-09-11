#!/usr/bin/env bash
set -euo pipefail

HEALTH_URL=${FANGCUN_HEALTH_URL:-http://127.0.0.1:18443/api/health}

echo "[1/4] systemd 服务状态"
systemctl is-enabled fangcun.service
systemctl is-active fangcun.service

echo "[2/4] 本机健康接口"
HEALTH_RESPONSE=$(curl --fail --silent --show-error "$HEALTH_URL")
printf '%s\n' "$HEALTH_RESPONSE"
printf '%s' "$HEALTH_RESPONSE" | grep -q '"ok":true'

echo "[3/4] 监听地址"
ss -lnt | grep -q '127\.0\.0\.1:18443'
ss -lnt | grep '127\.0\.0\.1:18443'
if ! ss -H -lnt | awk '$4 ~ /:18443$/ && $4 != "127.0.0.1:18443" { bad=1 } END { exit bad }'; then
  echo "18443 存在非本机监听地址，请核对服务配置。" >&2
  exit 1
fi

echo "[4/4] 最近服务日志"
journalctl -u fangcun.service -n 20 --no-pager

if grep -q '^FANGCUN_STORE_RELEASE=true$' /etc/fangcun.env 2>/dev/null; then
  echo "[store] 隐私政策与备案公开信息"
  for variable in FANGCUN_OPERATOR_NAME FANGCUN_CONTACT FANGCUN_APP_BEIAN FANGCUN_ICP_BEIAN; do
    grep -Eq "^${variable}=.+" /etc/fangcun.env || { echo "缺少商店发布配置：${variable}" >&2; exit 1; }
  done
  PRIVACY_RESPONSE=$(curl --fail --silent --show-error http://127.0.0.1:18443/privacy.html)
  printf '%s' "$PRIVACY_RESPONSE" | grep -q '方寸隐私政策'
  if printf '%s' "$PRIVACY_RESPONSE" | grep -q '发布前待配置'; then
    echo "隐私政策仍含发布占位内容。" >&2
    exit 1
  fi
fi

echo "验收通过：方寸仅监听服务器本机 127.0.0.1:18443。"
