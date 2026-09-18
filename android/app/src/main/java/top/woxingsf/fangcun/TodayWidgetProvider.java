package top.woxingsf.fangcun;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Home-screen Today widget. It only reads NativeSnapshotStore, never WebView state. */
public final class TodayWidgetProvider extends AppWidgetProvider {
    private static final int LARGE_WIDTH_DP = 250;
    private static final int LARGE_HEIGHT_DP = 200;

    public static void updateAll(Context context) {
        Context app = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(app);
        ComponentName provider = new ComponentName(app, TodayWidgetProvider.class);
        for (int id : manager.getAppWidgetIds(provider)) updateOne(app, manager, id);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) updateOne(context.getApplicationContext(), manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        updateOne(context.getApplicationContext(), manager, appWidgetId);
    }

    private static void updateOne(Context context, AppWidgetManager manager, int id) {
        Bundle options = manager.getAppWidgetOptions(id);
        int width = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        int height = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        int layout = width >= LARGE_WIDTH_DP && height >= LARGE_HEIGHT_DP
            ? R.layout.widget_today_4x4
            : width >= LARGE_WIDTH_DP ? R.layout.widget_today_4x2 : R.layout.widget_today_2x2;

        JSONObject today = new NativeSnapshotStore(context).read().optJSONObject("today");
        if (today == null) today = new JSONObject();
        JSONObject next = today.optJSONObject("nextEvent");
        JSONArray focus = today.optJSONArray("focus");
        JSONArray deadlines = today.optJSONArray("deadlines");
        String nextTitle = next == null ? "暂无下一安排" : next.optString("title", "暂无下一安排");
        String nextDue = next == null ? "" : next.optString("dueAt", "");
        String deadline = firstTitle(deadlines, "最近没有 DDL");
        String focusText = focusSummary(focus);
        int progress = (int) Math.round(Math.max(0, Math.min(1, today.optDouble("progress", 0))) * 100);

        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        views.setTextViewText(R.id.widgetNext, nextTitle);
        views.setTextViewText(R.id.widgetNextMeta, nextDue.isEmpty() ? "今天 · 方寸" : nextDue);
        views.setTextViewText(R.id.widgetDeadline, deadline);
        views.setTextViewText(R.id.widgetFocus, focusText);
        views.setTextViewText(R.id.widgetProgress, "今日完成 " + progress + "%");
        views.setOnClickPendingIntent(R.id.widgetRoot, openToday(context));
        manager.updateAppWidget(id, views);
    }

    private static String firstTitle(JSONArray items, String fallback) {
        if (items == null || items.length() == 0) return fallback;
        return items.optJSONObject(0) == null ? fallback : items.optJSONObject(0).optString("title", fallback);
    }

    private static String focusSummary(JSONArray items) {
        if (items == null || items.length() == 0) return "今天还没有固定 Focus";
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < Math.min(3, items.length()); index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            if (result.length() > 0) result.append(" · ");
            result.append(item.optString("title", "Focus"));
        }
        return result.toString();
    }

    private static PendingIntent openToday(Context context) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("fangcun://today"));
        intent.setPackage(context.getPackageName());
        return PendingIntent.getActivity(context, 7401, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
