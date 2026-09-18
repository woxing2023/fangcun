package top.woxingsf.fangcun;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import org.json.JSONObject;

/** Public Android notification fallback used when no verified vendor surface exists. */
public final class NotificationIslandAdapter implements IslandAdapter {
    private static final String CHANNEL_ID = "fangcun_developer_island";
    private static final int NOTIFICATION_ID = 4617;
    private final Context context;
    private final NotificationManager notifications;

    public NotificationIslandAdapter(Context context) {
        this.context = context.getApplicationContext();
        notifications = (NotificationManager) this.context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && notifications != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "方寸开发者事件", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("超级岛不可用时的通知回退");
            notifications.createNotificationChannel(channel);
        }
    }

    @Override public JSONObject render(String event, JSONObject payload) {
        JSONObject result = capabilities();
        if (notifications == null) return with(result, "state", "unavailable");
        if (Build.VERSION.SDK_INT >= 33 && !notifications.areNotificationsEnabled()) {
            return with(result, "state", "permission_required");
        }
        String body = bodyFor(event, payload);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, CHANNEL_ID) : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_launcher).setContentTitle(titleFor(event))
            .setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_EVENT).setPriority(Notification.PRIORITY_HIGH)
            .setOnlyAlertOnce(true).setOngoing(isOngoing(event)).setShowWhen(false);
        try {
            notifications.notify(NOTIFICATION_ID, builder.build());
            return with(result, "state", "delivered");
        } catch (SecurityException ignored) {
            return with(result, "state", "permission_required");
        }
    }

    @Override public void clear() { if (notifications != null) notifications.cancel(NOTIFICATION_ID); }

    @Override public JSONObject capabilities() {
        JSONObject result = new JSONObject();
        try {
            result.put("id", "android.notification");
            result.put("state", notifications == null ? "unavailable" : "available");
            result.put("isSuperIsland", false);
            result.put("note", "使用公开 Android Notification API 的回退展示，不代表超级岛接入");
        } catch (Exception ignored) {}
        return result;
    }

    private static JSONObject with(JSONObject source, String key, String value) {
        try { source.put(key, value); } catch (Exception ignored) {}
        return source;
    }
    private static boolean isOngoing(String event) { return "focus.start".equals(event) || "focus.pause".equals(event) || "course.start".equals(event); }
    private static String titleFor(String event) {
        if ("focus.start".equals(event)) return "方寸 · Focus 进行中";
        if ("focus.pause".equals(event)) return "方寸 · Focus 已暂停";
        if ("focus.complete".equals(event)) return "方寸 · Focus 完成";
        if ("course.start".equals(event)) return "方寸 · 日程进行中";
        if ("ddl.remind".equals(event)) return "方寸 · 截止提醒";
        return "方寸 · 开发者事件";
    }
    private static String bodyFor(String event, JSONObject payload) {
        if (event != null && event.startsWith("focus.")) return payload.optString("title", "C++训练") + " · " + payload.optString("progress", "43 / 60 min");
        if ("course.start".equals(event)) return payload.optString("title", "大学物理实验") + " · " + payload.optString("time", "14:30 - 16:30");
        if ("ddl.remind".equals(event)) return payload.optString("title", "实验报告") + " · " + payload.optString("due", "今天 23:59");
        return payload.optString("message", "已触发原生适配层事件");
    }
}
