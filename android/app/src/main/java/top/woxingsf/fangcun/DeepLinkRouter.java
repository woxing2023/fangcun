package top.woxingsf.fangcun;

import android.content.Intent;
import android.net.Uri;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/** Parses the stable fangcun:// contract without making WebView responsible for routing. */
public final class DeepLinkRouter {
    private static final String SCHEME = "fangcun";
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z0-9._~-]{1,128}");
    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Set<String> NO_ARGUMENT_ROUTES = new HashSet<>(Arrays.asList("today", "create"));
    private static final Set<String> IDENTIFIER_ROUTES = new HashSet<>(Arrays.asList("task", "event", "course", "project", "focus"));
    private final String httpsHost;

    public DeepLinkRouter(String httpsHost) {
        this.httpsHost = httpsHost == null ? "" : httpsHost.toLowerCase();
    }

    public JSONObject parse(Intent intent) {
        JSONObject result = new JSONObject();
        try {
            result.put("matched", false);
            Uri data = intent == null ? null : intent.getData();
            if (data == null) return result;

            String type;
            String value = "";
            String source;
            if (SCHEME.equalsIgnoreCase(data.getScheme())) {
                type = data.getHost();
                List<String> path = data.getPathSegments();
                if ((type == null || type.isEmpty()) && !path.isEmpty()) {
                    type = path.get(0);
                    if (path.size() > 1) value = path.get(1);
                } else if (!path.isEmpty()) {
                    value = path.get(0);
                }
                source = "custom";
            } else if ("https".equalsIgnoreCase(data.getScheme()) && httpsHost.equalsIgnoreCase(data.getHost())) {
                List<String> path = data.getPathSegments();
                if (path.isEmpty()) return result;
                type = path.get(0);
                if (path.size() > 1) value = path.get(1);
                source = "https";
            } else {
                return result;
            }

            if (type == null || !isSupported(type, value)) return result;
            String deepLink = SCHEME + "://" + type + (value.isEmpty() ? "" : "/" + Uri.encode(value));
            result.put("matched", true);
            result.put("type", type);
            result.put("source", source);
            result.put("deepLink", deepLink);
            if ("calendar".equals(type)) result.put("date", value);
            else if (!value.isEmpty()) result.put("id", value);
        } catch (Exception ignored) {
            // A malformed external intent must never prevent the app from opening.
        }
        return result;
    }

    private static boolean isSupported(String type, String value) {
        if (NO_ARGUMENT_ROUTES.contains(type)) return value.isEmpty();
        if (IDENTIFIER_ROUTES.contains(type)) return IDENTIFIER.matcher(value).matches();
        return "calendar".equals(type) && DATE.matcher(value).matches();
    }
}
