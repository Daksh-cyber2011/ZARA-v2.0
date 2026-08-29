package com.zara.companion;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * ZARA V1.0 — MainActivity.
 *
 * Responsibilities:
 *  - register the ZaraActions typed-intent plugin (the ONLY native action
 *    surface). Registration happens in load() BEFORE the bridge is created —
 *    registering after super.onCreate() would be too late because the bridge
 *    is constructed inside onCreate → load().
 *  - pre-request the small permission set ZARA actually needs:
 *      RECORD_AUDIO       — live voice sessions (WebView getUserMedia is
 *                           granted by Capacitor's WebChromeClient once the
 *                           runtime permission is held)
 *      POST_NOTIFICATIONS — reminders firing as real notifications (Android 13+)
 *    Nothing else. No location, no contacts, no storage (§44 — no unnecessary
 *    permissions; all other tools use public intents handled by the target
 *    apps, which hold their own permissions).
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_PERMS = 7001;

    @Override
    public void load() {
        registerPlugin(ZaraActionsPlugin.class);
        registerPlugin(ZaraVoicePlugin.class); // Phase 2: native STT/TTS for the GLM voice path
        registerPlugin(ZaraPerceptionPlugin.class); // V1.1: screen awareness (§4-6)
        super.load();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestRuntimePermissionsIfNeeded();
    }

    private void requestRuntimePermissionsIfNeeded() {
        boolean need = false;
        String[] perms = Build.VERSION.SDK_INT >= 33
                ? new String[]{Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS}
                : new String[]{Manifest.permission.RECORD_AUDIO};
        for (String perm : perms) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                need = true;
                break;
            }
        }
        if (need) {
            ActivityCompat.requestPermissions(this, perms, REQ_PERMS);
        }
    }
}
