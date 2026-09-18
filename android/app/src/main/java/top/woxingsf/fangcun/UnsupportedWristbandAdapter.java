package top.woxingsf.fangcun;

import org.json.JSONObject;

/** Explicit placeholder until a supported wearable provider is selected. */
public final class UnsupportedWristbandAdapter implements WristbandAdapter {
    private static final String NOTE = "尚未接入手环厂商 SDK；当前仅提供稳定连接协议";

    @Override public JSONObject capabilities() {
        JSONObject value = base();
        try {
            value.put("available", false);
            value.put("state", STATE_UNSUPPORTED);
            value.put("supportedTransports", new String[]{TRANSPORT_BLE});
            value.put("requiresPermissions", new String[]{"android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT"});
            value.put("features", new JSONObject().put("heartRate", false).put("steps", false).put("notifications", false).put("workout", false));
        } catch (Exception ignored) {}
        return value;
    }

    @Override public JSONObject status() { return capabilities(); }
    @Override public JSONObject connect(JSONObject options) { return unavailable("connect"); }
    @Override public JSONObject disconnect() { return unavailable("disconnect"); }
    @Override public JSONObject sync(JSONObject payload) { return unavailable("sync"); }

    private JSONObject base() {
        JSONObject value = new JSONObject();
        try { value.put("api", API).put("adapter", "none").put("transport", TRANSPORT_BLE).put("note", NOTE); }
        catch (Exception ignored) {}
        return value;
    }

    private JSONObject unavailable(String operation) {
        JSONObject value = base();
        try { value.put("ok", false).put("operation", operation).put("state", STATE_UNSUPPORTED).put("error", "unsupported"); }
        catch (Exception ignored) {}
        return value;
    }
}
