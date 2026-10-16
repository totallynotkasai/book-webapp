package io.github.totallynotkasai.bookpoc.sleep

import android.os.Handler
import android.os.Looper
import android.os.SystemClock

/**
 * The sleep timer (P1-LAY-09) for narration and the device voice. It runs here, in the app's
 * process beside the player, not in the WebView, whose timers sleep with the screen locked.
 * A `time` timer counts only while [playing] says so; an `item` timer waits for the end of the
 * Chapter, which its owner watches for. While either is armed, [tick] runs every [TICK_MS] so
 * the owner can fade out and stop. Everything runs on the main thread.
 */
class SleepTimer(
    private val playing: () -> Boolean,
    private val tick: (SleepTimer) -> Unit
) {
    /** `time` or `item`; null when off. */
    var kind: String? = null
        private set

    /** How many times the timer has stopped playing, so the app can tell each one apart. */
    var fired = 0
        private set

    private var leftMs = 0L
    private var at = 0L
    private var counting = false
    private val handler = Handler(Looper.getMainLooper())

    private val ticker = object : Runnable {
        override fun run() {
            if (kind == null) return
            tick(this@SleepTimer)
            if (kind != null) handler.postDelayed(this, TICK_MS)
        }
    }

    /** Arms a timer (`time` with [ms] of playing, or `item`), replacing any; null turns it off. */
    fun arm(kind: String?, ms: Long) {
        handler.removeCallbacks(ticker)
        this.kind = kind
        leftMs = ms
        at = SystemClock.elapsedRealtime()
        counting = playing()
        if (kind != null) handler.postDelayed(ticker, TICK_MS)
    }

    fun cancel() = arm(null, 0L)

    /** The timer has stopped playing: it's off again. */
    fun done() {
        cancel()
        fired++
    }

    /** Call whenever playing may have started or stopped: only playing time counts. */
    fun playingChanged() {
        val now = SystemClock.elapsedRealtime()
        if (counting) leftMs -= now - at
        at = now
        counting = playing()
    }

    /** Playing time left on a `time` timer; null for any other. */
    val timeLeftMs: Long?
        get() {
            if (kind != "time") return null
            val running = if (counting) SystemClock.elapsedRealtime() - at else 0L
            return maxOf(0L, leftMs - running)
        }

    companion object {
        const val TICK_MS = 250L

        /** A recording fades out over this long before it stops (`SLEEP_FADE_MS` on the web). */
        const val FADE_MS = 6_000L
    }
}
