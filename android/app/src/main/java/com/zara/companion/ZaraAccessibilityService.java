package com.zara.companion;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.view.accessibility.AccessibilityEvent;

import com.getcapacitor.JSObject;

import java.util.HashSet;
import java.util.Set;

/**
 * ZARA V1.1 — Screen-awareness accessibility service (Directive §4-6).
 *
 * The ONLY legitimate Android mechanism used for screen awareness here:
 * window-state-change events (app package + activity class + window title),
 * throttled and filtered, published as STRUCTURED metadata.
 *
 * Deliberate design limits (§5, §24, §44):
 *  - NO screenshots, NO OCR, NO content upload: only the window title/event
 *    text (already bounded to 200 chars) and class names are read.
 *  - Events from ZARA herself, the keyboard and SystemUI are dropped.
 *  - A per-package throttle (min 1500 ms) prevents event storms.
 *  - This service STILL does nothing unless the user ALSO enables screen
 *    awareness inside ZARA's settings (double privacy gate).
 */
public class ZaraAccessibilityService extends AccessibilityService {

    /** Min gap between published events for the same package (ms). */
    private static final long PER_PACKAGE_THROTTLE_MS = 1500;
    /** Max characters of window text forwarded upstream. */
    private static final int MAX_TEXT = 200;

    private static final Set<String> IGNORED_PACKAGES = new HashSet<>();
    static {
        IGNORED_PACKAGES.add("com.android.systemui");
        IGNORED_PACKAGES.add("com.google.android.inputmethod.latin");
        IGNORED_PACKAGES.add("com.zara.companion");
    }

    private long lastPublishAt = 0;
    private String lastPackage = "";

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED;
            info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC;
            info.flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
            info.notificationTimeout = 300; // system-level event coalescing
            setServiceInfo(info);
        }
        ZaraPerceptionBus.publishState(true);
    }

    @Override
    public void onDestroy() {
        ZaraPerceptionBus.publishState(false);
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        // Nothing to interrupt — this service only observes and reports.
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return;
        }
        CharSequence pkgSeq = event.getPackageName();
        String pkg = pkgSeq != null ? pkgSeq.toString() : "";
        if (pkg.isEmpty() || IGNORED_PACKAGES.contains(pkg)) return;

        // Throttle: one structured observation per package per window.
        long now = System.currentTimeMillis();
        if (pkg.equals(lastPackage) && now - lastPublishAt < PER_PACKAGE_THROTTLE_MS) return;

        // Class name (activity) — a strong screen-type signal.
        CharSequence clsSeq = event.getClassName();
        String className = clsSeq != null ? clsSeq.toString() : "";

        // Window title / event text, bounded. Only what the event itself
        // exposes — we do NOT walk the view hierarchy for bulk content.
        StringBuilder text = new StringBuilder();
        if (event.getContentDescription() != null) {
            text.append(event.getContentDescription().toString()).append(' ');
        }
        for (CharSequence c : event.getText()) {
            if (c != null) text.append(c.toString()).append(' ');
            if (text.length() >= MAX_TEXT) break;
        }
        // Window title (API 24+) when the event text is empty.
        if (text.length() == 0 && event.getSource() != null) {
            try {
                CharSequence title = event.getSource().getPaneTitle();
                if (title != null) text.append(title.toString());
            } catch (Exception ignored) { }
        }
        String visibleText = text.toString().replaceAll("\\s+", " ").trim();
        if (visibleText.length() > MAX_TEXT) {
            visibleText = visibleText.substring(0, MAX_TEXT);
        }

        lastPackage = pkg;
        lastPublishAt = now;

        JSObject data = new JSObject();
        data.put("packageName", pkg);
        data.put("appLabel", appLabel(pkg));
        data.put("className", className);
        data.put("text", visibleText);
        data.put("at", now);
        ZaraPerceptionBus.publishScreen(data);
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(pkg, 0);
            CharSequence label = pm.getApplicationLabel(info);
            return label != null ? label.toString() : pkg;
        } catch (Exception e) {
            return pkg;
        }
    }
}
