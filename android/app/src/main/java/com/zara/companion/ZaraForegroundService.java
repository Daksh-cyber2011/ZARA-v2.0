package com.zara.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * ZARA V1.1 — Companion foreground service (Directive §21).
 *
 * OPT-IN ONLY (Settings › Keep ZARA alive in background). Keeps the app
 * process alive while Android permits it so the companion's event loop,
 * memory and proactive engine keep running when the app is backgrounded.
 *
 * Honest limits, by design (§21 "do not claim always-running"):
 *  - This does NOT defeat Doze: AlarmManager reminders still fire, but
 *    network/LLM calls may be deferred by the OS.
 *  - Android may still stop the service under memory pressure; the user is
 *    told this in the settings UI.
 *  - A visible, silent, low-importance notification is REQUIRED by Android
 *    and doubles as the honest "ZARA is running" indicator (§24).
 */
public class ZaraForegroundService extends Service {

    public static final String CHANNEL_ID = "zara_companion";
    private static final int NOTIFICATION_ID = 4201;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_STICKY; // restart if killed, while the user keeps it on
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // started service, not bound
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager)
                    getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "ZARA Companion",
                        NotificationManager.IMPORTANCE_LOW); // silent, visible
                ch.setDescription("Shows while ZARA stays active in the background");
                nm.createNotificationChannel(ch);
            }
        }
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("ZARA is active")
                .setContentText("Your companion is running in the background")
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }
}
