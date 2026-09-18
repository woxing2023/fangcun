package top.woxingsf.fangcun;

import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** In-app floating developer console. It is only attached by the Debug build. */
public final class DeveloperOverlayView extends FrameLayout {
    private static final int BG = Color.rgb(17, 25, 31);
    private static final int PANEL = Color.rgb(25, 35, 42);
    private static final int TEXT = Color.rgb(232, 246, 242);
    private static final int MUTED = Color.rgb(157, 183, 177);
    private static final int CYAN = Color.rgb(125, 224, 210);
    private static final int AMBER = Color.rgb(255, 201, 122);
    private final HyperOSNativeModule nativeModule;
    private final TextView status;
    private final TextView eventLog;
    private final TextView bubble;
    private final LinearLayout panel;
    private float downX;
    private float downY;
    private float startX;
    private float startY;
    private boolean moved;

    public DeveloperOverlayView(Context context, HyperOSNativeModule nativeModule) {
        super(context);
        this.nativeModule = nativeModule;
        setClipChildren(false);
        setClickable(false);

        bubble = label(context, "DEV", 12, CYAN);
        bubble.setGravity(Gravity.CENTER);
        bubble.setTypeface(null, android.graphics.Typeface.BOLD);
        bubble.setContentDescription("打开方寸开发者模式");
        bubble.setBackground(round(BG, 18));
        bubble.setElevation(dp(12));
        LayoutParams bubbleParams = new LayoutParams(dp(58), dp(48), Gravity.TOP | Gravity.END);
        bubbleParams.setMargins(0, dp(24), dp(14), 0);
        addView(bubble, bubbleParams);

        panel = new LinearLayout(context);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(14), dp(13), dp(14), dp(13));
        panel.setBackground(round(BG, 22));
        panel.setElevation(dp(18));
        panel.setVisibility(GONE);
        LayoutParams panelParams = new LayoutParams(dp(322), dp(470), Gravity.TOP | Gravity.END);
        panelParams.setMargins(0, dp(16), dp(12), 0);
        addView(panel, panelParams);

        LinearLayout titleRow = new LinearLayout(context);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = label(context, "开发者模式", 17, TEXT);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        titleRow.addView(title, new LinearLayout.LayoutParams(0, dp(30), 1));
        TextView close = label(context, "收起", 12, CYAN);
        close.setGravity(Gravity.CENTER);
        close.setPadding(dp(8), 0, dp(4), 0);
        close.setOnClickListener(view -> setExpanded(false));
        titleRow.addView(close, new LinearLayout.LayoutParams(dp(48), dp(30)));
        panel.addView(titleRow);

        TextView subtitle = label(context, "只在 Debug 包显示 · 事件会写入 NativeSnapshot", 11, MUTED);
        subtitle.setPadding(0, 0, 0, dp(10));
        panel.addView(subtitle);

        status = label(context, "就绪 · 回退通知预览", 12, AMBER);
        status.setPadding(dp(10), dp(9), dp(10), dp(9));
        status.setBackground(round(PANEL, 12));
        panel.addView(status, new LinearLayout.LayoutParams(-1, dp(38)));

        ScrollView scroll = new ScrollView(context);
        scroll.setFillViewport(true);
        LinearLayout content = new LinearLayout(context);
        content.setOrientation(LinearLayout.VERTICAL);
        addSection(content, "超级岛场景");
        addButtonRow(content, button(context, "Focus 开始", "focus.start"), button(context, "Focus 暂停", "focus.pause"));
        addButtonRow(content, button(context, "Focus 完成", "focus.complete"), button(context, "课程开始", "course.start"));
        addButtonRow(content, button(context, "DDL 提醒", "ddl.remind"), button(context, "清除事件", "clear"));
        addSection(content, "语义触感");
        addButtonRow(content, hapticButton(context, "Light", "light"), hapticButton(context, "Snap", "snap"));
        addButtonRow(content, hapticButton(context, "Confirm", "confirm"), hapticButton(context, "Success", "success"));
        addSection(content, "能力与快照");
        Button inspect = plainButton(context, "查看设备能力");
        inspect.setOnClickListener(view -> showCapabilities());
        content.addView(inspect, rowParams());
        eventLog = label(context, "尚未触发事件", 11, MUTED);
        eventLog.setPadding(dp(10), dp(10), dp(10), dp(10));
        eventLog.setBackground(round(PANEL, 12));
        content.addView(eventLog, rowParams());
        scroll.addView(content);
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(-1, 0, 1);
        scrollParams.topMargin = dp(8);
        panel.addView(scroll, scrollParams);

