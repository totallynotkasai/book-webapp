package io.github.totallynotkasai.bookpoc;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.totallynotkasai.bookpoc.narration.NarrationPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Our own plugins live in the app, so they're registered here (ADR-004).
        registerPlugin(NarrationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
