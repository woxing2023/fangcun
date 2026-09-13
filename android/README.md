# 方寸 Android

这是方寸 v2.5 的原生 Android 壳，固定加载 `https://fangcun.example.org/`，不显示浏览器地址栏。它只允许方寸域名留在应用内，其他链接交给系统浏览器。

原生桥会接收网页端生成的未来课程、日程和截止提醒，并通过 `AlarmManager` 注册系统提醒；还会创建当前方寸账号专属的 Android 本地日历，让小米日历与方寸双向新增、修改和删除。Android 13 及以上需要通知权限；系统日历需要读写日历权限；Android 12 及以上如需精确触发，还需要用户在“闹钟和提醒”特殊权限页授权。未授权精确闹钟时会自动降级为系统允许的非精确提醒。

## 构建

在项目根目录用 PowerShell 运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1
```

脚本会把 Temurin JDK 17、Android 命令行工具、SDK 36、Build Tools 36.0.0 和 Gradle 9.5 下载到项目内的 `.tooling/`，生成 Gradle Wrapper，随后输出可直接安装的测试包 `release/fangcun-v2.7.0-debug.apk`。这些工具不会写入系统级 JDK 或 Android Studio 配置。

也可以安装 Android Studio 后打开本目录，等待 Gradle 同步并运行 `app` 到真机。

## 正式签名包

对外分发前必须使用长期保管的同一把发布密钥。不要把 `.jks`、密码或签名配置提交到源码包。设置下列环境变量后运行：

```powershell
$env:FANGCUN_KEYSTORE_PATH = "D:\secure\fangcun-release.jks"
$env:FANGCUN_KEYSTORE_PASSWORD = "你的密钥库密码"
$env:FANGCUN_KEY_ALIAS = "fangcun"
$env:FANGCUN_KEY_PASSWORD = "你的密钥密码"
powershell -ExecutionPolicy Bypass -File .\android\build-apk.ps1 -Variant Release -SkipDownloads
```

输出文件为 `release/fangcun-v2.7.0-release.apk`。以后升级必须使用同一密钥，否则 Android 不允许覆盖安装。

## 安装到 Android

打开“开发者选项 → USB 调试”，连接电脑并确认手机上的授权弹窗：

```powershell
.\.tooling\android-sdk\platform-tools\adb.exe devices
.\.tooling\android-sdk\platform-tools\adb.exe install -r .\release\fangcun-v2.7.0-debug.apk
```

首次启动后允许通知、日历读写权限；在小米“应用信息”中允许自启动、后台运行，并将省电策略设为无限制，才能获得稳定提醒。

当前项目使用 AGP 9.3.0、Gradle 9.5 兼容配置、`compileSdk/targetSdk 36`，最低支持 Android 8.0（API 26）。
