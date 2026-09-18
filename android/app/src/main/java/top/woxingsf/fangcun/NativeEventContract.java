package top.woxingsf.fangcun;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Event names shared by the WebView bridge and the future Flutter channel. */
public final class NativeEventContract {
    public static final String SCHEMA = "fangcun.native.v1";
    private static final Set<String> EVENTS = new HashSet<>(Arrays.asList(
        "focus.start", "focus.pause", "focus.complete", "course.start", "ddl.remind"
    ));
    private NativeEventContract() {}
    public static boolean isSupported(String event) { return event != null && EVENTS.contains(event); }
}
