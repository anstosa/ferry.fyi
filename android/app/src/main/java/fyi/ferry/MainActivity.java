package fyi.ferry;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

// define the native contract
public class MainActivity extends BridgeActivity {

    @Override
    // define the native contract
    protected void onCreate(Bundle savedInstanceState) {
        // The plugin is queryable in every build, but all permission-changing operations are
        // hard-gated by BuildConfig.BACKGROUND_LOCATION_FEASIBILITY_ENABLED (false by default).
        registerPlugin(BackgroundLocationFeasibilityPlugin.class);
        // register the default-off secure automatic-checkin bridge
        registerPlugin(AutomaticLeaderboardCheckinsPluginV1.class);
        super.onCreate(savedInstanceState);

        // enable edge-to-edge on older Android versions
        WindowCompat.enableEdgeToEdge(getWindow());
    }
}
