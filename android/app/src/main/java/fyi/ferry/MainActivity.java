package fyi.ferry;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // The plugin is queryable in every build, but all permission-changing operations are
        // hard-gated by BuildConfig.BACKGROUND_LOCATION_FEASIBILITY_ENABLED (false by default).
        registerPlugin(BackgroundLocationFeasibilityPlugin.class);
        super.onCreate(savedInstanceState);

        // enable edge-to-edge on older Android versions
        WindowCompat.enableEdgeToEdge(getWindow());
    }
}
