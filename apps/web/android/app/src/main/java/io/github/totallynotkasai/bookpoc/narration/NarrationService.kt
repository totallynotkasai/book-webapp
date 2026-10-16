package io.github.totallynotkasai.bookpoc.narration

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.collect.ImmutableList
import io.github.totallynotkasai.bookpoc.R

/**
 * Plays narration in a `mediaPlayback` foreground service with a media session (ADR-004, D-027),
 * so it keeps going, Chapter after Chapter, with the WebView in the background or the screen
 * locked, and the lock screen and notification show its controls. [NarrationPlugin] drives it
 * through a `MediaController`; Media3 shows the notification and starts and stops the service.
 */
class NarrationService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .build(),
                /* handleAudioFocus= */ true
            )
            // Unplugging headphones pauses, as listeners expect.
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .setSeekBackIncrementMs(SKIP_MS)
            .setSeekForwardIncrementMs(SKIP_MS)
            .build()
        // The sleep timer works on this player directly (P1-LAY-09).
        NarrationSleep.attach(player)

        // The lock screen's buttons: ±15 s around play/pause (DESIGN.md §8.3).
        val back = CommandButton.Builder(CommandButton.ICON_SKIP_BACK_15)
            .setDisplayName(getString(R.string.narration_back))
            .setPlayerCommand(Player.COMMAND_SEEK_BACK)
            .setSlots(CommandButton.SLOT_BACK)
            .build()
        val forward = CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_15)
            .setDisplayName(getString(R.string.narration_forward))
            .setPlayerCommand(Player.COMMAND_SEEK_FORWARD)
            .setSlots(CommandButton.SLOT_FORWARD)
            .build()

        // Tapping the notification opens the app where it was.
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
        }
        session = MediaSession.Builder(this, player)
            .setMediaButtonPreferences(ImmutableList.of(back, forward))
            .apply { if (open != null) setSessionActivity(open) }
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** Swiping the app away stops narration unless it's playing. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.playbackState == Player.STATE_ENDED) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        session?.run {
            (player as? ExoPlayer)?.let(NarrationSleep::detach)
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }

    companion object {
        const val SKIP_MS = 15_000L
    }
}
