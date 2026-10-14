package io.github.totallynotkasai.bookpoc.window

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import androidx.core.graphics.ColorUtils
import androidx.core.view.WindowCompat
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The `AppWindow` plugin behind `lib/platform`'s Android system-bars adapter (P1-MOB-01).
 *
 * WebViews before Chromium 140 can't draw behind the system bars, so Capacitor's SystemBars pads
 * the window's decor view instead (ADR-004 check 1), and the strips above and below the WebView
 * show the decor view's background. This paints them in the page's colours: [top] behind the
 * status bar and [bottom] behind the navigation bar, with light or dark icons to suit each.
 * Edge-to-edge WebViews (140+) cover the strips with the page itself, so this changes nothing
 * visible there.
 */
@CapacitorPlugin(name = "AppWindow")
class AppWindowPlugin : Plugin() {
    @PluginMethod
    fun setColors(call: PluginCall) {
        val top = parse(call.getString("top"))
        if (top == null) {
            call.reject("top must be a colour such as #00696b")
            return
        }
        val bottom = parse(call.getString("bottom")) ?: top
        activity.runOnUiThread {
            val window = activity.window
            // Only the two ends show; the WebView covers the middle, where the colours meet.
            window.decorView.background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(top, top, bottom, bottom)
            )
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            controller.isAppearanceLightStatusBars = isLight(top)
            controller.isAppearanceLightNavigationBars = isLight(bottom)
            call.resolve()
        }
    }

    private fun parse(value: String?): Int? =
        try {
            value?.trim()?.takeIf { it.isNotEmpty() }?.let(Color::parseColor)
        } catch (e: IllegalArgumentException) {
            null
        }

    /** Light backgrounds (over half relative luminance) get dark icons. */
    private fun isLight(color: Int) = ColorUtils.calculateLuminance(color) > 0.5
}
