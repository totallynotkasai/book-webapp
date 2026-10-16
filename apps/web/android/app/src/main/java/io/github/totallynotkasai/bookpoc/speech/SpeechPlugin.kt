package io.github.totallynotkasai.bookpoc.speech

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject
import java.util.Locale

/**
 * The `Speech` plugin behind `lib/platform`'s Android speech adapter (`native-speech.ts`,
 * P1-LAY-08, ADR-006). The Android WebView has no Web Speech API, so the device voice is
 * Android's own `TextToSpeech` ([SpeechEngine]), in [SpeechService] so it keeps speaking with
 * the screen locked. The plugin reports the engine's state as a `state` event on every change:
 * each sentence started and each Word in it.
 *
 * Capacitor calls plugin methods on its own thread; the engine and the controller are only used
 * on the main thread.
 */
@CapacitorPlugin(name = "Speech")
class SpeechPlugin : Plugin() {
    private val handler = Handler(Looper.getMainLooper())
    private var controller: MediaController? = null
    private var pending: ListenableFuture<MediaController>? = null
    private val listener: () -> Unit = { notifyListeners("state", state()) }

    override fun load() {
        handler.post { SpeechEngine.listeners.add(listener) }
    }

    private fun state(): JSObject =
        JSObject()
            .put("id", SpeechEngine.currentId ?: JSONObject.NULL)
            .put("charIndex", SpeechEngine.charIndex)
            .put("playing", SpeechEngine.playing)
            .put("ended", SpeechEngine.ended)
            .put("error", SpeechEngine.error ?: JSONObject.NULL)

    /** Runs [block] on the main thread once the engine is ready, or rejects the call. */
    private fun withEngine(call: PluginCall, block: () -> Unit) {
        SpeechEngine.init(context) { ok ->
            if (ok) block() else call.reject("This device has no text-to-speech engine.")
        }
    }

    /** Connects to [SpeechService], so it runs (and can go to the foreground) while speaking. */
    private fun withService(call: PluginCall, block: () -> Unit) {
        handler.post {
            if (controller != null) return@post block()
            if (pending != null) {
                pending!!.addListener({ block() }, ContextCompat.getMainExecutor(context))
                return@post
            }
            val token = SessionToken(context, ComponentName(context, SpeechService::class.java))
            val future = MediaController.Builder(context, token)
                .setApplicationLooper(Looper.getMainLooper())
                .buildAsync()
            pending = future
            future.addListener({
                pending = null
                try {
                    controller = future.get()
                    block()
                } catch (e: Exception) {
                    call.reject("The device voice couldn’t start: ${e.message}")
                }
            }, ContextCompat.getMainExecutor(context))
        }
    }

    @PluginMethod
    fun available(call: PluginCall) {
        SpeechEngine.init(context) { ok ->
            call.resolve(JSObject().put("available", ok && SpeechEngine.voices().isNotEmpty()))
        }
    }

    @PluginMethod
    fun voices(call: PluginCall) = withEngine(call) {
        val default = SpeechEngine.defaultVoiceName()
        val voices = SpeechEngine.voices()
        val shown = Locale.getDefault()
        // Engines name voices by code ("en-gb-x-gba-local"): number them within each language.
        val counts = mutableMapOf<String, Int>()
        val perLocale = voices.groupingBy { it.locale.toLanguageTag() }.eachCount()
        val list = JSArray()
        for (voice in voices) {
            val tag = voice.locale.toLanguageTag()
            val n = (counts[tag] ?: 0) + 1
            counts[tag] = n
            val language = voice.locale.getDisplayName(shown)
            list.put(
                JSObject()
                    .put("id", voice.name)
                    .put("name", if ((perLocale[tag] ?: 1) > 1) "$language $n" else language)
                    .put("lang", tag)
                    .put("default", voice.name == default)
            )
        }
        call.resolve(JSObject().put("voices", list))
    }

    private fun utterances(call: PluginCall): List<SpeechEngine.Utterance>? {
        val array = call.getArray("utterances") ?: return null
        return (0 until array.length()).map { i ->
            val item = array.getJSONObject(i)
            SpeechEngine.Utterance(item.getInt("id"), item.getString("text"))
        }
    }

    @PluginMethod
    fun speak(call: PluginCall) {
        val items = utterances(call) ?: return call.reject("Nothing to say.")
        withEngine(call) {
            withService(call) {
                // Only ever on the reader's press of play (Invariant 11).
                SpeechEngine.speak(
                    utterances = items,
                    chapterTitle = call.getString("title") ?: "",
                    voice = call.getString("voice"),
                    language = call.getString("lang") ?: "en",
                    speed = (call.getDouble("rate") ?: 1.0).toFloat(),
                    artistName = call.getString("artist"),
                    albumTitle = call.getString("album"),
                    startId = call.getInt("startId"),
                    startChar = call.getInt("startChar") ?: 0
                )
                call.resolve()
            }
        }
    }

    @PluginMethod
    fun enqueue(call: PluginCall) {
        val items = utterances(call) ?: return call.reject("Nothing to say.")
        handler.post {
            SpeechEngine.enqueue(items, call.getString("title") ?: "")
            call.resolve()
        }
    }

    @PluginMethod
    fun seek(call: PluginCall) {
        val id = call.getInt("id") ?: return call.reject("No sentence.")
        handler.post {
            SpeechEngine.seek(id, call.getInt("charIndex") ?: 0)
            call.resolve()
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        handler.post {
            SpeechEngine.pause()
            call.resolve()
        }
    }

    @PluginMethod
    fun resume(call: PluginCall) = withEngine(call) {
        withService(call) {
            SpeechEngine.resume()
            call.resolve()
        }
    }

    /** Stops and lets the service go, which removes the notification and lock-screen controls. */
    @PluginMethod
    fun stop(call: PluginCall) {
        handler.post {
            SpeechEngine.stop()
            controller?.release()
            controller = null
            call.resolve()
        }
    }

    @PluginMethod
    fun setRate(call: PluginCall) {
        handler.post {
            SpeechEngine.setRate((call.getDouble("rate") ?: 1.0).toFloat())
            call.resolve()
        }
    }

    @PluginMethod
    fun setVoice(call: PluginCall) {
        val voice = call.getString("voice") ?: return call.reject("No voice.")
        handler.post {
            SpeechEngine.setVoice(voice)
            call.resolve()
        }
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        handler.post { call.resolve(state()) }
    }

    override fun handleOnDestroy() {
        handler.post {
            SpeechEngine.listeners.remove(listener)
            // The service keeps speaking if it is; it stops itself once paused and unbound.
            controller?.release()
            controller = null
            pending?.let(MediaController::releaseFuture)
        }
        super.handleOnDestroy()
    }
}
