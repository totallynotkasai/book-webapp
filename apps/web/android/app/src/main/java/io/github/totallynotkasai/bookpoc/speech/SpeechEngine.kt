package io.github.totallynotkasai.bookpoc.speech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * The device voice (P1-LAY-08, ADR-006): Android's `TextToSpeech`, speaking a queue of sentences
 * the app hands it. It lives for the whole process, so [SpeechPlugin] (the WebView) and
 * [SpeechPlayer] (the lock screen, through [SpeechService]'s media session) drive the same voice.
 *
 * Only a few sentences at a time are given to the engine ([WINDOW]); each one starting queues
 * the next, so speech carries on through the queue with the WebView asleep, and pausing or
 * moving needs only one `stop`. Utterance ids carry a generation, so a stopped utterance's late
 * callbacks are ignored. Everything runs on the main thread.
 *
 * Only on-device voices are offered or used (D-036): never one that needs the network, so the
 * text being read never leaves the phone.
 */
object SpeechEngine {
    data class Utterance(val id: Int, val text: String)

    /** How many sentences the engine holds ahead of the one being said. */
    private const val WINDOW = 6

    private val handler = Handler(Looper.getMainLooper())
    private var context: Context? = null
    private var tts: TextToSpeech? = null
    private var ready = false
    private var starting = false
    private val waiting = mutableListOf<(Boolean) -> Unit>()

    private val queue = ArrayList<Utterance>()
    /** The Chapter title for each utterance id that starts one (the lock screen shows it). */
    private val titles = sortedMapOf<Int, String>()
    private var index = 0
    /** Where the utterance at [index] was started from (resuming mid-sentence). */
    private var from = 0
    /** The utterance handed to the engine last, in this generation. */
    private var queuedUntil = -1
    private var generation = 0

    var charIndex = 0
        private set
    var playing = false
        private set
    var ended = false
        private set
    var error: String? = null
        private set
    var artist: String? = null
        private set
    var album: String? = null
        private set
    private var rate = 1f
    private var voiceName: String? = null
    private var lang = "en"

    /** The player behind the media session, while [SpeechService] runs. */
    var player: SpeechPlayer? = null
    val listeners = mutableSetOf<() -> Unit>()

    val currentId: Int? get() = queue.getOrNull(index)?.id
    val hasQueue: Boolean get() = queue.isNotEmpty()
    val title: String? get() = currentId?.let { id -> titles.headMap(id + 1).let { if (it.isEmpty()) null else it[it.lastKey()] } }

    private fun changed() {
        player?.refresh()
        listeners.toList().forEach { it() }
    }

    /** Binds to the device's speech engine once; [done] says whether there is one. */
    fun init(appContext: Context, done: (Boolean) -> Unit) {
        handler.post {
            if (ready) return@post done(true)
            waiting.add(done)
            if (starting) return@post
            starting = true
            context = appContext.applicationContext
            tts = TextToSpeech(context) { status ->
                handler.post {
                    starting = false
                    ready = status == TextToSpeech.SUCCESS
                    if (ready) {
                        tts?.setOnUtteranceProgressListener(progress)
                        tts?.setAudioAttributes(ATTRIBUTES)
                    } else {
                        tts?.shutdown()
                        tts = null
                    }
                    waiting.toList().also { waiting.clear() }.forEach { it(ready) }
                }
            }
        }
    }

    private fun local(voice: Voice) =
        !voice.isNetworkConnectionRequired &&
            !voice.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)

    /** On-device voices only (D-036), by language then name. */
    fun voices(): List<Voice> =
        try {
            tts?.voices.orEmpty().filter(::local).sortedWith(compareBy({ it.locale.toLanguageTag() }, { it.name }))
        } catch (e: Exception) {
            // Some engines throw here instead of returning nothing.
            emptyList()
        }

    fun defaultVoiceName(): String? =
        try {
            tts?.defaultVoice?.name
        } catch (e: Exception) {
            null
        }

    // ---- playing ----

    fun speak(
        utterances: List<Utterance>,
        chapterTitle: String,
        voice: String?,
        language: String,
        speed: Float,
        artistName: String?,
        albumTitle: String?,
        startId: Int?,
        startChar: Int
    ) {
        stopEngine()
        queue.clear()
        queue.addAll(utterances)
        titles.clear()
        utterances.firstOrNull()?.let { titles[it.id] = chapterTitle }
        index = queue.indexOfFirst { it.id == startId }.coerceAtLeast(0)
        from = startChar.coerceIn(0, queue.getOrNull(index)?.text?.length ?: 0)
        charIndex = from
        voiceName = voice
        lang = language
        rate = speed
        artist = artistName
        album = albumTitle
        ended = false
        error = null
        applyVoice()
        tts?.setSpeechRate(rate)
        start()
    }

    fun enqueue(utterances: List<Utterance>, chapterTitle: String) {
        utterances.firstOrNull()?.let { titles[it.id] = chapterTitle }
        queue.addAll(utterances)
        if (playing) topUp()
        changed()
    }

    fun pause() {
        if (!playing) return
        playing = false
        stopEngine()
        // Resume from the Word it had reached.
        from = charIndex
        abandonFocus()
        changed()
    }

    fun resume() {
        if (playing || queue.isEmpty()) return
        if (ended || index >= queue.size) {
            index = 0
            from = 0
            charIndex = 0
        }
        start()
    }

    fun seek(id: Int, char: Int) {
        val i = queue.indexOfFirst { it.id == id }
        if (i < 0) return
        index = i
        from = char.coerceIn(0, queue[i].text.length)
        charIndex = from
        ended = false
        if (playing) flush() else changed()
    }

    /** The lock screen's previous and next: a sentence back (restarting this one first) or on. */
    fun skip(dir: Int) {
        if (queue.isEmpty()) return
        if (dir < 0 && charIndex > 0) {
            from = 0
        } else {
            index = (index + dir).coerceIn(0, queue.size - 1)
            from = 0
        }
        charIndex = 0
        ended = false
        if (playing) flush() else changed()
    }

    fun stop() {
        playing = false
        stopEngine()
        queue.clear()
        titles.clear()
        index = 0
        from = 0
        charIndex = 0
        abandonFocus()
        changed()
    }

    fun setRate(speed: Float) {
        rate = speed
        tts?.setSpeechRate(rate)
        if (playing) {
            from = charIndex
            flush()
        }
    }

    fun setVoice(name: String) {
        voiceName = name
        applyVoice()
        if (playing) {
            from = charIndex
            flush()
        }
    }

    private fun applyVoice() {
        val engine = tts ?: return
        val voices = voices()
        val chosen = voices.firstOrNull { it.name == voiceName }
            ?: voices.firstOrNull { it.name == defaultVoiceName() && sameLanguage(it) }
            ?: voices.firstOrNull { sameLanguage(it) }
        if (chosen != null) engine.voice = chosen
        else engine.language = Locale.forLanguageTag(lang)
    }

    private fun sameLanguage(voice: Voice) =
        voice.locale.language.equals(Locale.forLanguageTag(lang).language, ignoreCase = true)

    private fun start() {
        if (!requestFocus()) {
            error = "Another app is playing sound."
            changed()
            return
        }
        playing = true
        ended = false
        registerNoisy()
        flush()
    }

    /** Hands the engine the sentence at [index] (from [from]) and a few after it. */
    private fun flush() {
        val engine = tts ?: return
        generation++
        engine.stop()
        queuedUntil = index - 1
        topUp()
        changed()
    }

    private fun topUp() {
        val engine = tts ?: return
        val max = TextToSpeech.getMaxSpeechInputLength()
        while (queuedUntil < queue.size - 1 && queuedUntil < index + WINDOW) {
            queuedUntil++
            val utterance = queue[queuedUntil]
            val offset = if (queuedUntil == index) from else 0
            val text = utterance.text.substring(offset).take(max)
            val mode = if (queuedUntil == index) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
            engine.speak(text, mode, Bundle(), "$generation:$queuedUntil:$offset")
        }
    }

    private fun stopEngine() {
        generation++
        unregisterNoisy()
        tts?.stop()
    }

    private data class Spoken(val generation: Int, val index: Int, val offset: Int)

    private fun parse(id: String?): Spoken? {
        val parts = id?.split(':') ?: return null
        if (parts.size != 3) return null
        return Spoken(parts[0].toIntOrNull() ?: return null, parts[1].toIntOrNull() ?: return null, parts[2].toIntOrNull() ?: return null)
    }

    private val progress = object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {
            handler.post {
                val spoken = parse(utteranceId) ?: return@post
                if (spoken.generation != generation) return@post
                index = spoken.index
                from = spoken.offset
                charIndex = spoken.offset
                topUp()
                changed()
            }
        }

        override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
            handler.post {
                val spoken = parse(utteranceId) ?: return@post
                if (spoken.generation != generation || spoken.index != index) return@post
                charIndex = spoken.offset + start
                changed()
            }
        }

        override fun onDone(utteranceId: String?) {
            handler.post {
                val spoken = parse(utteranceId) ?: return@post
                if (spoken.generation != generation || spoken.index < queue.size - 1) return@post
                // The last sentence queued has been said.
                playing = false
                ended = true
                unregisterNoisy()
                abandonFocus()
                changed()
            }
        }

        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) = onError(utteranceId, TextToSpeech.ERROR)

        override fun onError(utteranceId: String?, errorCode: Int) {
            handler.post {
                val spoken = parse(utteranceId) ?: return@post
                if (spoken.generation != generation) return@post
                playing = false
                error = "The device voice stopped (error $errorCode). Press play to try again."
                unregisterNoisy()
                abandonFocus()
                changed()
            }
        }
    }

    // ---- audio focus and headphones ----

    private val ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        handler.post {
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) pause()
        }
    }
    private var focusRequest: AudioFocusRequest? = null

    private fun audioManager() = context?.getSystemService(Context.AUDIO_SERVICE) as AudioManager?

    private fun requestFocus(): Boolean {
        val manager = audioManager() ?: return true
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(ATTRIBUTES)
                .setOnAudioFocusChangeListener(focusListener, handler)
                .build()
            focusRequest = request
            manager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun abandonFocus() {
        val manager = audioManager() ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let(manager::abandonAudioFocusRequest)
            focusRequest = null
        } else {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(focusListener)
        }
    }

    /** Unplugging headphones pauses, as listeners expect. */
    private val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) handler.post { pause() }
        }
    }
    private var noisyRegistered = false

    private fun registerNoisy() {
        val ctx = context ?: return
        if (noisyRegistered) return
        ContextCompat.registerReceiver(
            ctx,
            noisy,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        noisyRegistered = true
    }

    private fun unregisterNoisy() {
        if (!noisyRegistered) return
        noisyRegistered = false
        try {
            context?.unregisterReceiver(noisy)
        } catch (e: IllegalArgumentException) {
            // Already gone.
        }
    }
}
