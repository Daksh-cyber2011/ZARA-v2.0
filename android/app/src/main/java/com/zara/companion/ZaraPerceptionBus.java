package com.zara.companion;

import com.getcapacitor.JSObject;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * ZARA V1.1 — In-process perception bus (Directive §3, §4).
 *
 * The accessibility service and the Capacitor plugin live in the SAME
 * process, so a static listener list is the simplest reliable transport —
 * no broadcasts, no persistence, nothing leaves the process.
 *
 * Listeners receive structured JSObjects ONLY (app, class, bounded title
 * text). There is deliberately no screenshot/OCR channel on this bus.
 */
public final class ZaraPerceptionBus {

    public interface Listener {
        void onScreenEvent(JSObject data);
        void onServiceState(boolean connected);
    }

    private static final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private static volatile boolean serviceConnected = false;

    private ZaraPerceptionBus() { }

    public static void subscribe(Listener l) {
        if (!listeners.contains(l)) listeners.add(l);
    }

    public static void unsubscribe(Listener l) {
        listeners.remove(l);
    }

    public static void publishScreen(JSObject data) {
        for (Listener l : listeners) {
            try { l.onScreenEvent(data); } catch (Exception ignored) { }
        }
    }

    public static void publishState(boolean connected) {
        serviceConnected = connected;
        for (Listener l : listeners) {
            try { l.onServiceState(connected); } catch (Exception ignored) { }
        }
    }

    public static boolean isServiceConnected() {
        return serviceConnected;
    }
}
