package top.woxingsf.fangcun;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import org.json.JSONObject;

public final class CapabilityDetector {
    private CapabilityDetector() {}

    public static JSONObject snapshot(Context context) {
        JSONObject result = new JSONObject();
        String manufacturer = Build.MANUFACTURER == null ? "unknown" : Build.MANUFACTURER;
        boolean xiaomi = manufacturer.toLowerCase().contains("xiaomi") || manufacturer.toLowerCase().contains("redmi");
        boolean notifications = Build.VERSION.SDK_INT < 33
            || ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled();
        boolean exactAlarm = Build.VERSION.SDK_INT < 31
            || ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).canScheduleExactAlarms();
        try {
            result.put("manufacturer", manufacturer);
            result.put("model", Build.MODEL);
            result.put("androidApi", Build.VERSION.SDK_INT);
            result.put("hyperOsCandidate", xiaomi);
            result.put("superIsland", false);
            result.put("superIslandState", "unavailable");
            result.put("superIslandNote", "未接入可验证的公开超级岛 API");
            result.put("islandAdapter", "android.notification");
            result.put("notificationFallback", notifications ? "available" : "permission_required");
            result.put("notifications", notifications);
            result.put("exactAlarm", exactAlarm);
            result.put("methodChannelReady", true);
            result.put("eventSchema", NativeEventContract.SCHEMA);
            result.put("wristband", new WristbandManager(context).capabilities());
        } catch (Exception ignored) {
            // JSONObject writes above are best effort; the fallback object is still useful to callers.
        }
        return result;
    }
}
