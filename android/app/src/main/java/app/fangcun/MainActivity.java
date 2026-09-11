package app.fangcun;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.AlarmManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://fangcun.example.org/";
    private static final String APP_HOST = "fangcun.example.org";
    private static final String PRIVACY_CONSENT_KEY = "privacy-consent-2026-09-03";
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1201;
    private static final int CALENDAR_PERMISSION_REQUEST = 1202;
    private WebView webView;
    private View loadingView;
    private String safeInsetsScript = "";
    private SystemCalendarBridge systemCalendar;
    private static final int OPEN_DOCUMENT_REQUEST = 1301;
    private static final int SAVE_DOCUMENT_REQUEST = 1302;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingExport;
    private final ExecutorService fileWorker = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureEdgeToEdgeWindow();
        setContentView(R.layout.activity_main);
        ReminderReceiver.ensureChannel(this);
        systemCalendar = new SystemCalendarBridge(this);
        webView = findViewById(R.id.webview);
        loadingView = findViewById(R.id.loadingView);
        webView.setBackgroundColor(Color.rgb(244, 242, 237));
        configureWebView();
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            int top = insets.getStableInsetTop(), bottom = insets.getStableInsetBottom();
            int left = insets.getStableInsetLeft(), right = insets.getStableInsetRight();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = bars.top; bottom = bars.bottom; left = bars.left; right = bars.right;
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && insets.getDisplayCutout() != null) {
                top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
                left = Math.max(left, insets.getDisplayCutout().getSafeInsetLeft());
                right = Math.max(right, insets.getDisplayCutout().getSafeInsetRight());
            }
            float density = getResources().getDisplayMetrics().density;
            safeInsetsScript = "(()=>{const s=document.documentElement.style;"
                + "s.setProperty('--native-safe-top','" + Math.round(top / density) + "px');"
                + "s.setProperty('--native-safe-bottom','" + Math.round(bottom / density) + "px');"
                + "s.setProperty('--native-safe-left','" + Math.round(left / density) + "px');"
                + "s.setProperty('--native-safe-right','" + Math.round(right / density) + "px');})()";
            webView.evaluateJavascript(safeInsetsScript, null);
            return insets;
        });
        webView.requestApplyInsets();
        if (savedInstanceState == null) {
            if (hasPrivacyConsent()) startWebApp();
            else showPrivacyConsent();
        } else if (hasPrivacyConsent()) {
            webView.restoreState(savedInstanceState);
            webView.setVisibility(View.VISIBLE);
            loadingView.setVisibility(View.GONE);
        } else {
            showPrivacyConsent();
        }
    }

    private boolean hasPrivacyConsent() {
        return getPreferences(MODE_PRIVATE).getBoolean(PRIVACY_CONSENT_KEY, false);
    }

    private void startWebApp() {
        webView.loadUrl(APP_URL + integrationReturnQuery(getIntent()));
    }

    private void showPrivacyConsent() {
        String message = "欢迎使用方寸。请在使用前阅读并决定是否同意隐私政策。\n\n"
            + "方寸用于管理任务、课程、截止日期、长期项目和提醒。你主动创建或导入的这些内容会保存在方寸服务器及本机 WebView 存储中，用于登录、同步与展示。\n\n"
            + "只有在你主动开启相应功能后，方寸才会申请通知、日历读写以及闹钟与提醒权限。日历权限用于与 Android 系统日历同步；通知和闹钟权限用于按你的设置发送提醒。拒绝可选权限不会影响其他基础功能。\n\n"
            + "连接 Outlook 或 Google 日历时，将由对应平台显示授权页面；方寸仅在你授权后处理完成同步所需的日历数据和令牌。方寸不含广告 SDK，不出售个人信息。\n\n"
            + "你可以在应用内查看、更正和导出数据，也可以断开第三方日历、撤销订阅或永久注销普通账号。完整的保存期限、安全措施、开发者与联系方式以《方寸隐私政策》为准。";
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("方寸隐私政策")
            .setMessage(message)
            .setCancelable(false)
            .setPositiveButton("同意并继续", (ignored, which) -> {
                getPreferences(MODE_PRIVATE).edit().putBoolean(PRIVACY_CONSENT_KEY, true).apply();
                startWebApp();
            })
            .setNegativeButton("拒绝并退出", (ignored, which) -> finishAndRemoveTask())
            .setNeutralButton("查看完整政策", null)
            .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view ->
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL + "privacy.html")))
        ));
        dialog.show();
    }

    private void configureEdgeToEdgeWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = window.getAttributes();
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attributes);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSaveFormData(false);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " FangcunAndroid/1.0");
        webView.addJavascriptInterface(new NativeBridge(), "FangcunNative");
        // WebChromeClient also provides the JavaScript confirm/prompt dialogs used by sync.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                try {
                    Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    picker.addCategory(Intent.CATEGORY_OPENABLE);
                    picker.setType("*/*");
                    picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivityForResult(picker, OPEN_DOCUMENT_REQUEST);
                } catch (Exception error) {
                    fileChooserCallback.onReceiveValue(null);
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器，请检查系统文件应用", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                if (!safeInsetsScript.isEmpty()) view.evaluateJavascript(safeInsetsScript, null);
                view.setVisibility(View.VISIBLE);
                loadingView.setVisibility(View.GONE);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
    }

    public final class NativeBridge {
        @JavascriptInterface
        public void calendarRequest(String requestId, String operation, String payload) {
            if (requestId == null || !requestId.matches("[a-zA-Z0-9-]{1,80}") || payload == null || payload.length() > 1048576) return;
            if (!"read".equals(operation) && !"sync".equals(operation)) return;
            fileWorker.execute(() -> {
                String result;
                try { result = "read".equals(operation) ? systemCalendar.read(payload) : systemCalendar.sync(payload); }
                catch (Exception error) { result = "{\"error\":\"系统日历暂不可用，请重试\"}"; }
                final String response = result;
                webView.post(() -> webView.evaluateJavascript("window.FangcunCalendarResult&&window.FangcunCalendarResult(" + JSONObject.quote(requestId) + "," + JSONObject.quote(response) + ")", null));
            });
        }

        @JavascriptInterface
        public void saveDocument(String filename, String mimeType, String content) {
            if (content == null || content.length() > 4 * 1024 * 1024 || filename == null) {
                notifyDocumentSaved("备份过大，无法保存");
                return;
            }
            runOnUiThread(() -> {
                if (pendingExport != null) { notifyDocumentSaved("请先完成或取消正在进行的文件保存"); return; }
                pendingExport = content.getBytes(StandardCharsets.UTF_8);
                Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("text/calendar".equals(mimeType) ? "text/calendar" : "application/json");
                picker.putExtra(Intent.EXTRA_TITLE, filename.replaceAll("[\\\\/\\r\\n]", "_").substring(0, Math.min(filename.length(), 120)));
                try { startActivityForResult(picker, SAVE_DOCUMENT_REQUEST); }
                catch (Exception error) { pendingExport = null; notifyDocumentSaved("无法打开保存窗口，请检查系统文件应用"); }
            });
        }

        @JavascriptInterface
        public void syncReminders(String payload) {
            if (payload == null || payload.length() > 262144) return;
            ReminderScheduler.replaceAll(getApplicationContext(), payload);
        }

        @JavascriptInterface
        public void requestReminderPermissions() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
                } else openExactAlarmSettingsIfNeeded();
            });
        }

        @JavascriptInterface
        public void requestCalendarPermissions() {
            runOnUiThread(() -> {
                if (!systemCalendar.hasPermission()) {
                    requestPermissions(new String[]{Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR}, CALENDAR_PERMISSION_REQUEST);
                } else notifyCalendarPermission(true);
            });
        }

        @JavascriptInterface
        public String readSystemCalendar(String account) {
            return systemCalendar.read(account);
        }

        @JavascriptInterface
        public String syncSystemCalendar(String payload) {
            if (payload == null || payload.length() > 1048576) return "{\"error\":\"同步内容过大\"}";
            return systemCalendar.sync(payload);
        }

        @JavascriptInterface
        public void openSystemCalendar() {
            runOnUiThread(() -> {
                Uri uri = CalendarContract.CONTENT_URI.buildUpon().appendPath("time").appendPath(String.valueOf(System.currentTimeMillis())).build();
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            });
        }

        @JavascriptInterface
        public void openExternal(String value) {
            if (value == null || value.length() > 4096) { notifyExternalOpened("授权地址无效，请重试连接"); return; }
            Uri uri = Uri.parse(value);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || !(host.equals("login.microsoftonline.com") || host.endsWith(".microsoftonline.com") || host.equals("accounts.google.com"))) { notifyExternalOpened("授权地址未通过安全检查，请检查日历配置"); return; }
            runOnUiThread(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); notifyExternalOpened(""); }
                catch (Exception error) { notifyExternalOpened("无法打开浏览器，请先安装或启用系统浏览器后重试"); }
            });
        }
    }

    private void notifyExternalOpened(String error) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(
            "window.FangcunExternalOpened&&window.FangcunExternalOpened(" + JSONObject.quote(error) + ")", null));
    }

    private void openExactAlarmSettingsIfNeeded() {
        if (Build.VERSION.SDK_INT < 31) return;
        AlarmManager manager = getSystemService(AlarmManager.class);
        if (manager != null && !manager.canScheduleExactAlarms()) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        }
    }

    private void notifyDocumentSaved(String error) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(
            "window.FangcunDocumentSaved&&window.FangcunDocumentSaved(" + JSONObject.quote(error) + ")", null));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (requestCode == OPEN_DOCUMENT_REQUEST) {
            if (fileChooserCallback != null) {
                Uri uri = resultCode == RESULT_OK && result != null ? result.getData() : null;
                // Accept only a user-granted document URI, never file:// or a remote URL.
                fileChooserCallback.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
                fileChooserCallback = null;
            }
        } else if (requestCode == SAVE_DOCUMENT_REQUEST) {
            final byte[] bytes = pendingExport;
            pendingExport = null;
            final Uri uri = resultCode == RESULT_OK && result != null ? result.getData() : null;
            if (uri == null || bytes == null) { notifyDocumentSaved("已取消保存"); return; }
            if (!"content".equals(uri.getScheme())) { notifyDocumentSaved("请选择系统文件应用中的保存位置"); return; }
            fileWorker.execute(() -> {
                try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
                    if (stream == null) throw new java.io.IOException("No output stream");
                    stream.write(bytes);
                } catch (Exception error) { notifyDocumentSaved("文件未保存成功，请重新选择保存位置"); return; }
                notifyDocumentSaved("");
            });
        }
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) { fileChooserCallback.onReceiveValue(null); fileChooserCallback = null; }
        fileWorker.shutdown();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) openExactAlarmSettingsIfNeeded();
        if (requestCode == CALENDAR_PERMISSION_REQUEST) notifyCalendarPermission(systemCalendar.hasPermission());
    }

    private void notifyCalendarPermission(boolean granted) {
        if (webView == null) return;
        webView.post(() -> webView.evaluateJavascript("window.FangcunNativeCalendarPermission&&window.FangcunNativeCalendarPermission(" + granted + ")", null));
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!hasPrivacyConsent()) return;
        ReminderScheduler.rescheduleStored(this);
        if (webView != null) webView.postDelayed(() -> webView.evaluateJavascript("window.FangcunNativeCalendarResume&&window.FangcunNativeCalendarResume()", null), 250);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (!hasPrivacyConsent()) { showPrivacyConsent(); return; }
        String query = integrationReturnQuery(intent);
        if (!query.isEmpty() && webView != null) webView.loadUrl(APP_URL + query);
    }

    private String integrationReturnQuery(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"fangcun".equalsIgnoreCase(data.getScheme())) return "";
        if ("outlook-connected".equalsIgnoreCase(data.getHost())) return "?outlook=connected";
        if ("google-connected".equalsIgnoreCase(data.getHost())) return "?google=connected";
        return "";
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }
}
