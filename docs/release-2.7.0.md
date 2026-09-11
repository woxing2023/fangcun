# 方寸 2.7.0 交付与上线清单

## 本次交付物

- `release/fangcun-release-2.7.0-calendar3.tar.gz`：服务器源码升级包。
- `release/fangcun-SHA256SUMS-20260911-calendar3.txt`：对应 SHA-256 校验文件。
- 构建标识：`20260911-calendar-v3`；GitHub Release tag：`fangcun-deploy-20260911-calendar-v3`。

本次只在本地检查、打包和交付，未执行远端上传或部署。Hermes 负责 GitHub Release 上传与 Workbench 下载、校验、升级。暂存目录使用随机临时目录或 `$HOME`，不依赖固定登录账户路径。

完整命令及保留业务数据的回滚步骤见 [Workbench 交接说明](workbench-xuan.md)。服务继续只监听 `127.0.0.1:18443`，沿用现有 Cloudflare Tunnel，不修改 nginx、hysteria2 或公网端口。

本次更新网页资源，没有新建 Android 壳或重新生成 APK。下面保留已有 APK 的安装与权限说明；是否需要安装取决于设备上已有壳的版本。

## APK 安装与小米权限

优先直接覆盖安装以保留登录和本机状态：

```powershell
.\.tooling\android-sdk\platform-tools\adb.exe install -r .\release\fangcun-v2.7.0-debug.apk
```

在手机系统设置中为方寸允许：通知、日历读写、闹钟和提醒、自启动、后台活动，并把电池策略设为无限制。系统日历入口在“日历 → 同步与导入”。

系统闹钟模式只对未来 24 小时内的提醒打开系统时钟并预填时间和名称，用户仍需确认保存。远期提醒自动使用方寸原生精确通知，避免系统时钟在错误日期提前响铃。

## 当前功能边界

本版不接入第三方语音助手。自然语言识别只在方寸的快捷输入中运行，识别结果会先显示预览，确认后才写入。提醒由方寸通知或用户确认后的系统闹钟承担。
