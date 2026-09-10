#!/usr/bin/env bash
# 方寸 2.7.0 第二批升级脚本（服务器端执行）
# 用法: bash fangcun-upgrade-2.7.0.sh <release-base-url>
# 例:   bash fangcun-upgrade-2.7.0.sh https://github.com/woxing2023/fangcun/releases/download/server-deploy-2.7.0b
set -euo pipefail

BASE="${1:?usage: bash fangcun-upgrade-2.7.0.sh <release-asset-base-url>}"
cd /tmp

echo "== [1/6] 下载中转资产 =="
curl -sL -m 300 -O "$BASE/fangcun-release-2.7.0.tar.gz"
curl -sL -m 60  -O "$BASE/fangcun-SHA256SUMS-20260908.txt"
ls -l fangcun-release-2.7.0.tar.gz fangcun-SHA256SUMS-20260908.txt

echo "== [2/6] SHA256 校验（哈希不一致即停） =="
sha256sum --check --ignore-missing fangcun-SHA256SUMS-20260908.txt

echo "== [3/6] 随机目录解压 =="
FANGCUN_STAGE=$(mktemp -d /tmp/fangcun-upgrade.XXXXXX)
tar -xzf /tmp/fangcun-release-2.7.0.tar.gz -C "$FANGCUN_STAGE"
cd "$FANGCUN_STAGE"
ls deploy/ >/dev/null   # 确认包结构

echo "== [4/6] 备份现有数据 =="
if sudo test -f /var/lib/fangcun/fangcun.sqlite; then
  sudo bash deploy/backup.sh
else
  echo "(无旧数据库，跳过备份)"
fi

echo "== [5/6] 安装 =="
sudo bash deploy/install.sh

echo "== [6/6] 验收 =="
sudo bash deploy/verify.sh
curl --fail --silent --show-error http://127.0.0.1:18443/app.js | grep 'const APP_BUILD ='

echo "FANGCUN-UPGRADE-OK 20260908-calendar-controls"
