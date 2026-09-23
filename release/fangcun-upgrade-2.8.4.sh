#!/usr/bin/env bash
# 方寸 2.8.4 升级脚本（服务器端执行）
# 用法: bash fangcun-upgrade-2.8.4.sh <release-base-url>
# 例:   bash fangcun-upgrade-2.8.4.sh https://github.com/woxing2023/fangcun/releases/download/fangcun-deploy-2.8.4
set -euo pipefail
BASE="${1:?用法: bash fangcun-upgrade-2.8.4.sh <release-base-url>}"
cd /tmp
echo "== [1/6] 下载中转资产 =="
curl -sL -m 300 -o fangcun-release-2.8.4.tar.gz "$BASE/fangcun-release-2.8.4.tar.gz"
curl -sL -m 60 -o fangcun-SHA256SUMS-2.8.4.txt "$BASE/fangcun-SHA256SUMS-2.8.4.txt"
ls -l fangcun-release-2.8.4.tar.gz fangcun-SHA256SUMS-2.8.4.txt
echo "== [2/6] SHA256 校验（哈希不一致即停） =="
sha256sum --check fangcun-SHA256SUMS-2.8.4.txt
echo "== [3/6] 备份现役数据 =="
sudo mkdir -p /var/backups/fangcun
sudo cp /var/lib/fangcun/fangcun.sqlite "/var/backups/fangcun/fangcun-$(date +%Y%m%d-%H%M%S).sqlite"
echo "== [4/6] 解压并安装 =="
rm -rf /tmp/fangcun-upgrade-284
mkdir -p /tmp/fangcun-upgrade-284
tar -xzf fangcun-release-2.8.4.tar.gz -C /tmp/fangcun-upgrade-284
sudo cp /tmp/fangcun-upgrade-284/server.js /tmp/fangcun-upgrade-284/app.js /tmp/fangcun-upgrade-284/index.html /tmp/fangcun-upgrade-284/service-worker.js /tmp/fangcun-upgrade-284/styles.css /opt/fangcun/
echo "== [5/6] 重启服务 =="
sudo systemctl restart fangcun.service
sleep 3
systemctl is-active fangcun.service
echo "== [6/6] 验收 =="
curl -s -m 10 http://127.0.0.1:18443/api/health
echo ""
sudo ss -tlnp | grep fangcun || sudo ss -tlnp | grep 18443
grep -o 'const APP_BUILD = "[^"]*"' /opt/fangcun/app.js
echo "FANGCUN-UPGRADE-OK 20260923-schedule-exception-noise-fix"
