package com.zara.companion;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.UUID;

/**
 * ZARA V1.1 — Boot receiver (Directive §20/§21).
 *
 * AlarmManager alarms do NOT survive a device reboot. This receiver runs on
 * BOOT_COMPLETED, reads the persisted reminder list written by
 * ZaraActionsPlugin.createReminder, and reschedules every reminder that is
 * still in the future. Past reminders are dropped.
 *
 * Only reminder alarms are restored — the companion itself never silently
 * auto-starts (§24 consent; the user launches the app).
 */
public class ZaraBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            return;
        }
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        SharedPreferences prefs = context.getSharedPreferences(
                ZaraReminderStore.PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(ZaraReminderStore.KEY_REMINDERS, "[]");
        long now = System.currentTimeMillis();
        JSONArray kept = new JSONArray();
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject r = arr.getJSONObject(i);
                long epochMs = r.optLong("epochMs", 0);
                String content = r.optString("content", "");
                String id = r.optString("id", UUID.randomUUID().toString().substring(0, 8));
                if (epochMs > now && !content.isEmpty()) {
                    // Reschedule with the same semantics as the original call.
                    PendingIntent pi = ZaraReminderStore.pendingIntent(context, id, content);
                    try {
                        if (Build.VERSION.SDK_INT >= 31 && am.canScheduleExactAlarms()) {
                            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epochMs, pi);
                        } else {
                            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epochMs, pi);
                        }
                    } catch (SecurityException e) {
                        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epochMs, pi);
                    }
                    kept.put(r); // still future — keep for next reboot
                }
                // past reminders intentionally dropped
            }
        } catch (Exception ignored) { }
        prefs.edit().putString(ZaraReminderStore.KEY_REMINDERS, kept.toString()).apply();
    }
}
