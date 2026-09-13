# 日历材质与布局版 · Hermes 发布及 Workbench 升级

本次包：`fangcun-release-2.7.0-calendar3.tar.gz`。校验文件：`fangcun-SHA256SUMS-20260911-calendar3.txt`。GitHub Release tag：`fangcun-deploy-20260911-calendar-v3`。部署后构建标识：`20260911-calendar-v3`。

本次委托仅在本地检查、打包和交付文件。GitHub Release 上传、Workbench 下载、校验与升级由 Hermes 执行；本地交付完成不表示已上传或已部署。下文是交接操作说明。

升级沿用现有方寸服务与 Cloudflare Tunnel。程序、数据、配置的标准安装位置分别为 `/opt/fangcun`、`/var/lib/fangcun`、`/etc/fangcun.env`。服务继续只监听 `127.0.0.1:18443`；不修改现有 Tunnel、nginx、hysteria2 或公网端口、安全组规则。

## 1. Hermes 上传本次 Release

Hermes 在已获授权的 GitHub 仓库中使用 tag `fangcun-deploy-20260911-calendar-v3` 创建或更新本次 Release，上传本地交付的压缩包及校验文件，保持文件名不变。上传前在本地 `release/` 目录执行：

```bash
sha256sum --check fangcun-SHA256SUMS-20260911-calendar3.txt
```

记录 Release 页面与本次校验结果。不要用旧版压缩包覆盖新文件名，也不要把内部工作区、账号配置、签名密钥、真实数据或开发截图附加到 Release。

## 2. Hermes 在 Workbench 下载并升级

连接原云服务器轻量应用服务器实例。将 `FANGCUN_REPO` 设为已授权 Release 所在仓库的 `owner/repo`；这里不预填账户或服务器信息。以下命令适用于可直接下载的 Release 附件；仓库需登录时，Hermes 应使用已有授权下载方式将相同两个文件放入暂存目录，随后执行相同的校验与升级步骤，不把访问令牌写入文档或命令历史。

```bash
(
  set -euo pipefail
  : "${FANGCUN_REPO:?请先设置已授权的 GitHub owner/repo}"
  FANGCUN_TAG=fangcun-deploy-20260911-calendar-v3
  FANGCUN_ARCHIVE=fangcun-release-2.7.0-calendar3.tar.gz
  FANGCUN_SUMS=fangcun-SHA256SUMS-20260911-calendar3.txt
  FANGCUN_DOWNLOAD=$(mktemp -d "${TMPDIR:-/tmp}/fangcun-download.XXXXXX")
  FANGCUN_RELEASE_URL="https://github.com/${FANGCUN_REPO}/releases/download/${FANGCUN_TAG}"
  cd "$FANGCUN_DOWNLOAD"
  curl --fail --location --proto '=https' --proto-redir '=https' --output "$FANGCUN_ARCHIVE" "$FANGCUN_RELEASE_URL/$FANGCUN_ARCHIVE"
  curl --fail --location --proto '=https' --proto-redir '=https' --output "$FANGCUN_SUMS" "$FANGCUN_RELEASE_URL/$FANGCUN_SUMS"
  test -s "$FANGCUN_ARCHIVE"
  sha256sum --check "$FANGCUN_SUMS"
  FANGCUN_STAGE=$(mktemp -d "${TMPDIR:-/tmp}/fangcun-upgrade.XXXXXX")
  tar -xzf "$FANGCUN_ARCHIVE" -C "$FANGCUN_STAGE"
  cd "$FANGCUN_STAGE"
  sudo bash deploy/upgrade-xuan.sh
)
```

任一步失败会停止。下载后应与本地交付的 SHA-256 再核对一次；不跳过校验或备份。下载到当前账户家目录时使用 `$HOME`，无需固定账户路径。

升级脚本先检查系统 Node 能加载 `node:sqlite`，再短暂停服，完整备份程序、数据库目录（含 WAL）、配置和 systemd unit。备份目录为终端输出中的 `/var/backups/fangcun-xuan-XXXXXXXX`，权限为 0700；其中包含业务数据，不作为发布附件。

