package com.zara.companion;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;
import java.util.UUID;

/**
 * ZARA V1.0 — ZaraActions native plugin (typed Android intents).
 *
 * Every method is a SPECIFIC, typed action. There is deliberately NO generic
 * exec/shell/run method: the LLM can never invoke arbitrary native code
 * (Directive §17). Every method returns an honest result with verified
 * details (§19) — or a precise failure.
 */
@CapacitorPlugin(name = "ZaraActions")
public class ZaraActionsPlugin extends Plugin {

    public static final String CHANNEL_ID_REMINDERS = "zara_reminders";

    /* ------------------------------ utilities ------------------------------ */

    private interface ActionRunner {
        void run() throws Exception;
    }

    /** Run an intent-sending action; catch and translate failures honestly. */
    private JSObject launch(String what, ActionRunner runner) {
        JSObject ret = new JSObject();
        try {
            runner.run();
            ret.put("ok", true);
            ret.put("summary", what);
            return ret;
        } catch (ActivityNotFoundException e) {
            ret.put("ok", false);
            ret.put("summary", "No app is available on this tablet to handle that.");
            JSObject err = new JSObject();
            err.put("code", "NO_HANDLER");
            err.put("message", "No activity found: " + e.getMessage());
            err.put("retryable", false);
            ret.put("error", err);
            return ret;
        } catch (SecurityException e) {
            ret.put("ok", false);
            ret.put("summary", "Android blocked that action for security reasons.");
            JSObject err = new JSObject();
            err.put("code", "PERMISSION_DENIED");
            err.put("message", String.valueOf(e.getMessage()));
            err.put("retryable", false);
            ret.put("error", err);
            return ret;
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("summary", "That action failed: " + e.getMessage());
            JSObject err = new JSObject();
            err.put("code", "ACTION_FAILED");
            err.put("message", String.valueOf(e.getMessage()));
            err.put("retryable", true);
            ret.put("error", err);
            return ret;
        }
    }

