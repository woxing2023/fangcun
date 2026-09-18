package top.woxingsf.fangcun;

import android.content.Context;
import org.json.JSONObject;

/** Stable facade; replace the adapter only when a vendor API is verified. */
public final class IslandManager {
    private final IslandAdapter adapter;

    public IslandManager(Context context) {
        adapter = new NotificationIslandAdapter(context);
    }

    public JSONObject render(String event, JSONObject payload) { return adapter.render(event, payload == null ? new JSONObject() : payload); }

    public void clear() { adapter.clear(); }
    public JSONObject capabilities() { return adapter.capabilities(); }
}
