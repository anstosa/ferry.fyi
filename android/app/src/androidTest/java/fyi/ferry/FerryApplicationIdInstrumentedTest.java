package fyi.ferry;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
// define the native contract
public class FerryApplicationIdInstrumentedTest {

    // verify the target application id
    @Test
    public void targetContextUsesFerryApplicationId() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("fyi.ferry", appContext.getPackageName());
    }
}
