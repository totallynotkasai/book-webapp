package io.github.totallynotkasai.bookpoc.narration

import android.content.ComponentName
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONObject

/**
 * The `Narration` plugin behind `lib/platform`'s Android audio adapter (`native-audio.ts`,
 * ADR-004): loads a playlist (a Chapter per item) into [NarrationService] and plays, pauses,
 * seeks and sets the speed through a `MediaController`. It reports its state as a `state` event
 * on every change and every [TICK_MS] while playing; the WebView extrapolates in between.
 *
 * The app's own files are packaged under `assets/public`, so URLs on the WebView's own origin
 * are played from there. Capacitor calls plugin methods on its own thread; the controller is
 * only ever used on the main thread, its application looper, as Media3 requires.
 */
@CapacitorPlugin(name = "Narration")
class NarrationPlugin : Plugin() {
    private var controller: MediaController? = null
    private var pending: ListenableFuture<MediaController>? = null
    private val waiting = mutableListOf<(MediaController) -> Unit>()
    private val handler = Handler(Looper.getMainLooper())
    private var error: String? = null

    private val ticker = object : Runnable {
        override fun run() {
            report()
            if (controller?.let(::playing) == true) handler.postDelayed(this, TICK_MS)
        }
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            if (events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED) ||
                events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)
            ) {
                handler.removeCallbacks(ticker)
                if (playing(player)) handler.postDelayed(ticker, TICK_MS)
            }
            report()
        }

        override fun onPlayerError(e: PlaybackException) {
            error = e.message ?: "This narration couldn’t be played."
            report()
        }
    }

    private fun playing(player: Player) =
        player.playWhenReady &&
            player.playbackState != Player.STATE_ENDED &&
            player.playbackState != Player.STATE_IDLE

    /** Runs [block] on the main thread with the controller, connecting to the service if needed. */
    private fun withController(call: PluginCall, block: (MediaController) -> Unit) {
        handler.post { connect(call, block) }
    }

    private fun connect(call: PluginCall, block: (MediaController) -> Unit) {
        controller?.let { return block(it) }
        waiting.add(block)
        if (pending != null) return
        val token = SessionToken(context, ComponentName(context, NarrationService::class.java))
        val future = MediaController.Builder(context, token)
            .setApplicationLooper(Looper.getMainLooper())
            .buildAsync()
        pending = future
        future.addListener({
            pending = null
            try {
                val connected = future.get()
                connected.addListener(listener)
                controller = connected
                waiting.toList().also { waiting.clear() }.forEach { it(connected) }
            } catch (e: Exception) {
                waiting.clear()
                call.reject("Narration couldn’t start: ${e.message}")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    @PluginMethod
    fun load(call: PluginCall) {
        val items = call.getArray("items") ?: return call.reject("No items to play.")
        val artist = call.getString("artist")
        val album = call.getString("album")
        val artwork = call.getString("artworkUrl")?.let(::resolve)
        val media = (0 until items.length()).map { i ->
            val item = items.getJSONObject(i)
            MediaItem.Builder()
                .setMediaId(i.toString())
                .setUri(resolve(item.getString("url")))
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle(item.getString("title"))
                        .setArtist(artist)
                        .setAlbumTitle(album)
                        .setArtworkUri(artwork)
                        .build()
                )
                .build()
        }
        val index = call.getInt("index", 0) ?: 0
        val position = call.getDouble("positionMs", 0.0)?.toLong() ?: 0L
        withController(call) { c ->
            error = null
            // Never starts playing here (Invariant 11): only `play` does.
            c.playWhenReady = false
            c.setMediaItems(media, index, position)
            c.prepare()
            report()
            call.resolve()
        }
    }

    @PluginMethod
    fun play(call: PluginCall) = withController(call) {
        if (it.playbackState == Player.STATE_ENDED) it.seekTo(0, 0)
        it.play()
        call.resolve()
    }

    @PluginMethod
    fun pause(call: PluginCall) = withController(call) {
        it.pause()
        call.resolve()
    }

    @PluginMethod
    fun seek(call: PluginCall) = withController(call) { c ->
        val position = call.getDouble("positionMs", 0.0)?.toLong() ?: 0L
        val index = call.getInt("index")
        if (index != null && index != c.currentMediaItemIndex) c.seekTo(index, position)
        else c.seekTo(position)
        report()
        call.resolve()
    }

    @PluginMethod
    fun setRate(call: PluginCall) = withController(call) {
        // ExoPlayer keeps the pitch as the speed changes.
        it.setPlaybackSpeed((call.getDouble("rate", 1.0) ?: 1.0).toFloat())
        call.resolve()
    }

    /** Stops and lets the service go, which removes the notification and lock-screen controls. */
    @PluginMethod
    fun unload(call: PluginCall) {
        handler.post {
            handler.removeCallbacks(ticker)
            controller?.run {
                stop()
                clearMediaItems()
                release()
            }
            controller = null
            call.resolve()
        }
    }

    private fun report() {
        val c = controller ?: return
        val duration = c.duration
        notifyListeners(
            "state",
            JSObject()
                .put("index", c.currentMediaItemIndex)
                .put("positionMs", c.currentPosition)
                .put("durationMs", if (duration == C.TIME_UNSET) 0 else duration)
                .put("playing", playing(c))
                .put("ended", c.playbackState == Player.STATE_ENDED)
                .put("error", error ?: JSONObject.NULL)
        )
    }

    /** The WebView's own origin is the packaged web app, in `assets/public`. */
    private fun resolve(url: String): Uri {
        val local = bridge.localUrl
        return if (url.startsWith("$local/")) {
            Uri.parse("asset:///public" + Uri.parse(url).path)
        } else {
            Uri.parse(url)
        }
    }

    override fun handleOnDestroy() {
        handler.post {
            handler.removeCallbacks(ticker)
            // The service keeps playing if it is; it stops itself once paused and unbound.
            controller?.release()
            controller = null
            pending?.let(MediaController::releaseFuture)
        }
        super.handleOnDestroy()
    }

    companion object {
        const val TICK_MS = 250L
    }
}
