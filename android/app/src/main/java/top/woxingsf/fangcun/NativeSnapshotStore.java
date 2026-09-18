package top.woxingsf.fangcun;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/** Small, versioned snapshot shared by future widgets, search and push adapters. */
public final class NativeSnapshotStore {
    private static final String PREFS = "fangcun_native_snapshot";
    private static final String SNAPSHOT_KEY = "snapshot_v1";
    private final SharedPreferences preferences;

    public NativeSnapshotStore(Context context) {
        preferences = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public void saveEvent(String event, JSONObject payload, long updatedAt) {
        JSONObject snapshot = read();
        try {
            snapshot.put("version", 1);
            snapshot.put("lastEvent", event);
            snapshot.put("updatedAt", updatedAt);
            snapshot.put("payload", payload == null ? new JSONObject() : payload);
        } catch (Exception ignored) {
            return;
        }
        preferences.edit().putString(SNAPSHOT_KEY, snapshot.toString()).apply();
    }

    /** Stores the framework-neutral Today projection consumed by widgets and search. */
    public void saveToday(JSONObject today, long updatedAt) {
        JSONObject snapshot = read();
        try {
            snapshot.put("version", 1);
            snapshot.put("today", normalizeToday(today));
            snapshot.put("updatedAt", updatedAt);
        } catch (Exception ignored) {
            return;
        }
        preferences.edit().putString(SNAPSHOT_KEY, snapshot.toString()).apply();
    }

    public JSONObject read() {
        try {
            JSONObject snapshot = new JSONObject(preferences.getString(SNAPSHOT_KEY, "{}"));
            if (!snapshot.has("today")) snapshot.put("today", emptyToday());
            return snapshot;
        } catch (Exception ignored) {
            JSONObject snapshot = new JSONObject();
            try { snapshot.put("version", 1); snapshot.put("today", emptyToday()); }
            catch (Exception ignoredAgain) {}
            return snapshot;
        }
    }

    private static JSONObject normalizeToday(JSONObject today) {
        JSONObject normalized = new JSONObject();
        try {
            JSONObject source = today == null ? new JSONObject() : today;
            normalized.put("focus", source.optJSONArray("focus") == null ? new JSONArray() : source.optJSONArray("focus"));
            normalized.put("nextEvent", source.optJSONObject("nextEvent") == null ? new JSONObject() : source.optJSONObject("nextEvent"));
            normalized.put("deadlines", source.optJSONArray("deadlines") == null ? new JSONArray() : source.optJSONArray("deadlines"));
            normalized.put("progress", Math.max(0, Math.min(1, source.optDouble("progress", 0))));
        } catch (Exception ignored) {}
        return normalized;
    }

    private static JSONObject emptyToday() {
        JSONObject today = new JSONObject();
        try {
            today.put("focus", new JSONArray());
            today.put("nextEvent", new JSONObject());
            today.put("deadlines", new JSONArray());
            today.put("progress", 0);
        } catch (Exception ignored) {}
        return today;
    }
}
