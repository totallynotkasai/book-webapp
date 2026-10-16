package io.github.totallynotkasai.bookpoc.narration

import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import io.github.totallynotkasai.bookpoc.sleep.SleepTimer

/**
 * Narration's sleep timer (P1-LAY-09), beside the player in [NarrationService], so it stops on
 * time with the screen locked and outlives the WebView. A `time` timer fades the recording out
 * over its last [SleepTimer.FADE_MS] and pauses it; an `item` timer fades out the end of the
 * Chapter, has ExoPlayer pause there, and leaves it ready at the start of the next one.
 * [NarrationPlugin] arms it and reports it. Main thread only.
 */
object NarrationSleep {
    private var player: ExoPlayer? = null

    val timer = SleepTimer(playing = { player?.isPlaying == true }, tick = ::tick)

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) = timer.playingChanged()

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            val p = player ?: return
            if (playWhenReady || timer.kind != "item" ||
                reason != Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM
            ) {
                return
            }
            // First, so the pause is reported with it.
            timer.done()
            p.pauseAtEndOfMediaItems = false
            p.volume = 1f
            if (p.hasNextMediaItem()) p.seekToNextMediaItem()
        }
    }

    fun attach(exo: ExoPlayer) {
        player = exo
        exo.addListener(listener)
        exo.pauseAtEndOfMediaItems = timer.kind == "item"
    }

    fun detach(exo: ExoPlayer) {
        if (player !== exo) return
        exo.removeListener(listener)
        player = null
        timer.cancel()
    }

    /** Arms the timer (`time` or `item`), replacing any; null turns it off. */
    fun arm(kind: String?, ms: Long) {
        timer.arm(kind, ms)
        player?.let {
            it.volume = 1f
            it.pauseAtEndOfMediaItems = kind == "item"
        }
    }

    /** Until it stops: playing time (`time`), or the rest of the Chapter at its speed (`item`). */
    fun leftMs(): Long? =
        when (timer.kind) {
            "time" -> timer.timeLeftMs
            "item" -> player?.let { p ->
                if (p.duration == C.TIME_UNSET) {
                    null
                } else {
                    ((p.duration - p.currentPosition) / p.playbackParameters.speed).toLong().coerceAtLeast(0L)
                }
            }
            else -> null
        }

    private fun tick(t: SleepTimer) {
        val p = player ?: return
        val left = leftMs()
        p.volume = if (left == null) 1f else (left.toFloat() / SleepTimer.FADE_MS).coerceIn(0f, 1f)
        if (t.kind == "time" && left != null && left <= 0L) {
            // First, so the pause is reported with it; full volume again for next time.
            t.done()
            p.pause()
            p.volume = 1f
        }
    }
}
