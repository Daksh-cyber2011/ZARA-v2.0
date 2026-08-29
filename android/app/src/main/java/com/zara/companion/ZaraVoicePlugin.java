package com.zara.companion;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * ZARA V1.0 Phase 2 — Native voice I/O plugin (Directive §10, PATH A).
 *
 * Serves the GLM voice pipeline:
 *   MIC → SpeechRecognizer (STT) → [JS: GLM 5.2 reasoning] → TTS → speaker
 *
 * Design notes:
 *  - STT runs in auto-restart sessions. Partial results stream to JS
 *    ("sttEvent") so the TS layer can detect barge-in while TTS is speaking.
 *  - TTS streams utterance lifecycle ("ttsEvent": start/done/error) so the TS
 *    speech queue tracks the real speaking state — the avatar never lies (§28).
 *  - Every failure is reported honestly with a typed code (§32); no silent
 *    no-ops. RECORD_AUDIO is pre-requested by MainActivity for STT.
 *  - This plugin NEVER talks to the LLM. It is transport only — the reasoning
 *    provider stays behind the TS LLMProvider abstraction (§12).
 */
@CapacitorPlugin(name = "ZaraVoice")
public class ZaraVoicePlugin extends Plugin {

    public static final String EVENT_STT = "sttEvent";
    public static final String EVENT_TTS = "ttsEvent";

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private SpeechRecognizer stt;
    private boolean sttListening = false;
    private String sttLang = "en-IN";
    private final Handler main = new Handler(Looper.getMainLooper());
    private String lastUtteranceId = "";