        bubble.setOnTouchListener(this::onBubbleTouch);
        bubble.setOnClickListener(view -> setExpanded(true));
    }

    private Button button(Context context, String text, String event) {
        Button button = plainButton(context, text);
        button.setOnClickListener(view -> trigger(event));
        return button;
    }

    private Button hapticButton(Context context, String text, String semantic) {
        Button button = plainButton(context, text);
        button.setOnClickListener(view -> {
            nativeModule.haptic(semantic);
            status.setText("已触发触感 · " + text);
            appendLog("haptic." + semantic);
        });
        return button;
    }

    private void trigger(String event) {
        if ("clear".equals(event)) {
            nativeModule.clearEvent();
            status.setText("已清除 · 超级岛回退通知");
            appendLog("clear");
            return;
        }
        JSONObject payload = new JSONObject();
        try {
            payload.put("title", "focus.start".equals(event) || "focus.pause".equals(event) || "focus.complete".equals(event) ? "C++训练" : "course.start".equals(event) ? "大学物理实验" : "实验报告");
            payload.put("progress", "43 / 60 min");
            payload.put("time", "14:30 - 16:30");
            payload.put("due", "今天 23:59");
        } catch (Exception ignored) {}
        nativeModule.triggerEvent(event, payload);
        status.setText("已触发 · " + event + " · 回退通知已更新");
        appendLog(event);
    }

    private void showCapabilities() {
        JSONObject capabilities = nativeModule.capabilities();
        status.setText(capabilities.optBoolean("hyperOsCandidate") ? "小米设备候选 · 超级岛接口待适配" : "普通 Android · 使用通知回退");
        eventLog.setText(capabilities.toString());
    }

    private void appendLog(String event) {
        String time = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date());
        eventLog.setText(time + "  " + event + "\n" + eventLog.getText());
    }

    private void addSection(LinearLayout parent, String text) {
        TextView section = label(getContext(), text, 11, MUTED);
        section.setPadding(dp(2), dp(12), 0, dp(4));
        parent.addView(section, new LinearLayout.LayoutParams(-1, dp(30)));
    }

    private void addButtonRow(LinearLayout parent, Button left, Button right) {
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.addView(left, new LinearLayout.LayoutParams(0, dp(42), 1));
        LinearLayout.LayoutParams rightParams = new LinearLayout.LayoutParams(0, dp(42), 1);
        rightParams.leftMargin = dp(7);
        row.addView(right, rightParams);
        parent.addView(row);
    }

    private Button plainButton(Context context, String text) {
        Button button = new Button(context);
        button.setText(text);
        button.setTextColor(TEXT);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setMinHeight(0);
        button.setMinWidth(0);
        button.setPadding(dp(4), 0, dp(4), 0);
        button.setBackground(round(PANEL, 11));
        return button;
    }

    private boolean onBubbleTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = event.getRawX(); downY = event.getRawY();
                startX = view.getTranslationX(); startY = view.getTranslationY(); moved = false;
                return true;
            case MotionEvent.ACTION_MOVE:
                float dx = event.getRawX() - downX; float dy = event.getRawY() - downY;
                if (Math.abs(dx) + Math.abs(dy) > dp(6)) moved = true;
                view.setTranslationX(startX + dx); view.setTranslationY(startY + dy);
                return true;
            case MotionEvent.ACTION_UP:
                if (!moved) setExpanded(true);
                view.performClick();
                return true;
            default: return true;
        }
    }

    private void setExpanded(boolean expanded) {
        panel.setVisibility(expanded ? VISIBLE : GONE);
        bubble.setVisibility(expanded ? GONE : VISIBLE);
        setClickable(expanded);
    }

    private static TextView label(Context context, String text, float size, int color) {
        TextView view = new TextView(context);
        view.setText(text); view.setTextSize(size); view.setTextColor(color);
        return view;
    }

    private GradientDrawable round(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color); drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private LinearLayout.LayoutParams rowParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(7); return params;
    }

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density + 0.5f); }
}