随后安装、重启、检查本机健康接口，并逐字节核对材质、日历布局、触摸脚本、PNG 纸纹、app.js 和 service worker。出现安装或验收错误时自动恢复原程序与 service unit，然后尝试重新启动。配置与业务数据不参与自动回滚。若 Node 检查失败，先让系统 `/usr/bin/node` 满足项目的 Node 22.5+ 要求；个人 shell 中的 nvm 不替代 systemd 使用的系统 Node。

## 3. Hermes 核对构建，设备端复核体验

终端成功时显示：

```text
FANGCUN-XUAN-OK 20260911-calendar-v3
备份目录：/var/backups/fangcun-xuan-XXXXXXXX
```

在 Workbench 核对健康状态和构建：

```bash
curl --fail --silent --show-error http://127.0.0.1:18443/api/health
curl --fail --silent --show-error http://127.0.0.1:18443/app.js | grep 'const APP_BUILD ='
sudo bash /opt/fangcun/deploy/verify.sh
```

打开原方寸入口，出现更新提示后点击更新并重新打开。在现有 APK 的“数据与同步”核对构建标识为 `20260911-calendar-v3`。原有外观偏好会保留。

桌面及手机都检查日历空白网格：底板连续、分隔线清楚，空白时段不再出现逐格厚玻璃。课程保留颜色、亮边和浅投影，真正的操作控件仍有玻璃效果。按住控件并小幅滑动，查看光泽跟随和松手后的收尾；正常滚动后装饰不应残留或挡住内容。

进入日历，使用“全表”“清单”并旋转横竖屏，核对全部日期与时段；长名称可从清单或详情完整阅读。再检查长任务标签、底部导航、浅深色选项，以及切到后台后返回。系统减少动态效果偏好仍应生效。

浏览器布局、着色器和生命周期测试只证明对应测试环境中的行为；这份交接文档不表示 Android 真机帧率、耗电或所有机型体验已经验收。

本机已经更新而原入口仍旧时，先核对缓存与页面更新提示，不改动现有 Tunnel 路由。不要先清空站点数据，里面可能有尚未同步的任务。本次是网页资源更新，没有新增 Android 壳或 Flutter/Rust 客户端。若没有出现更新提示，先完全退出再打开 APK，再核对构建标识；不要以清除数据或卸载重装代替页面更新。

## 4. Hermes 在需要时回滚界面

将下面备份路径替换为本次终端输出的准确路径。只恢复旧程序与 unit，保留升级后新增的业务数据和现有配置。

```bash
(
  set -euo pipefail
  FANGCUN_BACKUP=/var/backups/fangcun-xuan-XXXXXXXX
  sudo test -s "$FANGCUN_BACKUP/before.tar.gz"
  sudo tar -tzf "$FANGCUN_BACKUP/before.tar.gz" >/dev/null
  sudo systemctl stop fangcun
  trap 'sudo systemctl start fangcun' EXIT
  sudo tar -xzf "$FANGCUN_BACKUP/before.tar.gz" -C / opt/fangcun etc/systemd/system/fangcun.service
  sudo systemctl daemon-reload
  sudo systemctl start fangcun
  sudo bash /opt/fangcun/deploy/verify.sh
)
```

本次流程要求已有安装；空实例安装、改换域名或新建 Tunnel 不在这次升级范围内。

## 5. 本地重新打包

Linux：`bash deploy/build-release.sh`，包含 `npm run check`，输出 `fangcun-release-2.7.0-calendar3.tar.gz` 和 `fangcun-SHA256SUMS-20260911-calendar3.txt`。PowerShell：`powershell -ExecutionPolicy Bypass -File .\deploy\build-release.ps1 -Version 2.7.0-calendar3`，随后为压缩包生成对应 SHA-256 文件。Linux 与 PowerShell 共用根文件白名单。Linux 打包需要 Python 3，会把归档属主与组固定为数字 0，并对最终压缩包逐成员执行 `deploy/scan-release-privacy.py`；发现敏感成员或元数据即停止，不生成可交付的校验结果。审计报告为 `fangcun-privacy-20260911-calendar3.json`。自动检查配合人工核对姓名与课程数据，不将模式匹配等同于完整实名识别。

本地交付应附上压缩包、校验文件及检查结果；远端上传地址、校验与升级结果由 Hermes 执行后补充。
