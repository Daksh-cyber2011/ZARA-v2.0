package com.zara.companion;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * ZARA V1.0 — Reminder receiver: fires the AlarmManager alarm and posts the
 * notification the user asked for. Time-critical reminders are the one
 * proactive path allowed to interrupt (Directive §5-6).
 */
public class ZaraReminderReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String reminderId = intent.getStringExtra("reminderId");
        String content = intent.getStringExtra("content");
        if (content == null || content.isEmpty()) return;

        Intent openApp = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent pi = PendingIntent.getActivity(
            context, reminderId != null ? reminderId.hashCode() : 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= 26) {
            builder = new Notification.Builder(context, ZaraActionsPlugin.CHANNEL_ID_REMINDERS);
        } else {
            builder = new Notification.Builder(context);
        }
        builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("ZARA reminder")
            .setContentText(content)
            .setAutoCancel(true)
            .setContentIntent(pi);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify(reminderId != null ? reminderId.hashCode() : (int) System.currentTimeMillis(),
                    builder.build());
            } catch (SecurityException e) {
                // POST_NOTIFICATIONS not granted on 13+ — the alarm still fired
                // (this receiver ran); notification display is not permitted.
            }
        }
    }
}
