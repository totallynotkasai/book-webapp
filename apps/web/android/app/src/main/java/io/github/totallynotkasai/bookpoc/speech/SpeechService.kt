package io.github.totallynotkasai.bookpoc.speech

import android.app.PendingIntent
import android.content.Intent
import android.os.Looper
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Keeps the device voice going with the screen locked (P1-LAY-08, ADR-006): a `mediaPlayback`
 * foreground service with a media session around [SpeechPlayer], as narration's
 * `NarrationService` does for recordings (ADR-004). [SpeechPlugin] connects to it before
 * speaking; Media3 shows the notification and lock-screen controls and starts and stops the
 * foreground service as speech plays and pauses.
 */
class SpeechService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val player = SpeechPlayer(Looper.getMainLooper())
        SpeechEngine.player = player
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
            // Narration's session has the default id; each session in an app needs its own.
            .setId("device-voice")
            .apply { if (open != null) setSessionActivity(open) }
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /** Swiping the app away stops the voice unless it's speaking. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!SpeechEngine.playing) {
            SpeechEngine.stop()
            stopSelf()
        }
    }

    override fun onDestroy() {
        if (SpeechEngine.player === session?.player) SpeechEngine.player = null
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}
