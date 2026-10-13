package io.github.totallynotkasai.bookpoc;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.totallynotkasai.bookpoc.narration.NarrationPlugin;
import io.github.totallynotkasai.bookpoc.window.AppWindowPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugins live in the app, so they're registered here (ADR-004).
        registerPlugin(NarrationPlugin.class);
        registerPlugin(AppWindowPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