    private void send(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    /* ---------------------------- applications ----------------------------- */

    /**
     * Resolve an app by human name against all launchable apps
     * (MAIN/LAUNCHER query — package visibility granted via <queries>).
     */
    private String resolvePackage(String query) {
        PackageManager pm = getContext().getPackageManager();
        String q = query.trim().toLowerCase();

        // 1. Direct package name form (com.example.app)
        try {
            ApplicationInfo info = pm.getApplicationInfo(query, 0);
            if (info != null) return query;
        } catch (PackageManager.NameNotFoundException ignored) { }

        // 2. Label match across all launchable apps
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
        String best = null;
        for (ResolveInfo ri : apps) {
            String label = String.valueOf(ri.loadLabel(pm)).toLowerCase();
            if (label.equals(q)) return ri.activityInfo.packageName; // exact wins
            if (best == null && (label.contains(q) || q.contains(label))) {
                best = ri.activityInfo.packageName;
            }
        }
        return best;
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) {
            call.reject("query required"); return;
        }
        String pkg = resolvePackage(query);
        if (pkg == null) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("summary", "I couldn't find an app called \"" + query + "\" on this tablet.");
            JSObject err = new JSObject();
            err.put("code", "APP_NOT_FOUND");
            err.put("message", "no launchable app matched: " + query);
            err.put("retryable", false);
            ret.put("error", err);
            call.resolve(ret);
            return;
        }
        String finalPkg = pkg;
        JSObject result = launch("Opened " + query + ".", () -> {
            Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(finalPkg);
            if (intent == null) throw new ActivityNotFoundException("no launch intent for " + finalPkg);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        });
        JSObject data = new JSObject();
        data.put("package", pkg);
        result.put("data", data);
        call.resolve(result);
    }

    /* --------------------------------- web --------------------------------- */

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) { call.reject("url required"); return; }
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
        final String finalUrl = url;
        call.resolve(launch("Opened " + finalUrl + " in the browser.", () -> {
            send(new Intent(Intent.ACTION_VIEW, Uri.parse(finalUrl)));
        }));
    }

    @PluginMethod
    public void webSearch(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) { call.reject("query required"); return; }
        final Uri uri = Uri.parse("https://www.google.com/search?q=" + Uri.encode(query));
        call.resolve(launch("Searching the web for \"" + query + "\".", () -> {
            send(new Intent(Intent.ACTION_VIEW, uri));
        }));
    }

    @PluginMethod
    public void youtubeSearch(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) { call.reject("query required"); return; }
        final Uri uri = Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(query));
        call.resolve(launch("Searching YouTube for \"" + query + "\".", () -> {
            send(new Intent(Intent.ACTION_VIEW, uri));
        }));
    }

    /* -------------------------------- device ------------------------------- */

    @PluginMethod
    public void setBrightness(PluginCall call) {
        String mode = call.getString("mode", "up");
        JSObject ret = new JSObject();
        try {
            android.provider.Settings.System.putInt(
                getContext().getContentResolver(),
                android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE,
                android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            int current = android.provider.Settings.System.getInt(
                getContext().getContentResolver(),
                android.provider.Settings.System.SCREEN_BRIGHTNESS, 128);
            int next;
            switch (mode) {
                case "up": next = Math.min(255, current + 51); break;
                case "down": next = Math.max(1, current - 51); break;
                case "min": next = 1; break;
                case "max": next = 255; break;
                default: call.reject("invalid mode"); return;
            }
            android.provider.Settings.System.putInt(
                getContext().getContentResolver(),
                android.provider.Settings.System.SCREEN_BRIGHTNESS, next);
            ret.put("ok", true);
            ret.put("summary", "Brightness set to " + Math.round(next / 2.55f) + "%.");
            JSObject data = new JSObject();
            data.put("level", Math.round(next / 2.55f));
            ret.put("data", data);
        } catch (SecurityException e) {
            // WRITE_SETTINGS special access missing — honest report + panel.
            ret.put("ok", false);
            ret.put("summary", "I can't change brightness without the \"modify system settings\" permission — opening display settings so you can adjust it manually.");
            JSObject err = new JSObject();
            err.put("code", "PERMISSION_DENIED");
            err.put("message", "WRITE_SETTINGS not granted");
            err.put("retryable", false);
            ret.put("error", err);
            try { send(new Intent(Settings.ACTION_DISPLAY_SETTINGS)); } catch (Exception ignored) { }
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("summary", "Brightness change failed: " + e.getMessage());
            JSObject err = new JSObject();
            err.put("code", "ACTION_FAILED");
            err.put("message", String.valueOf(e.getMessage()));
            err.put("retryable", true);
            ret.put("error", err);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        String mode = call.getString("mode", "up");
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) { call.reject("no audio service"); return; }
        switch (mode) {
            case "up": am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI); break;
            case "down": am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI); break;
            case "mute": am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI); break;
            case "unmute": am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI); break;
            default: call.reject("invalid mode"); return;
        }
        JSObject ret = new JSObject();
        int vol = am.getStreamVolume(AudioManager.STREAM_MUSIC);
        int max = am.getStreamVolume(AudioManager.STREAM_MUSIC) > 0 ? am.getStreamVolume(AudioManager.STREAM_MUSIC) : 1;
        ret.put("ok", true);
        ret.put("summary", "Media volume is now " + vol + ".");
        JSObject data = new JSObject();
        data.put("volume", vol);
        ret.put("data", data);
        call.resolve(ret);
    }

    @PluginMethod
    public void toggleFlashlight(PluginCall call) {
        Boolean on = call.getBoolean("on");
        if (on == null) { call.reject("on required"); return; }
        JSObject ret = new JSObject();
        try {
            android.hardware.camera2.CameraManager cm =
                (android.hardware.camera2.CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
            if (cm == null) throw new IllegalStateException("no camera service");
            String cameraId = null;
            for (String id : cm.getCameraIdList()) {
                Boolean available = cm.getCameraCharacteristics(id).get(
                        android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(available)) { cameraId = id; break; }
            }
            if (cameraId == null) throw new IllegalStateException("no flash hardware");
            cm.setTorchMode(cameraId, on);
            ret.put("ok", true);
            ret.put("summary", on ? "Flashlight on." : "Flashlight off.");
            JSObject data = new JSObject();
            data.put("on", on);
            ret.put("data", data);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("summary", "I couldn't toggle the flashlight: " + e.getMessage());
            JSObject err = new JSObject();
            err.put("code", "ACTION_FAILED");
            err.put("message", String.valueOf(e.getMessage()));
            err.put("retryable", false);
            ret.put("error", err);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String panel = call.getString("panel", "main");
        final Intent intent;
        switch (panel) {
            case "wifi": intent = new Intent(Settings.ACTION_WIFI_SETTINGS); break;
            case "bluetooth": intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS); break;
            case "display": intent = new Intent(Settings.ACTION_DISPLAY_SETTINGS); break;
            case "sound": intent = new Intent(Settings.ACTION_SOUND_SETTINGS); break;
            case "battery": intent = new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS); break;
            case "apps": intent = new Intent(Settings.ACTION_APPLICATION_SETTINGS); break;
            case "location": intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS); break;
            default: intent = new Intent(Settings.ACTION_SETTINGS); break;
        }
        call.resolve(launch("Opened " + panel + " settings.", () -> send(intent)));
    }

    @PluginMethod
    public void batteryInfo(PluginCall call) {
        Intent battery = getContext().registerReceiver(null,
            new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        JSObject ret = new JSObject();
        int level = -1, scale = 100;
        boolean charging = false;
        if (battery != null) {
            level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            charging = status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL;
        }
        if (level >= 0) {
            float pct = level * 100f / scale;
            ret.put("ok", true);
            ret.put("summary", "Battery is at " + Math.round(pct) + "%" + (charging ? ", charging." : "."));
            JSObject data = new JSObject();
            data.put("level", pct / 100f);
            data.put("charging", charging);
            ret.put("data", data);
        } else {
            ret.put("ok", false);
            ret.put("summary", "I couldn't read the battery state.");
            JSObject err = new JSObject();
            err.put("code", "SENSOR_UNAVAILABLE");
            err.put("message", "battery status unavailable");
            err.put("retryable", true);
            ret.put("error", err);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject ret = new JSObject();
        JSObject data = new JSObject();
        data.put("model", Build.MODEL);
        data.put("manufacturer", Build.MANUFACTURER);
        data.put("androidVersion", Build.VERSION.RELEASE);
        data.put("sdk", Build.VERSION.SDK_INT);
        ret.put("ok", true);
        ret.put("summary", Build.MODEL + " running Android " + Build.VERSION.RELEASE + ".");
        ret.put("data", data);
        call.resolve(ret);
    }

    /* --------------------------- reminders / alarms ------------------------- */

    @PluginMethod
    public void createReminder(PluginCall call) {
        Long epochMs = call.getLong("epochMs");
        String content = call.getString("content");
        if (epochMs == null || content == null || content.trim().isEmpty()) {
            call.reject("epochMs and content required"); return;
        }
        Context ctx = getContext();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) { call.reject("no alarm service"); return; }

        ensureReminderChannel();

        String reminderId = UUID.randomUUID().toString().substring(0, 8);
        Intent intent = new Intent(ctx, ZaraReminderReceiver.class);
        intent.putExtra("reminderId", reminderId);
        intent.putExtra("content", content.trim());
        PendingIntent pi = PendingIntent.getBroadcast(
            ctx, reminderId.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // §20/§21: persist for reboot recovery — ZaraBootReceiver reschedules.
        ZaraReminderStore.add(ctx, reminderId, epochMs, content.trim());

        // Exact when allowed; honest degradation to inexact otherwise (§28).
        boolean exact = false;
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epochMs, pi);
                    exact = true;
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epochMs, pi);
                }
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epochMs, pi);
                exact = true;
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epochMs, pi);
        }

        JSObject ret = new JSObject();
        ret.put("ok", true);
        String when = java.text.DateFormat.getDateTimeInstance(
            java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT)
            .format(new java.util.Date(epochMs));
        ret.put("summary", "Reminder set for " + when + ": " + content.trim()
            + (exact ? "" : " (approximate timing — exact alarms permission not granted)."));
        JSObject data = new JSObject();
        data.put("reminderId", reminderId);
        data.put("exact", exact);
        data.put("triggerAt", epochMs);
        ret.put("data", data);
        call.resolve(ret);
    }

    private void ensureReminderChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getContext()
                .getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID_REMINDERS) == null) {
                NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID_REMINDERS, "ZARA Reminders",
                    NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Reminders you asked ZARA to set");
                nm.createNotificationChannel(ch);
            }
        }
    }

    @PluginMethod
    public void createAlarm(PluginCall call) {
        Integer hour = call.getInt("hour");
        Integer minute = call.getInt("minute", 0);
        String label = call.getString("label", "ZARA alarm");
        if (hour == null || hour < 0 || hour > 23 || minute == null || minute < 0 || minute > 59) {
            call.reject("valid hour (0-23) and minute (0-59) required"); return;
        }
        call.resolve(launch("Alarm set for " + String.format("%02d:%02d", hour, minute) + ".", () -> {
            Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minute)
                .putExtra(AlarmClock.EXTRA_MESSAGE, label)
                .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }));
    }

    @PluginMethod
    public void createCalendarEvent(PluginCall call) {
        String title = call.getString("title");
        Long start = call.getLong("startEpochMs");
        Long end = call.getLong("endEpochMs");
        String location = call.getString("location");
        if (title == null || start == null) { call.reject("title and startEpochMs required"); return; }
        long endMs = end != null ? end : start + 3600000L;
        call.resolve(launch("Calendar event draft created for " + title + ".", () -> {
            Intent intent = new Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs)
                .putExtra(CalendarContract.Events.TITLE, title)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (location != null) intent.putExtra(CalendarContract.Events.EVENT_LOCATION, location);
            getContext().startActivity(intent);
        }));
    }

    /* --------------------------------- media -------------------------------- */

    @PluginMethod
    public void playMedia(PluginCall call) {
        String action = call.getString("action", "play");
        int keyCode;
        switch (action) {
            case "play": keyCode = KeyEvent.KEYCODE_MEDIA_PLAY; break;
            case "pause": keyCode = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
            case "next": keyCode = KeyEvent.KEYCODE_MEDIA_NEXT; break;
            case "previous": keyCode = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
            default: call.reject("invalid action"); return;
        }
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) { call.reject("no audio service"); return; }
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("summary", "Sent \"" + action + "\" to the current media player.");
        JSObject data = new JSObject();
        data.put("action", action);
        ret.put("data", data);
        call.resolve(ret);
    }

    /* ----------------------------- communication ---------------------------- */

    @PluginMethod
    public void callContact(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) { call.reject("query required"); return; }
        final Uri uri = Uri.parse("tel:" + Uri.encode(query.trim()));
        call.resolve(launch("Opened the dialer with " + query + " — press call when ready.", () -> {
            send(new Intent(Intent.ACTION_DIAL, uri));
        }));
    }

    @PluginMethod
    public void smsDraft(PluginCall call) {
        String query = call.getString("query");
        String message = call.getString("message");
        if (query == null || message == null) { call.reject("query and message required"); return; }
        final Uri uri = Uri.parse("smsto:" + Uri.encode(query.trim()));
        final String body = message;
        call.resolve(launch("Message to " + query + " is drafted and ready to send.", () -> {
            Intent intent = new Intent(Intent.ACTION_SENDTO, uri);
            intent.putExtra("sms_body", body);
            send(intent);
        }));
    }

    /* ------------------------------ camera / maps --------------------------- */

    @PluginMethod
    public void launchCamera(PluginCall call) {
        call.resolve(launch("Camera opened.", () -> {
            send(new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA));
        }));
    }

    @PluginMethod
    public void launchGallery(PluginCall call) {
        call.resolve(launch("Gallery opened.", () -> {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setType("image/*");
            send(intent);
        }));
    }

    @PluginMethod
    public void openMaps(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) { call.reject("query required"); return; }
        final Uri uri = Uri.parse("geo:0,0?q=" + Uri.encode(query.trim()));
        call.resolve(launch("Opened maps for \"" + query + "\".", () -> {
            send(new Intent(Intent.ACTION_VIEW, uri));
        }));
    }

    /* --------------------- §21 companion keep-alive ------------------------ */

    /**
     * Start the opt-in foreground service so the companion keeps running
     * while backgrounded (user toggled "Keep ZARA alive in background").
     */
    @PluginMethod
    public void startCompanionService(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Intent intent = new Intent(getContext(), ZaraForegroundService.class);
            if (Build.VERSION.SDK_INT >= 26) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            ret.put("ok", true);
            ret.put("summary", "Companion is now kept alive in the background (visible notification).");
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("summary", "Could not start the background companion service: " + e.getMessage());
            JSObject err = new JSObject();
            err.put("code", "ACTION_FAILED");
            err.put("message", String.valueOf(e.getMessage()));
            err.put("retryable", true);
            ret.put("error", err);
        }
        call.resolve(ret);
    }

    /** Stop the foreground service (toggle off). */
    @PluginMethod
    public void stopCompanionService(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            Intent intent = new Intent(getContext(), ZaraForegroundService.class);
            intent.setAction("stop");
            getContext().startService(intent);
            ret.put("ok", true);
            ret.put("summary", "Background companion service stopped.");
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("summary", "Could not stop the service: " + e.getMessage());
        }
        call.resolve(ret);
    }
}
