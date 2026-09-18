package top.woxingsf.fangcun;

import org.json.JSONObject;

/** Vendor-neutral seam for a future BLE or vendor wristband implementation. */
public interface WristbandAdapter {
    String API = "fangcun.wristband.v1";
    String TRANSPORT_BLE = "bluetooth-le";
    String STATE_DISCONNECTED = "disconnected";
    String STATE_CONNECTING = "connecting";
    String STATE_CONNECTED = "connected";
    String STATE_UNSUPPORTED = "unsupported";
    String STATE_ERROR = "error";

    JSONObject capabilities();
    JSONObject status();
    JSONObject connect(JSONObject options);
    JSONObject disconnect();
    JSONObject sync(JSONObject payload);

    default JSONObject openApp(JSONObject options) {
        JSONObject result = new JSONObject();
        try { result.put("ok", false).put("error", "unsupported"); }
        catch (Exception ignored) {}
        return result;
    }
}
