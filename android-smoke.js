const fs = require("node:fs");
const path = require("node:path");

const required = [
  "android/settings.gradle.kts",
  "android/build.gradle.kts",
  "android/app/build.gradle.kts",
  "android/app/src/main/AndroidManifest.xml",
  "android/app/src/main/java/top/woxingsf/fangcun/MainActivity.java",
  "android/app/src/main/java/top/woxingsf/fangcun/ReminderScheduler.java",
  "android/app/src/main/java/top/woxingsf/fangcun/ReminderReceiver.java",
  "android/app/src/main/java/top/woxingsf/fangcun/BootReceiver.java",
  "android/app/src/main/java/top/woxingsf/fangcun/SystemCalendarBridge.java",
  "android/app/src/main/java/top/woxingsf/fangcun/MainActivity.java",
  "android/app/src/main/java/top/woxingsf/fangcun/ReminderScheduler.java",
  "android/app/src/main/java/top/woxingsf/fangcun/ReminderReceiver.java",
  "android/app/src/main/java/top/woxingsf/fangcun/BootReceiver.java",
  "android/app/src/main/java/top/woxingsf/fangcun/SystemCalendarBridge.java",
  "android/app/src/main/java/top/woxingsf/fangcun/WristbandAdapter.java",
  "android/app/src/main/java/top/woxingsf/fangcun/UnsupportedWristbandAdapter.java",
  "android/app/src/main/java/top/woxingsf/fangcun/WristbandManager.java",
  "android/app/src/main/java/top/woxingsf/fangcun/NativeSnapshotStore.java",
  "android/app/src/main/java/top/woxingsf/fangcun/DeepLinkRouter.java",
  "android/app/src/main/java/top/woxingsf/fangcun/TodayWidgetProvider.java",
  "android/app/src/main/java/top/woxingsf/fangcun/NativeEventContract.java",
  "android/app/src/main/java/top/woxingsf/fangcun/IslandAdapter.java",
  "android/app/src/main/java/top/woxingsf/fangcun/NotificationIslandAdapter.java",
  "android/app/src/main/res/layout/widget_today_2x2.xml",
  "android/app/src/main/res/layout/widget_today_4x2.xml",
  "android/app/src/main/res/layout/widget_today_4x4.xml",
];
required.forEach((file) => { if (!fs.existsSync(path.resolve(file))) throw new Error(`安卓端缺少文件：${file}`); });

