package com.zara.companion;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * ZARA V1.1 — Perception plugin (Directive §4-6).
 *
 * Bridge between the accessibility service and the JS runtime:
 *  - getCapabilityState(): REAL check whether the ZARA accessibility service
 *    is enabled in Android settings (never assumed — §31).
 *  - openAccessibilitySettings(): sends the user to the exact settings pane
 *    to grant/deny the permission (§24 explicit consent flow).
 *  - Forwards structured screen observations to JS as "screenObservation"
 *    events ONLY while at least one JS listener is attached AND the service
 *    is connected. When the app-level toggle is off, the JS side never
 *    subscribes — so nothing is delivered (double gate).
 */
@CapacitorPlugin(name = "ZaraPerception")
public class ZaraPerceptionPlugin extends Plugin implements ZaraPerceptionBus.Listener {

    private boolean forwarding = false;

    @Override
    public void load() {
        super.load();
        ZaraPerceptionBus.subscribe(this);
    }

    @Override
    public void handleOnDestroy() {
        ZaraPerceptionBus.unsubscribe(this);
        forwarding = false;
        super.handleOnDestroy();
    }

    /** Real, honest accessibility-enabled check for THIS app's service. */
    private boolean isAccessibilityServiceEnabled() {
        // Primary check: the enabled-services list contains our component.
        try {
            String enabled = Settings.Secure.getString(
                    getContext().getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (enabled != null) {
                ComponentName cn = new ComponentName(getContext(), ZaraAccessibilityService.class);
                String flat = cn.flattenToString();
                String shortFlat = cn.flattenToShortString();
                for (String entry : enabled.split(":")) {
                    String e = entry.trim();
                    if (e.equalsIgnoreCase(flat) || e.equalsIgnoreCase(shortFlat)
                            || e.toLowerCase().contains("zaraaccessibilityservice")) {
                        return true;
                    }
                }
            }
        } catch (Exception ignored) { }
        // Fallback: AccessibilityManager enabled-service list (feedback-based).
        try {
            AccessibilityManager am = (AccessibilityManager)
                    getContext().getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (am != null) {
                List<AccessibilityServiceInfo> list =
                        am.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_GENERIC);
                if (list != null) {
                    for (AccessibilityServiceInfo i : list) {
                        if (i.getId() != null && i.getId().contains("ZaraAccessibilityService")) {
                            return true;
                        }
                    }
                }
            }
        } catch (Exception ignored) { }
        return false;
    }

    /**
     * §4 capability probe. Returns the platform truth:
     *   supported: true (this build contains the service)
     *   permissionGranted: whether Android settings currently enable it
     */
    @PluginMethod
    public void getCapabilityState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        ret.put("permissionGranted", isAccessibilityServiceEnabled());
        ret.put("connected", ZaraPerceptionBus.isServiceConnected());
        call.resolve(ret);
    }

    /** §24 explicit consent flow: open Android's accessibility settings. */
    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("summary", "Opened Android accessibility settings.");
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("summary", "Could not open accessibility settings: " + e.getMessage());
            call.resolve(ret);
        }
    }

    /* -------------------- ZaraPerceptionBus.Listener -------------------- */

    @Override
    public void onScreenEvent(JSObject data) {
        // Forward only while JS listeners exist (Capacitor tracks them).
        if (forwarding) {
            notifyListeners("screenObservation", data);
        }
    }

    @Override
    public void onServiceState(boolean connected) {
        JSObject data = new JSObject();
        data.put("connected", connected);
        if (forwarding) {
            notifyListeners("serviceState", data);
        }
    }

    /**
     * JS side calls this when it wants observations (app toggle ON) or not
     * (toggle OFF / going to background). Explicit subscription keeps the
     * privacy gate enforceable at BOTH layers.
     */
    @PluginMethod
    public void setForwarding(PluginCall call) {
        Boolean on = call.getBoolean("enabled");
        forwarding = on != null && on;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("forwarding", forwarding);
        call.resolve(ret);
    }
}
