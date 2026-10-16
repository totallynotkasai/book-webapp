package io.github.totallynotkasai.bookpoc.speech

import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * The device voice as a Media3 player, so [SpeechService]'s media session can show it on the
 * lock screen and in the notification (title, "Device voice", the Book) and its buttons can play,
 * pause and skip a sentence. It has no state of its own: it reflects [SpeechEngine], which calls
 * [refresh] on every change. There is no clock, so no seek bar.
 */
@OptIn(UnstableApi::class)
class SpeechPlayer(looper: Looper) : SimpleBasePlayer(looper) {
    fun refresh() = invalidateState()

    override fun getState(): State {
        val engine = SpeechEngine
        val commands = Player.Commands.Builder()
            .addAll(
                Player.COMMAND_PLAY_PAUSE,
                Player.COMMAND_STOP,
                Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
                Player.COMMAND_GET_METADATA,
                Player.COMMAND_GET_TIMELINE,
                Player.COMMAND_SEEK_TO_PREVIOUS,
                Player.COMMAND_SEEK_TO_NEXT
            )
            .build()
        val builder = State.Builder()
            .setAvailableCommands(commands)
            .setPlayWhenReady(engine.playing, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
        if (!engine.hasQueue) return builder.setPlaybackState(Player.STATE_IDLE).build()
        val metadata = MediaMetadata.Builder()
            .setTitle(engine.title ?: engine.album)
            .setArtist(engine.artist)
            .setAlbumTitle(engine.album)
            .build()
        val item = MediaItemData.Builder("device-voice")
            .setMediaItem(MediaItem.Builder().setMediaId("device-voice").setMediaMetadata(metadata).build())
            .build()
        return builder
            .setPlaylist(listOf(item))
            .setPlaybackState(if (engine.ended) Player.STATE_ENDED else Player.STATE_READY)
            .build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
        if (playWhenReady) SpeechEngine.resume() else SpeechEngine.pause()
        return Futures.immediateVoidFuture()
    }

    override fun handleStop(): ListenableFuture<*> {
        SpeechEngine.pause()
        return Futures.immediateVoidFuture()
    }

    override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
        when (seekCommand) {
            Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> SpeechEngine.skip(-1)
            Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> SpeechEngine.skip(1)
        }
        return Futures.immediateVoidFuture()
    }

    override fun handleRelease(): ListenableFuture<*> = Futures.immediateVoidFuture()
}
