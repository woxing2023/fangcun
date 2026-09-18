package top.woxingsf.fangcun;

import org.json.JSONObject;

/**
 * Vendor-neutral seam for a future HyperOS surface. Implementations must report
 * what they actually delivered; a notification is not a Super Island claim.
 */
public interface IslandAdapter {
    JSONObject render(String event, JSONObject payload);
    void clear();
    JSONObject capabilities();
}