const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
const activity = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/MainActivity.java", "utf8");
const activityLayout = fs.readFileSync("android/app/src/main/res/layout/activity_main.xml", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const gradle = fs.readFileSync("android/app/build.gradle.kts", "utf8");
for (const marker of ["setOnApplyWindowInsetsListener", "WindowInsets.Type.systemBars()", "WindowInsets.Type.displayCutout()", "--native-safe-top", "notifyExternalOpened", "FangcunExternalOpened"]) {
  if (!activity.includes(marker)) throw new Error(`安卓安全区或授权反馈缺少：${marker}`);
}
for (const marker of ["setWebChromeClient", "onShowFileChooser", "ACTION_OPEN_DOCUMENT", "ACTION_CREATE_DOCUMENT", "CATEGORY_OPENABLE", "saveDocument", "FangcunDocumentSaved", "fileChooserCallback.onReceiveValue", "calendarRequest", "fileWorker.execute"]) {
  if (!activity.includes(marker)) throw new Error(`安卓文件与异步日历桥缺少：${marker}`);
}
if (!manifest.includes('android:configChanges="orientation|screenSize|keyboardHidden"')) throw new Error("旋转屏幕不得重建并丢失文件选择状态");
for (const permission of ["POST_NOTIFICATIONS", "SCHEDULE_EXACT_ALARM", "RECEIVE_BOOT_COMPLETED", "READ_CALENDAR", "WRITE_CALENDAR", "com.android.alarm.permission.SET_ALARM"]) {
  if (!manifest.includes(permission)) throw new Error(`安卓端缺少权限声明：${permission}`);
}
if ((!activity.includes("https://schedule.woxingsf.top/") && !gradle.includes('buildConfigField("String", "FANGCUN_BASE_URL"')) || !activity.includes("FangcunNative")) throw new Error("安卓端未绑定可信域名或原生桥");
for (const marker of ["getWristbandCapabilities", "getWristbandStatus", "connectWristband", "disconnectWristband", "syncWristband"]) if (!activity.includes(marker)) throw new Error(`手环预备桥缺少：${marker}`);
const wristbandAdapter = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/WristbandAdapter.java", "utf8");
const unsupportedWristband = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/UnsupportedWristbandAdapter.java", "utf8");
if (!wristbandAdapter.includes("fangcun.wristband.v1") || !wristbandAdapter.includes("STATE_UNSUPPORTED") || !wristbandAdapter.includes("bluetooth-le") || !unsupportedWristband.includes("尚未接入手环厂商 SDK") || !unsupportedWristband.includes('"available", false')) throw new Error("手环预备桥必须明确为未接入厂商 SDK 的 unsupported 状态");
for (const marker of ["PRIVACY_CONSENT_KEY", "showPrivacyConsent", "同意并继续", "拒绝并退出", "privacy.html", "setSafeBrowsingEnabled(true)"]) if (!activity.includes(marker)) throw new Error(`安卓壳缺少首次隐私同意或 WebView 安全设置：${marker}`);
if (!manifest.includes('android:permission="android.permission.RECEIVE_BOOT_COMPLETED"')) throw new Error("开机广播接收器缺少系统权限保护");
if (!app.includes("syncNativeReminders") || !app.includes("requestReminderPermissions") || !app.includes("syncNativeSnapshot") || !app.includes("FangcunNativeDeepLink")) throw new Error("网页端未接入安卓提醒、Today 快照或 Deep Link 桥");
if (manifest.includes('android:host="voice"') || activity.includes("handleVoiceIntent") || activity.includes('quick", "voice')) throw new Error("已停用的小爱语音入口仍残留在安卓壳中");
const reminderScheduler = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/ReminderScheduler.java", "utf8");
for (const alarmPart of ["AlarmClock.ACTION_SET_ALARM", "AlarmClock.EXTRA_HOUR", "AlarmClock.EXTRA_MINUTES", "AlarmClock.EXTRA_MESSAGE", "AlarmClock.EXTRA_SKIP_UI", "systemAlarm"]) if (!reminderScheduler.includes(alarmPart)) throw new Error(`系统闹钟意图缺少：${alarmPart}`);
if (!reminderScheduler.includes("已预填系统闹钟，请在时钟中确认保存") || !reminderScheduler.includes("continue;")) throw new Error("系统闹钟模式未提供确认降级或仍会重复调度应用内提醒");
if (!reminderScheduler.includes("SYSTEM_ALARM_WINDOW_MS") || !reminderScheduler.includes("at - now <= SYSTEM_ALARM_WINDOW_MS")) throw new Error("远期事项不得提前写成错误日期的系统闹钟");
if (!app.includes("taskAlarmMode") || !app.includes("courseAlarmMode") || !app.includes("systemAlarm: Boolean")) throw new Error("网页提醒编辑器未保存或下发系统闹钟模式");
if (app.includes("/api/voice/") || app.includes("FangcunVoiceCommandCreated")) throw new Error("网页端仍残留已停用的小爱语音接口");
if (!gradle.includes('versionName = "2.7.0"')) throw new Error("安卓版本号不是 v2.7.0");
if (!activity.includes("configureEdgeToEdgeWindow")) throw new Error("安卓壳应启用 edge-to-edge 横屏画布");
if (!activityLayout.includes('android:id="@+id/loadingView"') || !activityLayout.includes('android:visibility="invisible"') || !activity.includes("onPageCommitVisible") || !activity.includes("loadingView.setVisibility(View.GONE)")) throw new Error("安卓壳应在网页首帧可见前显示原生加载界面");
if (!activity.includes("LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES")) throw new Error("安卓壳应覆盖横屏短边刘海区域，避免黑边");
if (!activity.includes("readSystemCalendar") || !activity.includes("syncSystemCalendar") || !activity.includes('"fangcun"') || !activity.includes('"outlook-connected"') || !activity.includes('"google-connected"') || !activity.includes('"accounts.google.com"')) throw new Error("安卓壳缺少系统日历双向桥或 OAuth 返回链路");
const deepLinkRouter = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/DeepLinkRouter.java", "utf8");
for (const route of ["today", "task", "event", "course", "project", "focus", "calendar", "create"]) if (!deepLinkRouter.includes('"' + route + '"')) throw new Error(`Deep Link 缺少路由：${route}`);
if (!activity.includes("dispatchDeepLink") || !manifest.includes('android:host="today"') || !manifest.includes('android:host="calendar"')) throw new Error("安卓壳未注册 Deep Link 路由");
const snapshotStore = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/NativeSnapshotStore.java", "utf8");
for (const marker of ["saveToday", '"focus"', '"nextEvent"', '"deadlines"', '"progress"']) if (!snapshotStore.includes(marker)) throw new Error(`Native Today 快照缺少：${marker}`);
const widgetProvider = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/TodayWidgetProvider.java", "utf8");
for (const marker of ["new NativeSnapshotStore", "widget_today_2x2", "widget_today_4x2", "widget_today_4x4", "fangcun://today"]) if (!widgetProvider.includes(marker)) throw new Error(`Today Widget 缺少：${marker}`);
if (!manifest.includes("TodayWidgetProvider") || !manifest.includes("today_widget_info")) throw new Error("安卓壳未注册 Today Widget");
const nativeModule = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/HyperOSNativeModule.java", "utf8");
const islandAdapter = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/NotificationIslandAdapter.java", "utf8");
const nativeContract = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/NativeEventContract.java", "utf8");
const capabilities = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/CapabilityDetector.java", "utf8");
for (const marker of ["fangcun.native.v1", "unsupported_event", "superIsland", "notificationFallback", "permission_required", "islandAdapter"]) if (![nativeModule, islandAdapter, nativeContract, capabilities].some((source) => source.includes(marker))) throw new Error(`HyperOS 原生能力边界缺少：${marker}`);
const calendarBridge = fs.readFileSync("android/app/src/main/java/top/woxingsf/fangcun/SystemCalendarBridge.java", "utf8");
if (!calendarBridge.includes("CalendarContract.ACCOUNT_TYPE_LOCAL") || !calendarBridge.includes("Events.SYNC_DATA1") || !calendarBridge.includes("replaceReminder")) throw new Error("安卓系统日历桥缺少专用日历、稳定映射或提醒同步");
if (!calendarBridge.includes("insert(asSyncAdapter(Events.CONTENT_URI, account)") || !calendarBridge.includes("update(asSyncAdapter(eventUri, account)") || !calendarBridge.includes("delete(asSyncAdapter(eventUri, account)")) throw new Error("安卓系统日历桥写入同步字段时未使用 Sync Adapter URI");
if (calendarBridge.includes("insert(Events.CONTENT_URI") || calendarBridge.includes("update(eventUri, values") || calendarBridge.includes("delete(eventUri, null")) throw new Error("安卓系统日历桥仍存在普通 URI 写入同步字段的回归风险");
console.log("安卓端检查通过：系统闹钟、可信域名壳、通知/日历权限、开机恢复完整，且小爱入口已移除。");
