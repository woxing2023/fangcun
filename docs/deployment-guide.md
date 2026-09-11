# 方寸 2.7.0 发布、服务器升级、密码恢复与 APK 安装

本次服务器包为 `fangcun-release-2.7.0-calendar3.tar.gz`，对应构建 `20260911-calendar-v3`。本地只检查、打包和交付；Hermes 负责 GitHub Release 上传及 Workbench 下载、校验、升级。完整操作见 [Workbench 交接说明](workbench-xuan.md)。

服务继续只监听 `127.0.0.1:18443`，沿用现有 Cloudflare Tunnel；不修改 nginx、hysteria2、Tunnel 配置或公网端口。

## 1. 本地完整检查

在项目源码根目录执行：

```bash
npm run check
```

## 2. 生成服务器源码包

Linux：

```bash
bash deploy/build-release.sh
```

PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\build-release.ps1 -Version 2.7.0-calendar3
```

交付 `release/fangcun-release-2.7.0-calendar3.tar.gz` 和 `release/fangcun-SHA256SUMS-20260911-calendar3.txt`。PowerShell 打包后需为压缩包生成相应校验文件。校验文件不能混用旧版本。

## 3. Hermes 发布和升级

使用 tag `fangcun-deploy-20260911-calendar-v3`，按 [Workbench 交接说明](workbench-xuan.md) 上传这两个文件、在原实例下载、校验、备份并升级。文档中的命令交由 Hermes 执行，本地打包不代表远端动作已完成。

## 4. 核对新构建

网页或已有 APK 获取新页面后，在“数据与同步”核对构建 `20260911-calendar-v3`。本轮仅更新网页资源，没有新增 APK。未出现更新提示时，先完全退出再打开并核对构建，不先卸载或清除站点数据。

以下是通用配置与已有 APK 维护说明，不是本次必须执行的额外操作。

### 应用商店生产信息

准备商店候选版时，在服务器 `/etc/fangcun.env` 中加入与开发者主体、隐私政策和备案材料完全一致的公开信息：

```dotenv
FANGCUN_OPERATOR_NAME=公开运营者名称
FANGCUN_CONTACT=公开联系方式
FANGCUN_APP_BEIAN=APP备案号
FANGCUN_ICP_BEIAN=ICP备案号
FANGCUN_STORE_RELEASE=true
```

然后重启并执行商店模式验收：

```bash
sudo systemctl restart fangcun
sudo bash /opt/fangcun/deploy/verify.sh
curl --fail https://你的方寸域名/privacy.html
```

在真实信息和备案取得前不要把 `FANGCUN_STORE_RELEASE` 设为 `true`，也不要提交商店审核。

## 5. 配置 Outlook 双向同步

在服务器 `/etc/fangcun.env` 中配置 Microsoft Entra 应用信息：

```bash
sudoedit /etc/fangcun.env
```

```dotenv
MICROSOFT_CLIENT_ID=你的应用客户端ID
MICROSOFT_CLIENT_SECRET=你的客户端密钥值
MICROSOFT_TENANT=common
MICROSOFT_REDIRECT_URI=https://你的方寸域名/api/integrations/outlook/callback
```

保存后执行：

```bash
sudo systemctl restart fangcun
sudo bash /opt/fangcun/deploy/verify.sh
```

完整的 Entra 回调地址、权限与 REDMI 日历设置见 `docs/calendar-sync-guide.md`。

## 5.5 忘记普通账号或 owner 密码时

服务器不会保存明文密码，因此旧密码无法查看或导出。升级到 2.7.0 后，在阿里云 Workbench 终端运行：

```bash
sudo bash /opt/fangcun/deploy/reset-password.sh '<用户名>'
sudo bash /opt/fangcun/deploy/reset-password.sh owner
```

脚本会隐藏输入、要求确认两次、重新启用账号，并注销该账号在所有设备上的旧会话。不要把新密码直接写进命令行或聊天记录。

## 6. 构建 APK

项目已经提供可重复构建脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1
```

第一次会将官方 JDK 17、Android SDK 36、Build Tools 36.0.0 与 Gradle 9.5 放到项目 `.tooling/`；以后可以加 `-SkipDownloads`。输出测试包：

```text
release/fangcun-v2.7.0-debug.apk
```

测试包适合自己安装验收，不应用于公开商店或长期分发。正式签名配置见 `android/README.md`，生产密钥必须离线备份并永久保留。

## 7. 安装到 REDMI

开启手机“开发者选项 → USB 调试”，连接电脑后：

```powershell
.\.tooling\android-sdk\platform-tools\adb.exe devices
.\.tooling\android-sdk\platform-tools\adb.exe install -r .\release\fangcun-v2.7.0-debug.apk
```

首次启动允许通知和日历读写权限；在小米应用设置中允许自启动、后台运行，并把省电策略设为无限制。日历互通入口位于方寸“日历 → 同步与导入”。

## 8. 本次界面回滚

按 [Workbench 交接说明](workbench-xuan.md) 从本次备份恢复程序和 service unit，保留现有业务数据与配置。不要用旧数据库覆盖升级后新增的事项。
