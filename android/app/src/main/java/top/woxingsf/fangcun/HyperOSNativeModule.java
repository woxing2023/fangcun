package top.woxingsf.fangcun;

import android.content.Context;
import org.json.JSONObject;

/** Stable native seam shared by WebView today and Flutter MethodChannel later. */
public final class HyperOSNativeModule {
    private final NativeSnapshotStore snapshots;
    private final IslandManager island;
    private final HapticManager haptics;
    private final WristbandManager wristband;
    private final Context context;

    public HyperOSNativeModule(Context context) {
        this.context = context.getApplicationContext();
        snapshots = new NativeSnapshotStore(this.context);
        island = new IslandManager(this.context);
        haptics = new HapticManager(this.context);
        wristband = new WristbandManager(this.context);
    }

    public JSONObject triggerEvent(String event, JSONObject payload) {
        if (!NativeEventContract.isSupported(event)) {
            JSONObject rejected = new JSONObject();
            try { rejected.put("ok", false).put("error", "unsupported_event").put("eventSchema", NativeEventContract.SCHEMA); }
            catch (Exception ignored) {}
            return rejected;
        }
        long now = System.currentTimeMillis();
        snapshots.saveEvent(event, payload, now);
        JSONObject delivery = island.render(event, payload);
        haptics.play(hapticFor(event));
        JSONObject result = new JSONObject();
        try {
            result.put("ok", true);
            result.put("event", event);
            result.put("updatedAt", now);
            result.put("capabilities", CapabilityDetector.snapshot(context));
            result.put("island", delivery);
            result.put("haptic", hapticFor(event));
        } catch (Exception ignored) {}
        return result;
    }

    public void clearEvent() {
        island.clear();
        snapshots.saveEvent("clear", new JSONObject(), System.currentTimeMillis());
    }

    public JSONObject capabilities() { return CapabilityDetector.snapshot(context); }
    public JSONObject wristbandCapabilities() { return wristband.capabilities(); }
    public JSONObject wristbandStatus() { return wristband.status(); }
    public JSONObject connectWristband(JSONObject options) { return wristband.connect(options); }
    public JSONObject disconnectWristband() { return wristband.disconnect(); }
    public JSONObject syncWristband(JSONObject payload) { return wristband.sync(payload); }
    public JSONObject openWristbandApp(JSONObject options) { return wristband.openApp(options); }
    public JSONObject snapshot() { return snapshots.read(); }
    public void saveTodaySnapshot(String payload) {
        try {
            snapshots.saveToday(new JSONObject(payload == null ? "{}" : payload), System.currentTimeMillis());
            TodayWidgetProvider.updateAll(context);
        } catch (Exception ignored) {
            // Invalid WebView input is ignored; the last valid snapshot remains intact.
        }
    }
    public void refreshWidget() { TodayWidgetProvider.updateAll(context); }
    public void haptic(String semantic) { haptics.play(semantic); }

    private static String hapticFor(String event) {
        if (event == null) return "light";
        if (event.endsWith(".complete")) return "success";
        if (event.endsWith(".start")) return "start";
        if (event.endsWith(".pause")) return "snap";
        if (event.endsWith(".remind")) return "confirm";
        return "light";
    }
}
