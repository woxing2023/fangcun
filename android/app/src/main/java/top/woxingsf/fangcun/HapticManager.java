package top.woxingsf.fangcun;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

public final class HapticManager {
    private final Vibrator vibrator;

    public HapticManager(Context context) {
        vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    public void play(String semantic) {
        if (vibrator == null || !vibrator.hasVibrator()) return;
        String value = semantic == null ? "light" : semantic;
        long[] pattern;
        switch (value) {
            case "success": pattern = new long[]{0, 28, 44, 52}; break;
            case "confirm": pattern = new long[]{0, 24}; break;
            case "error": pattern = new long[]{0, 70, 40, 70}; break;
            case "snap": pattern = new long[]{0, 16}; break;
            case "start": pattern = new long[]{0, 20, 30, 36}; break;
            default: pattern = new long[]{0, 12}; break;
        }
        if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
        else vibrator.vibrate(pattern, -1);
    }
}
