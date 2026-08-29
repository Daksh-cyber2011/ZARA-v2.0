package com.zara.companion;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * ZARA V1.1 — Reminder persistence (Directive §20/§21).
 *
 * AlarmManager alarms die at reboot; a small JSON list in SharedPreferences
 * survives. ZaraActionsPlugin writes here when a reminder is created;
 * ZaraBootReceiver reschedules from here after a reboot.
 */
public final class ZaraReminderStore {

    public static final String PREFS_NAME = "zara_reminders";
    public static final String KEY_REMINDERS = "reminders";

    private ZaraReminderStore() { }

    public static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /** The alarm PendingIntent for one reminder (same extras as creation). */
    public static PendingIntent pendingIntent(Context ctx, String reminderId, String content) {
        Intent intent = new Intent(ctx, ZaraReminderReceiver.class);
        intent.putExtra("reminderId", reminderId);
        intent.putExtra("content", content);
        return PendingIntent.getBroadcast(
                ctx, reminderId.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Persist one reminder for reboot recovery. */
    public static void add(Context ctx, String reminderId, long epochMs, String content) {
        try {
            JSONArray arr = stored(ctx);
            JSONObject r = new JSONObject();
            r.put("id", reminderId);
            r.put("epochMs", epochMs);
            r.put("content", content);
            arr.put(r);
            prefs(ctx).edit().putString(KEY_REMINDERS, arr.toString()).apply();
        } catch (Exception ignored) { }
    }

    private static JSONArray stored(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_REMINDERS, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }
}
