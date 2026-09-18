package top.woxingsf.fangcun;

import android.content.Context;
import org.json.JSONObject;

/** Selects the active wearable provider without exposing vendor SDK types to the app. */
public final class WristbandManager {
    private final WristbandAdapter adapter;

    public WristbandManager(Context context) {
        adapter = new XiaomiWristbandAdapter(context);
    }

    public JSONObject capabilities() { return adapter.capabilities(); }
    public JSONObject status() { return adapter.status(); }
    public JSONObject connect(JSONObject options) { return adapter.connect(options == null ? new JSONObject() : options); }
    public JSONObject disconnect() { return adapter.disconnect(); }
    public JSONObject sync(JSONObject payload) { return adapter.sync(payload == null ? new JSONObject() : payload); }
    public JSONObject openApp(JSONObject options) { return adapter.openApp(options == null ? new JSONObject() : options); }
}