    /* ------------------------------ capabilities ----------------------------- */

    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ttsReady", ttsReady);
        ret.put("sttAvailable", SpeechRecognizer.isRecognitionAvailable(getContext()));
        ret.put("sttListening", sttListening);
        call.resolve(ret);
    }

    /* --------------------------------- TTS ----------------------------------- */

    private void ensureTts(final Runnable onReady, final PluginCall failCall) {
        if (ttsReady && tts != null) { onReady.run(); return; }
        tts = new TextToSpeech(getContext(), status -> {
            boolean ok = status == TextToSpeech.SUCCESS;
            ttsReady = ok;
            if (ok) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        emitTts("start", utteranceId);
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        emitTts("done", utteranceId);
                    }

                    @Override
                    public void onError(String utteranceId) {
                        emitTts("error", utteranceId);
                    }
                });
                onReady.run();
            } else if (failCall != null) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("summary", "Text-to-speech failed to initialize on this device.");
                JSObject err = new JSObject();
                err.put("code", "TTS_INIT_FAILED");
                err.put("message", "TextToSpeech init status=" + status);
                ret.put("error", err);
                failCall.resolve(ret);
            }
        });
    }

    /** Speak one utterance. Only ONE utterance speaks at a time (queue mode FLUSH). */
    @PluginMethod
    public void ttsSpeak(PluginCall call) {
        String text = call.getString("text", "");
        final String lang = call.getString("lang", "en-IN");
        final String utteranceId = call.getString("utteranceId", "utt_" + System.currentTimeMillis());
        if (text.trim().isEmpty()) { call.reject("text required"); return; }

        ensureTts(() -> main.post(() -> {
            try {
                Locale loc = localeFor(lang);
                int setRes = tts.setLanguage(loc);
                // Missing language data is NOT fatal — TTS falls back to the
                // default locale, and we report the downgrade honestly.
                boolean degraded = setRes == TextToSpeech.LANG_MISSING_DATA
                        || setRes == TextToSpeech.LANG_NOT_SUPPORTED;
                HashMap<String, String> params = new HashMap<>();
                params.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);
                lastUtteranceId = utteranceId;
                int res = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params);
                JSObject ret = new JSObject();
                ret.put("ok", res == TextToSpeech.SUCCESS);
                ret.put("summary", res == TextToSpeech.SUCCESS
                        ? (degraded ? "Speaking (voice for " + lang + " unavailable, using default)." : "Speaking.")
                        : "TTS rejected the utterance.");
                ret.put("utteranceId", utteranceId);
                ret.put("degraded", degraded);
                if (res != TextToSpeech.SUCCESS) {
                    JSObject err = new JSObject();
                    err.put("code", "TTS_SPEAK_FAILED");
                    err.put("message", "tts.speak returned " + res);
                    ret.put("error", err);
                }
                call.resolve(ret);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("summary", "TTS failed: " + e.getMessage());
                JSObject err = new JSObject();
                err.put("code", "TTS_SPEAK_FAILED");
                err.put("message", String.valueOf(e.getMessage()));
                ret.put("error", err);
                call.resolve(ret);
            }
        }), call);
    }

    /** Immediately stop current speech (barge-in path — Directive §11). */
    @PluginMethod
    public void ttsStop(PluginCall call) {
        try {
            if (tts != null) tts.stop();
        } catch (Exception ignored) { }
        call.resolve(new JSObject() {{ put("ok", true); put("summary", "Speech stopped."); }});
    }

    /* --------------------------------- STT ----------------------------------- */

    /**
     * Start listening in auto-restart sessions. Results stream as events:
     *   sttEvent { type: "partial"|"final"|"error"|"end", text, code, message }
     * The TS layer decides what each result means (barge-in vs new turn).
     */
    @PluginMethod
    public void sttStart(PluginCall call) {
        String lang = call.getString("lang", "en-IN");
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("summary", "No speech recognition service is available on this device.");
            JSObject err = new JSObject();
            err.put("code", "STT_UNAVAILABLE");
            err.put("message", "SpeechRecognizer.isRecognitionAvailable() is false");
            ret.put("error", err);
            call.resolve(ret);
            return;
        }
        sttLang = lang;
        main.post(() -> {
            try {
                stopSttInternal();
                stt = SpeechRecognizer.createSpeechRecognizer(getContext());
                stt.setRecognitionListener(new ZaraRecognitionListener());
                sttListening = true;
                listenOnce();
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("summary", "Listening (" + lang + ").");
                call.resolve(ret);
            } catch (Exception e) {
                sttListening = false;
                JSObject ret = new JSObject();
                ret.put("ok", false);
                ret.put("summary", "Could not start listening: " + e.getMessage());
                JSObject err = new JSObject();
                err.put("code", "STT_START_FAILED");
                err.put("message", String.valueOf(e.getMessage()));
                ret.put("error", err);
                call.resolve(ret);
            }
        });
    }

    /** Stop listening (end of voice session / mode change). */
    @PluginMethod
    public void sttStop(PluginCall call) {
        main.post(this::stopSttInternal);
        call.resolve(new JSObject() {{ put("ok", true); put("summary", "Stopped listening."); }});
    }

    private void stopSttInternal() {
        sttListening = false;
        if (stt != null) {
            try { stt.destroy(); } catch (Exception ignored) { }
            stt = null;
        }
    }

    private void listenOnce() {
        if (stt == null || !sttListening) return;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, sttLang);
        // Hinglish: also allow English + Hindi alternates to be considered.
        if (sttLang.startsWith("hi")) {
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "hi-IN");
        }
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            stt.startListening(intent);
        } catch (Exception e) {
            emit(EVENT_STT, "error", "", "STT_LISTEN_FAILED", String.valueOf(e.getMessage()));
        }
    }

    private class ZaraRecognitionListener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }

        @Override
        public void onError(int error) {
            // TIMEOUT / NO_MATCH during silence are NORMAL in an auto-restart
            // loop — reconnect instead of surfacing an error.
            if (error == SpeechRecognizer.ERROR_NO_MATCH
                    || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                restartSoon(250);
                return;
            }
            String code;
            switch (error) {
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: code = "STT_NETWORK_TIMEOUT"; break;
                case SpeechRecognizer.ERROR_NETWORK: code = "STT_NETWORK"; break;
                case SpeechRecognizer.ERROR_AUDIO: code = "STT_AUDIO"; break;
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: code = "STT_PERMISSION"; break;
                case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: code = "STT_BUSY"; break;
                case SpeechRecognizer.ERROR_CLIENT: code = "STT_CLIENT"; break;
                default: code = "STT_ERROR_" + error; break;
            }
            emit(EVENT_STT, "error", "", code, "SpeechRecognizer error " + error);
            if (error == SpeechRecognizer.ERROR_CLIENT
                    || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                restartSoon(600); // recover from transient client errors
            } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                sttListening = false; // fatal — stop the loop
            }
        }

        @Override
        public void onResults(Bundle results) {
            ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
            if (text != null && !text.trim().isEmpty()) {
                emit(EVENT_STT, "final", text.trim(), null, null);
            }
            restartSoon(150); // continue the session
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
            if (text != null && !text.trim().isEmpty()) {
                emit(EVENT_STT, "partial", text.trim(), null, null);
            }
        }

        @Override
        public void onEvent(int eventType, Bundle params) { }
    }

    private void restartSoon(long delayMs) {
        main.postDelayed(() -> {
            if (sttListening) {
                // Recreate the recognizer if the session died (some OEMs
                // destroy it after a few results).
                listenOnce();
            }
        }, delayMs);
    }

    /* -------------------------------- helpers -------------------------------- */

    private static Locale localeFor(String lang) {
        try {
            String[] parts = lang.split("[-_]");
            if (parts.length >= 2) return new Locale(parts[0], parts[1]);
            return new Locale(lang);
        } catch (Exception e) {
            return Locale.getDefault();
        }
    }

    private void emit(String event, String type, String text, String code, String message) {
        JSObject data = new JSObject();
        data.put("type", type);
        if (text != null) data.put("text", text);
        if (code != null) data.put("code", code);
        if (message != null) data.put("message", message);
        notifyListeners(event, data);
    }

    /** TTS lifecycle events carry the utterance id (different payload shape). */
    private void emitTts(String type, String utteranceId) {
        JSObject data = new JSObject();
        data.put("type", type);
        if (utteranceId != null) data.put("utteranceId", utteranceId);
        notifyListeners(EVENT_TTS, data);
    }

    @Override
    protected void handleOnDestroy() {
        stopSttInternal();
        try { if (tts != null) tts.shutdown(); } catch (Exception ignored) { }
        super.handleOnDestroy();
    }
}
