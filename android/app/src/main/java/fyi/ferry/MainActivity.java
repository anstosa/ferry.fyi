package fyi.ferry;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // enable edge-to-edge on older Android versions
        WindowCompat.enableEdgeToEdge(getWindow());
    }
}
