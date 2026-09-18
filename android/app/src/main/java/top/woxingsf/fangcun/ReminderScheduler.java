package top.woxingsf.fangcun;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.provider.AlarmClock;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

final class ReminderScheduler {
    private static final String PREFS = "fangcun_native_reminders";
    private static final String PAYLOAD = "payload";
    private static final String SYSTEM_ALARMS = "system_alarms";
    private static final long SYSTEM_ALARM_WINDOW_MS = 24L * 60L * 60L * 1000L;

    private ReminderScheduler() {}

    static synchronized void replaceAll(Context context, String payload) {
        cancelStored(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PAYLOAD, payload).apply();
        schedulePayload(context, payload);
    }

    static synchronized void rescheduleStored(Context context) {
        String payload = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PAYLOAD, "");
        if (!payload.isEmpty()) schedulePayload(context, payload);
    }

    private static void cancelStored(Context context) {
        String payload = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PAYLOAD, "");
        if (payload.isEmpty()) return;
        try {
            JSONArray items = new JSONObject(payload).optJSONArray("items");
            if (items == null) return;
            AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            for (int index = 0; index < items.length(); index++) {
                String id = items.getJSONObject(index).optString("id");
                manager.cancel(alarmIntent(context, id, "", ""));
            }
        } catch (Exception ignored) {}
    }

    private static void schedulePayload(Context context, String payload) {
        try {
            JSONArray items = new JSONObject(payload).optJSONArray("items");
            if (items == null) return;
            AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            long now = System.currentTimeMillis();
            Set<String> existingSystemAlarms = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(SYSTEM_ALARMS, new HashSet<>());
            Set<String> currentSystemAlarms = new HashSet<>();
            for (int index = 0; index < items.length(); index++) {
                JSONObject item = items.getJSONObject(index);
                long at = item.optLong("at");
                if (at <= now) continue;
                if (item.optBoolean("systemAlarm", false) && at - now <= SYSTEM_ALARM_WINDOW_MS) {
                    String signature = item.optString("id") + "|" + at;
                    currentSystemAlarms.add(signature);
                    if (!existingSystemAlarms.contains(signature)) openSystemAlarm(context, at, item.optString("title", "方寸提醒"));
                    continue;
                }
                PendingIntent pending = alarmIntent(context, item.optString("id"), item.optString("title", "方寸提醒"), item.optString("body"));
                if (Build.VERSION.SDK_INT >= 31 && manager.canScheduleExactAlarms()) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                else if (Build.VERSION.SDK_INT >= 23) manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                else manager.setExact(AlarmManager.RTC_WAKEUP, at, pending);
            }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(SYSTEM_ALARMS, currentSystemAlarms).apply();
        } catch (Exception ignored) {}
    }

    private static Intent systemAlarmIntent(long at, String message) {
        java.util.Calendar time = java.util.Calendar.getInstance();
        time.setTimeInMillis(at);
        return new Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, time.get(java.util.Calendar.HOUR_OF_DAY))
            .putExtra(AlarmClock.EXTRA_MINUTES, time.get(java.util.Calendar.MINUTE))
            .putExtra(AlarmClock.EXTRA_MESSAGE, message)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static void openSystemAlarm(Context context, long at, String message) {
        new Handler(Looper.getMainLooper()).post(() -> {
            Intent intent = systemAlarmIntent(at, message);
            if (intent.resolveActivity(context.getPackageManager()) == null) {
                Toast.makeText(context, "没有找到可设置闹钟的系统时钟应用", Toast.LENGTH_LONG).show();
                return;
            }
            Toast.makeText(context, "已预填系统闹钟，请在时钟中确认保存", Toast.LENGTH_LONG).show();
            context.startActivity(intent);
        });
    }

    private static PendingIntent alarmIntent(Context context, String id, String title, String body) {
        Intent intent = new Intent(context, ReminderReceiver.class)
            .putExtra("id", id)
            .putExtra("title", title)
            .putExtra("body", body);
        int requestCode = id.hashCode() & 0x7fffffff;
        return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
